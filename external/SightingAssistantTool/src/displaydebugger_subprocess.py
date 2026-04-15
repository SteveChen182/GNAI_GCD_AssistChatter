"""
DisplayDebugger Subprocess

Description:

Calls displaydebugger toolkit via separate command prompt windows for each display log file.
Supports both GOP (UEFI) logs and ETL (OS driver) logs.
The assistant constructs the intelligent analysis focus based on HSD context.

"""

import subprocess
import os
import json
from datetime import datetime
import time
import tempfile
import ast
import re
import sys


def get_attachment_info_file():
    """Get attachment_info_file path from environment variable."""
    raw_path = os.environ.get('GNAI_INPUT_ATTACHMENT_INFO_FILE', '').strip()
    if not raw_path:
        return ''

    # Handle values wrapped in quotes by some tool invocations.
    if (raw_path.startswith('"') and raw_path.endswith('"')) or (
        raw_path.startswith("'") and raw_path.endswith("'")
    ):
        raw_path = raw_path[1:-1].strip()

    return raw_path

def get_hsd_id():
    """Get HSD ID from environment variable"""
    hsd_id = os.environ.get('GNAI_INPUT_HSD_ID', '').strip()
    return hsd_id

def get_log_files():
    """Get the list of log files from environment variable"""
    log_files_str = os.environ.get('GNAI_INPUT_LOG_FILES', '')
    
    if not log_files_str:
        return []
    
    try:
        # Try to parse as JSON list
        parsed_list = json.loads(log_files_str)
        if isinstance(parsed_list, list):
            return [str(item).strip() for item in parsed_list if str(item).strip()]
        elif isinstance(parsed_list, str):
            return [parsed_list.strip()] if parsed_list.strip() else []
    except json.JSONDecodeError:
        try:
            # Try ast.literal_eval as fallback
            parsed_list = ast.literal_eval(log_files_str.strip())
            if isinstance(parsed_list, list):
                return [str(item).strip() for item in parsed_list if str(item).strip()]
            elif isinstance(parsed_list, str):
                return [parsed_list.strip()] if parsed_list.strip() else []
        except (ValueError, SyntaxError):
            # Treat as single file path
            return [log_files_str.strip()] if log_files_str.strip() else []
    
    return []


def is_gop_log_file(file_name):
    """Heuristic check for GOP/UEFI log filenames."""
    filename_lower = file_name.lower()
    if not (filename_lower.endswith('.txt') or filename_lower.endswith('.log')):
        return False

    gop_patterns = ['boot', 'gop', 'uefi', 'preos', 'bios', 'intelugop', 'intelgop', 'intelpeim']
    return any(pattern in filename_lower for pattern in gop_patterns)


def discover_log_files_from_workspace():
    """Discover ETL/GOP logs from extracted attachment paths in GNAI temp workspace.

    Returns:
        tuple[list[str], dict]: (discovered_paths, discovery_stats)
    """
    workspace = os.environ.get('GNAI_TEMP_WORKSPACE', '').strip()
    if not workspace or not os.path.isdir(workspace):
        return [], {
            "workspace": workspace,
            "searched": False,
            "reason": "GNAI_TEMP_WORKSPACE is missing or inaccessible"
        }

    workspace_abs = os.path.abspath(workspace)

    discovered_paths = set()
    etl_count = 0
    gop_count = 0

    for root, dirs, files in os.walk(workspace_abs):
        abs_root = os.path.abspath(root)

        # Limit recursive scanning to extracted attachments and persistent logs,
        # but still allow direct file attachments in workspace root.
        is_workspace_root = abs_root == workspace_abs
        if is_workspace_root:
            within_extracted_or_persistent = True
        else:
            rel_root = os.path.relpath(abs_root, workspace_abs)
            rel_parts = [part.lower() for part in rel_root.split(os.sep) if part and part != '.']
            within_extracted_or_persistent = any(
                part.startswith('extracted_') or part == 'persistent_logs'
                for part in rel_parts
            )

        # Prune dirs in-place to avoid traversing outside extracted_/persistent_logs
        if not within_extracted_or_persistent:
            dirs[:] = []  # Stop os.walk from descending into subdirectories
            continue

        for file_name in files:
            full_path = os.path.join(root, file_name)
            file_name_lower = file_name.lower()

            if file_name_lower.endswith('.etl'):
                discovered_paths.add(os.path.abspath(full_path))
                etl_count += 1
            elif file_name_lower.endswith('.zip') or file_name_lower.endswith('.7z'):
                discovered_paths.add(os.path.abspath(full_path))
                etl_count += 1
            elif is_gop_log_file(file_name):
                discovered_paths.add(os.path.abspath(full_path))
                gop_count += 1

    sorted_paths = sorted(discovered_paths)
    return sorted_paths, {
        "workspace": workspace,
        "searched": True,
        "found_total": len(sorted_paths),
        "found_etl": etl_count,
        "found_gop": gop_count
    }


def _is_supported_display_log_name(file_name):
    """Return True if the file name is relevant for DisplayDebugger analysis."""
    name_lower = file_name.lower()
    return (
        name_lower.endswith('.etl')
        or name_lower.endswith('.zip')
        or name_lower.endswith('.7z')
        or is_gop_log_file(file_name)
    )


def discover_log_files_from_attachment_info(attachment_info_file_path):
    """Discover ETL/GOP logs using attachment_info_file content.

    Returns:
        tuple[list[str], dict]: (discovered_paths, discovery_stats)
    """
    workspace = os.environ.get('GNAI_TEMP_WORKSPACE', '').strip()
    if not attachment_info_file_path:
        return [], {
            "searched": False,
            "reason": "attachment_info_file not provided"
        }

    normalized_path = os.path.normpath(attachment_info_file_path)

    candidate_paths = [normalized_path]

    # Fallback: if a full path fails, try locating by basename in workspace.
    if workspace:
        base_name = os.path.basename(normalized_path)
        if base_name:
            candidate_paths.append(os.path.normpath(os.path.join(workspace, base_name)))

    resolved_attachment_info_path = next((p for p in candidate_paths if os.path.isfile(p)), '')

    if not resolved_attachment_info_path:
        return [], {
            "searched": False,
            "reason": "attachment_info_file path is missing or inaccessible",
            "attachment_info_file": attachment_info_file_path,
            "candidate_paths": candidate_paths
        }

    discovered_paths = set()
    etl_count = 0
    gop_count = 0

    try:
        with open(resolved_attachment_info_path, 'r', encoding='utf-8', errors='replace') as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return [], {
            "searched": False,
            "reason": f"failed to parse attachment_info_file: {e}",
            "attachment_info_file": resolved_attachment_info_path
        }

    attachment_info = data.get('attachment_info', {})
    if not isinstance(attachment_info, dict):
        return [], {
            "searched": False,
            "reason": "attachment_info is missing or invalid in attachment_info_file",
            "attachment_info_file": resolved_attachment_info_path
        }

    # Build filename index from workspace for robust resolution.
    # Key: lower-case basename, value: list of absolute paths
    workspace_index = {}
    if workspace and os.path.isdir(workspace):
        for root, _, files in os.walk(workspace):
            for file_name in files:
                file_path = os.path.abspath(os.path.join(root, file_name))
                workspace_index.setdefault(file_name.lower(), []).append(file_path)

    def add_file_candidate(file_name):
        nonlocal etl_count, gop_count

        if not _is_supported_display_log_name(file_name):
            return

        file_name_lower = file_name.lower()

        # Prefer concrete resolved file paths found in workspace.
        matched_paths = workspace_index.get(file_name_lower, [])
        for matched_path in matched_paths:
            discovered_paths.add(matched_path)

        # Also consider direct attachment location in workspace root.
        if workspace:
            root_candidate = os.path.abspath(os.path.join(workspace, file_name))
            if os.path.isfile(root_candidate):
                discovered_paths.add(root_candidate)

        if file_name_lower.endswith('.etl') or file_name_lower.endswith('.zip') or file_name_lower.endswith('.7z'):
            etl_count += 1
        elif is_gop_log_file(file_name):
            gop_count += 1

    for attachment_name, attachment_meta in attachment_info.items():
        if isinstance(attachment_name, str):
            add_file_candidate(attachment_name)

        if not isinstance(attachment_meta, dict):
            continue

        sub_attachments = attachment_meta.get('sub_attachments', {})
        if isinstance(sub_attachments, dict):
            for sub_attachment_name in sub_attachments.keys():
                if isinstance(sub_attachment_name, str):
                    add_file_candidate(sub_attachment_name)

    sorted_paths = sorted(discovered_paths)
    return sorted_paths, {
        "searched": True,
        "attachment_info_file": resolved_attachment_info_path,
        "workspace": workspace,
        "found_total": len(sorted_paths),
        "found_etl": etl_count,
        "found_gop": gop_count
    }

def get_analysis_focus():
    """Get analysis focus from environment variable"""
    analysis_focus = os.environ.get('GNAI_INPUT_ANALYSIS_FOCUS', '').strip()
    return analysis_focus

def detect_log_type(log_filename):
    """
    Detect log type based on filename extension or patterns
    
    Returns: 'gop' or 'etl' or 'unknown'
    """
    filename_lower = log_filename.lower()

    # GOP logs (text files with specific patterns)
    if filename_lower.endswith('.txt') or filename_lower.endswith('.log'):
        # Common GOP log names
        if any(pattern in filename_lower for pattern in ['boot', 'gop', 'uefi', 'preos', 'bios', 'intelgop', 'intelugop', 'intelpeim']):
            return 'gop'

    # Archive logs: infer from archive name keywords first
    if filename_lower.endswith('.7z') or filename_lower.endswith('.zip'):
        if any(pattern in filename_lower for pattern in ['gop', 'uefi', 'preos', 'intelgop', 'intelugop', 'intelpeim']):
            return 'gop'
        if any(pattern in filename_lower for pattern in ['etl', 'gfxtrace', 'boottrace', 'mergedgfx']):
            return 'etl'
        # Ambiguous archives: do not default to ETL based on extension alone
        return 'unknown'
    
    # ETL logs
    if filename_lower.endswith('.etl') or 'gfxtrace' in filename_lower:
        return 'etl'
    
    # Default to GOP for text files, ETL for others
    if filename_lower.endswith('.txt') or filename_lower.endswith('.log'):
        return 'gop'
    
    return 'unknown'


def resolve_provided_log_files(log_files):
    """Resolve assistant-provided log file values to concrete file paths when possible.

    This supports cases where the assistant passes only file names (as seen in
    attachment metadata) instead of absolute paths.
    """
    workspace = os.environ.get('GNAI_TEMP_WORKSPACE', '').strip()
    if not log_files:
        return []

    if not workspace or not os.path.isdir(workspace):
        return [str(item).strip().strip('"').strip("'") for item in log_files if str(item).strip()]

    # Build basename index once for fast resolution.
    workspace_index = {}
    for root, _, files in os.walk(workspace):
        for file_name in files:
            full_path = os.path.abspath(os.path.join(root, file_name))
            workspace_index.setdefault(file_name.lower(), []).append(full_path)

    resolved = []
    for item in log_files:
        candidate = str(item).strip()
        if not candidate:
            continue

        candidate = candidate.strip('"').strip("'")

        # Keep already-valid paths as-is.
        if os.path.isfile(candidate):
            resolved.append(os.path.abspath(candidate))
            continue

        # Try workspace-root relative path.
        workspace_relative = os.path.abspath(os.path.join(workspace, candidate))
        if os.path.isfile(workspace_relative):
            resolved.append(workspace_relative)
            continue

        # Fallback: resolve by basename from workspace index.
        base_name = os.path.basename(candidate).lower()
        matches = workspace_index.get(base_name, [])
        if matches:
            # Prefer extracted/persistent locations if present.
            preferred = [
                match for match in matches
                if ('\\persistent_logs\\' in match.lower() or '\\extracted_' in match.lower())
            ]
            resolved.append(preferred[0] if preferred else matches[0])
        else:
            # Keep original value; downstream logic may still handle it.
            resolved.append(candidate)

    # De-duplicate while preserving order.
    deduped = []
    seen = set()
    for path in resolved:
        key = path.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(path)

    return deduped



def execute_displaydebugger_analysis(hsd_id, log_file, log_type, analysis_focus):
    """Execute DisplayDebugger analysis in separate interactive CMD window.
    
    Uses gnai's built-in --log-file flag to save output to a file while keeping
    stdin connected so the user can interact with follow-up prompts and HSD upload.
    No PowerShell pipe or transcript needed — gnai handles file output natively.
    """
    start_time = time.time()
    
    try:
        src_dir = os.getcwd()
        
        # Create .output directory for log files
        output_dir = os.path.join(src_dir, ".output")
        os.makedirs(output_dir, exist_ok=True)
        
        # Output file path
        safe_filename = re.sub(r'[^\w\-.]', '_', os.path.basename(log_file))
        output_file = os.path.join(output_dir, f"displaydebugger_{hsd_id}_{safe_filename}_analysis.txt")
        
        # Escape values for cmd.exe batch expansion safety
        log_file_cmd = log_file.replace('%', '%%')
        analysis_focus_cmd = analysis_focus.replace('%', '%%')

        # Build GNAI command based on log type
        # --log-file saves all output to file natively while keeping stdin interactive
        if log_type == 'gop':
            gnai_command = f'gnai ask --log-file="{output_file}" --assistant=displaydebugger "analyze HSD {hsd_id} with the GOP log \'{log_file_cmd}\' to check for {analysis_focus_cmd}"'
        elif log_type == 'etl':
            gnai_command = f'gnai ask --log-file="{output_file}" --assistant=displaydebugger "analyze HSD {hsd_id} with the etl \'{log_file_cmd}\' to verify {analysis_focus_cmd}"'
        else:
            gnai_command = f'gnai ask --log-file="{output_file}" --assistant=displaydebugger "analyze HSD {hsd_id} with the log file \'{log_file_cmd}\' to check for {analysis_focus_cmd}"'
        
        # Create batch file content — simple and clean, like sherlog
        # gnai handles file output via --log-file, stdin stays connected for user interaction
        batch_content = f"""@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

cd /d "{src_dir}"

echo ============================================
echo DisplayDebugger Analysis
echo HSD ID: {hsd_id}
echo Log File: {log_file}
echo Log Type: {log_type.upper()}
echo Focus: {analysis_focus}
echo Started at: %date% %time%
echo ============================================
echo.
echo Executing command:
echo {gnai_command}
echo.
echo Output will be saved to: {output_file}
echo.

{gnai_command}

echo.
echo ============================================
echo Analysis completed at: %date% %time%
echo Output saved to: {output_file}
echo ============================================
echo.
echo Press any key to close this window...
pause >nul
"""
        
        # Create temporary batch file
        temp_dir = tempfile.gettempdir()
        timestamp = int(time.time())
        batch_file = os.path.join(temp_dir, f"displaydebugger_{hsd_id}_{safe_filename}_{timestamp}.bat")
        
        with open(batch_file, 'w', encoding='utf-8') as f:
            f.write(batch_content)
        
        # Launch separate CMD window with /wait - blocks until window closes (sherlog pattern)
        cmd_command = f'start "DisplayDebugger - {safe_filename}" /wait cmd /c "{batch_file}"'
        
        process = subprocess.Popen(cmd_command, shell=True)
        return_code = process.wait()
        
        execution_time = round(time.time() - start_time, 2)
        
        # Read the log output file created by gnai --log-file
        displaydebugger_output_exists = os.path.exists(output_file)
        content = ""
        if displaydebugger_output_exists:
            with open(output_file, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        
        # Clean up temp batch file
        try:
            os.remove(batch_file)
        except Exception:
            pass
        
        success = (return_code == 0) and displaydebugger_output_exists and bool(content)
        
        return {
            "status": "success" if success else "error",
            "return_code": return_code,
            "execution_time_seconds": execution_time,
            "log_file": log_file,
            "log_type": log_type,
            "hsd_id": hsd_id,
            "command": gnai_command,
            "focus": analysis_focus,
            "displaydebugger_output_file": output_file if displaydebugger_output_exists else None,
            "displaydebugger_output_exists": displaydebugger_output_exists,
            "content": content if content else None,
            "content_length": len(content) if content else 0,
            "window_opened": True,
            "note": f"DisplayDebugger analysis completed in {execution_time}s. Output saved to {output_file}."
        }
        
    except Exception as e:
        execution_time = round(time.time() - start_time, 2)
        return {
            "status": "error",
            "error": str(e),
            "execution_time_seconds": execution_time,
            "log_file": log_file,
            "log_type": log_type,
            "hsd_id": hsd_id,
            "displaydebugger_output_file": None,
            "displaydebugger_output_exists": False,
            "content": None,
            "content_length": 0,
            "window_opened": False
        }

def main():
    """Main entry point"""
    start_time = datetime.now()
    
    # Get inputs
    hsd_id = get_hsd_id()
    log_files = get_log_files()
    analysis_focus = get_analysis_focus()
    attachment_info_file_path = get_attachment_info_file()

    # Normalize and resolve assistant-provided file names to concrete paths.
    if log_files:
        log_files = resolve_provided_log_files(log_files)

    discovery_stats = {
        "searched": False,
        "reason": "log_files provided by assistant"
    }

    # Deterministic fallback: auto-discover logs from extracted attachment paths
    if not log_files:
        log_files, discovery_stats = discover_log_files_from_workspace()

    # Second fallback: derive log candidates from attachment_info_file and resolve against workspace.
    if not log_files:
        log_files, attachment_info_discovery_stats = discover_log_files_from_attachment_info(attachment_info_file_path)
        discovery_stats = {
            "workspace_discovery": discovery_stats,
            "attachment_info_discovery": attachment_info_discovery_stats
        }
    
    # Validate inputs
    if not hsd_id:
        print(json.dumps({
            "error": "HSD ID is required",
            "status": "error",
            "timestamp": start_time.isoformat()
        }), file=sys.stderr)
        sys.exit(1)
    
    if not log_files:
        print(json.dumps({
            "error": "No log files provided and no ETL/GOP logs discovered from extracted attachment paths",
            "status": "error",
            "discovery": discovery_stats,
            "timestamp": start_time.isoformat()
        }), file=sys.stderr)
        sys.exit(1)
    
    if not analysis_focus:
        print(json.dumps({
            "error": "Analysis focus is required (should be constructed by assistant)",
            "status": "error",
            "timestamp": start_time.isoformat()
        }), file=sys.stderr)
        sys.exit(1)
    
    # Process each log file
    results = []
    for log_file in log_files:
        log_type = detect_log_type(log_file)
        result = execute_displaydebugger_analysis(hsd_id, log_file, log_type, analysis_focus)
        results.append(result)
    
    # Output summary
    end_time = datetime.now()
    total_time = (end_time - start_time).total_seconds()
    
    # Compute overall status from individual results
    error_count = sum(1 for r in results if r.get('status') == 'error')
    success_count = len(results) - error_count
    
    if error_count == 0:
        overall_status = "completed_success"
        message = f"Successfully launched DisplayDebugger analysis for {len(log_files)} log file(s). Check the separate command windows for detailed results."
        exit_code = 0
    elif success_count == 0:
        overall_status = "completed_all_failed"
        message = f"All {len(log_files)} DisplayDebugger analysis attempts failed. Check the error details in the analyses section."
        exit_code = 1
    else:
        overall_status = "completed_with_failures"
        message = f"DisplayDebugger analysis completed with {success_count} success(es) and {error_count} failure(s) out of {len(log_files)} log file(s)."
        exit_code = 1
    
    output = {
        "status": overall_status,
        "hsd_id": hsd_id,
        "total_log_files_analyzed": len(log_files),
        "success_count": success_count,
        "error_count": error_count,
        "analysis_focus": analysis_focus,
        "log_discovery": discovery_stats,
        "analyses": results,
        "total_execution_time_seconds": round(total_time, 2),
        "timestamp": end_time.isoformat(),
        "message": message
    }

    print(json.dumps(output, indent=2))
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
