import os
import sys
import shutil
import re
from hsdes import HSDESAPI
import mimetypes
import py7zr
import zipfile
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import threading
from collections import defaultdict
import logging
import json
import pprint
logging.basicConfig(level = logging.INFO, format = '%(asctime)s - %(levelname)s - %(message)s', stream = sys.stdout)
from etl_classifier import ETLAnalyzer

# Disable logging specifically for etl_classifier module
etl_logger = logging.getLogger('etl_classifier')
etl_logger.disabled = True

# Set UTF-8 encoding for output
sys.stdout.reconfigure(encoding='utf-8')

attachment_info_file = "attachment_info_file"

def download_attachment(hsd, attach, workspace):
    """Download a single attachment"""
    combined_path = os.path.join(workspace, attach['document.file_name'])
    abs_filename = os.path.abspath(combined_path)
    
    if os.path.exists(abs_filename):
        logging.debug(f"Skipping duplicate attachment: {attach['document.file_name']}")
        return abs_filename, attach, True
    
    try:
        hsd.download_attachment(abs_filename, attach['id'])
        logging.debug(f"[SUCCESS] : Downloaded {abs_filename}")
        return abs_filename, attach, False
    except Exception as e:
        logging.debug(f"[ERROR]: Failed to download {attach['document.file_name']}: {e}")
        return None, attach, False


def extract_and_find_file_types(abs_filename, attach, workspace):
    """Extract archive and find ETL, .log, .txt, .trace, and .csv files"""
    if not os.path.exists(abs_filename):
        return [], [], [], [], []
    
    _, ext = os.path.splitext(abs_filename)
    attachment_extraction_path = os.path.join(workspace, f"extracted_{attach['id']}")
    etl_files = []
    dot_log_files = []
    dot_txt_files = []
    dot_trace_files = []
    dot_csv_files = []

    # Check for direct file attachments (not archives)
    if ext.lower() == ".etl":
        logging.debug(f"Direct ETL file detected: {abs_filename}")
        etl_files.append((abs_filename, attach))
        return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files
    elif ext.lower() == ".log":
        logging.debug(f"Direct .log file detected: {abs_filename}")
        dot_log_files.append((abs_filename, attach))
        return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files
    elif ext.lower() == ".txt":
        logging.debug(f"Direct .txt file detected: {abs_filename}")
        dot_txt_files.append((abs_filename, attach))
        return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files
    elif ext.lower() == ".trace":
        logging.debug(f"Direct .trace file detected: {abs_filename}")
        dot_trace_files.append((abs_filename, attach))
        return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files
    elif ext.lower() == ".csv":
        logging.debug(f"Direct .csv file detected: {abs_filename}")
        dot_csv_files.append((abs_filename, attach))
        return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files

    # Extract archives
    extraction_needed = False
    if ext.lower() == ".7z":
        try:
            os.makedirs(attachment_extraction_path, exist_ok=True)
            with py7zr.SevenZipFile(abs_filename, 'r') as archive:
                archive.extractall(attachment_extraction_path)
            logging.debug(f"[SUCCESS]: 7z extraction completed at {attachment_extraction_path}")
            extraction_needed = True
        except Exception as e:
            logging.debug(f"[ERROR]: Failed to extract 7z file: {e}")
            return [], [], [], [], []
            
    elif ext.lower() == ".zip":
        try:
            os.makedirs(attachment_extraction_path, exist_ok=True)
            with zipfile.ZipFile(abs_filename, 'r') as zip_ref:
                zip_ref.extractall(attachment_extraction_path)
            logging.debug(f"[SUCCESS]: Zip extraction completed at {attachment_extraction_path}")
            extraction_needed = True
        except Exception as e:
            logging.debug(f"[ERROR]: Failed to extract zip file: {e}")
            return [], [], [], [], []
    else:
        logging.debug(f"Unsupported file extension: {ext}")
        return [], [], [], [], []
    
    # Search for all file types in extracted archives
    if extraction_needed:
        for root, dirs, files in os.walk(attachment_extraction_path):
            for file in files:
                file_path = os.path.join(root, file)
                if file.lower().endswith(".etl"):
                    etl_files.append((file_path, attach))
                elif file.lower().endswith(".log"):
                    dot_log_files.append((file_path, attach))
                elif file.lower().endswith(".txt"):
                    dot_txt_files.append((file_path, attach))
                elif file.lower().endswith(".trace"):
                    dot_trace_files.append((file_path, attach))
                elif file.lower().endswith(".csv"):
                    dot_csv_files.append((file_path, attach))

    return etl_files, dot_log_files, dot_txt_files, dot_trace_files, dot_csv_files


def analyze_etl_file(etl_file_path_and_attach):
    """Analyze a single ETL file and return driver info"""
    etl_file_path, attach_info = etl_file_path_and_attach
    file_name = os.path.basename(etl_file_path)
    
    try:
        etl_analyzer = ETLAnalyzer()
        result = etl_analyzer.analyze_etl(etl_file_path)  
        
        if "error" in result:
            print(f"[ERROR] analyzing {file_name}: {result['error']}")
            return attach_info['document.file_name'], f"{file_name} : Analysis Failed", None, False
        # Extract driver info 
        driver_info = result.get("driver_info", {})
        driver_data = None
        
        if driver_info.get('found'):
            build_type = driver_info.get('driver_build_type', 'Unknown')
            driver_version = driver_info.get('driver_version', 'Unknown')
            build_date = driver_info.get('driver_build_date', 'Unknown')
            
            if driver_version and driver_version != 'Unknown':
                build_string = driver_info.get('build_string', '')
                
                if build_string and len(build_string) > 50:
                    build_string = build_string[:47] + "..."
                
                driver_data = {
                    'build_type': build_type,
                    'version': driver_version,
                    'build_date': build_date,
                    'build_string': build_string,
                    'found': True,
                    'file': file_name
                }
        
        # Extract pipe underrun status
        pipe_underrun_detected = result.get("pipe_underrun_detected", False)

        etl_type = result.get("type", "Unknown")

        # Create result string with underrun info if detected
        result_string = f"{file_name} : {etl_type}"
        if pipe_underrun_detected:
            result_string += " (Pipe Underrun Detected)"

        return attach_info['document.file_name'], result_string, driver_data, pipe_underrun_detected
    except Exception as e:
        logging.debug(f"[ERROR] analyzing {file_name}: {e}")
        return attach_info['document.file_name'], f"{file_name} : Analysis Failed", None , False



def build_etl_info(file_name, attachment_results, driver_versions_found, pipe_underrun_files, attachment_name):
    """Build ETL info section for a file"""
    
    # Find ETL analysis results for this file
    etl_type = "Unknown"
    if attachment_name in attachment_results:
        for result in attachment_results[attachment_name]:
            if file_name in result:
                etl_type = result.split(' : ')[1].replace(' (Pipe Underrun Detected)', '')
                break
    
    # Find driver info for this file
    driver_info = {"found": False}
    for driver_data in driver_versions_found:
        if driver_data.get('file') == file_name:
            driver_info = {
                "found": True,
                "build_type": driver_data.get('build_type', 'Unknown'),
                "version": driver_data.get('version', 'Unknown'),
                "build_date": driver_data.get('build_date', 'Unknown'),
                "build_string": driver_data.get('build_string', ''),
                "file": file_name
            }
            break
    
    # Find pipe underrun info for this file
    pipe_underrun = {"detected": False}
    for underrun_file in pipe_underrun_files:
        if underrun_file['file'] == file_name and underrun_file['attachment'] == attachment_name:
            pipe_underrun = {"detected": True}
            break
    
    return {
        "etl_type": etl_type,
        "driver_info": driver_info,
        "pipe_underrun": pipe_underrun
    }


def build_attachment_structure(attachments, attachment_results, driver_versions_found, pipe_underrun_files, all_etl_files, all_log_txt_trace_files, all_csv_files=None):
    """Build attachment structure that leaves space for other log results to be merged later"""
    
    attachment_info = {}
    
    # Initialize all attachments first
    for attach in attachments:
        attachment_name = attach['document.file_name']
        
        if attachment_name.lower().endswith(('.zip', '.7z')):
            attachment_info[attachment_name] = {
                "attachment_type": "archive",
                "archive_format": "zip" if attachment_name.lower().endswith('.zip') else "7z",
                "sub_attachments": {}
            }
        else:
            attachment_info[attachment_name] = {
                "attachment_type": "direct_file",
                "archive_format": None
            }
    
    # Add ETL files
    for etl_path, attach_info in all_etl_files:
        attachment_name = attach_info['document.file_name']
        file_name = os.path.basename(etl_path)
        
        etl_info = build_etl_info(file_name, attachment_results, driver_versions_found, pipe_underrun_files, attachment_name)
        
        if attachment_info[attachment_name]['attachment_type'] == 'archive':
            attachment_info[attachment_name]['sub_attachments'][file_name] = {"etl_info": etl_info}
        else:
            attachment_info[attachment_name]['etl_info'] = etl_info
    
    # Add log/txt/trace files with placeholders for analysis
    for log_path, attach_info in all_log_txt_trace_files:
        attachment_name = attach_info['document.file_name']
        original_file_name = os.path.basename(log_path)
        
        # These paths come from persistent_logs where files are named
        # <attachment_id>_<original_filename>. Strip only that leading attachment ID.
        if '_' in original_file_name and original_file_name.startswith(str(attach_info['id'])):
            file_name = '_'.join(original_file_name.split('_')[1:])
        else:
            file_name = original_file_name
        
        # Create placeholder structure that analysis will fill
        if file_name.lower().endswith('.log'):
            log_info = {
                "log_type": "pending_analysis",
                "log_analysis_results": {
                    "status": "pending"
                }
            }
            
            if attachment_info[attachment_name]['attachment_type'] == 'archive':
                attachment_info[attachment_name]['sub_attachments'][file_name] = {"log_info": log_info}
            else:
                attachment_info[attachment_name]['log_info'] = log_info
                
        elif file_name.lower().endswith('.txt'):
            txt_info = {
                "txt_type": "pending_analysis",
                "txt_analysis_results": {
                    "status": "pending"
                }
            }
            
            if attachment_info[attachment_name]['attachment_type'] == 'archive':
                attachment_info[attachment_name]['sub_attachments'][file_name] = {"txt_info": txt_info}
            else:
                attachment_info[attachment_name]['txt_info'] = txt_info
                
        elif file_name.lower().endswith('.trace'):
            trace_info = {
                "trace_type": "pending_analysis",
                "trace_analysis_results": {
                    "status": "pending"
                }
            }
            
            if attachment_info[attachment_name]['attachment_type'] == 'archive':
                attachment_info[attachment_name]['sub_attachments'][file_name] = {"trace_info": trace_info}
            else:
                attachment_info[attachment_name]['trace_info'] = trace_info

    # Add CSV files (PTAT / GfxPnp logs) with placeholder for analysis
    for csv_path, attach_info in (all_csv_files or []):
        attachment_name = attach_info['document.file_name']
        original_file_name = os.path.basename(csv_path)

        # These paths come from persistent_logs where files are named
        # <attachment_id>_<original_filename>. Strip only that leading attachment ID.
        if '_' in original_file_name and original_file_name.startswith(str(attach_info['id'])):
            file_name = '_'.join(original_file_name.split('_')[1:])
        else:
            file_name = original_file_name

        if attachment_name not in attachment_info:
            continue

        csv_info = {
            "csv_type": "pending_analysis",
            "csv_analysis_results": {
                "status": "pending"
            }
        }

        if attachment_info[attachment_name]['attachment_type'] == 'archive':
            attachment_info[attachment_name]['sub_attachments'][file_name] = {"csv_info": csv_info}
        else:
            attachment_info[attachment_name]['csv_info'] = csv_info

    return attachment_info




if __name__ == "__main__":
    hsd = HSDESAPI()
    attachments = hsd.get_attachments_list(int(os.environ['GNAI_INPUT_ID']))
    workspace = os.environ['GNAI_TEMP_WORKSPACE']
    
    print("=" * 30)
    print("= Attachment list ")
    print("=" * 30)
    
    for i, attach in enumerate(attachments):
        print(f"Attachment no.{i+1} : {attach['document.file_name']}")

    logging.debug("\n" + "=" * 50)
    logging.debug("PHASE 1: DOWNLOADING ALL ATTACHMENTS")
    logging.debug("=" * 50)

    # Phase 1: Download all attachments
    downloaded_attachments = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        download_futures = {
            executor.submit(download_attachment, hsd, attach, workspace): attach
            for attach in attachments
        }
        for future in as_completed(download_futures):
            result = future.result()
            attach = download_futures[future]
            if result[0] is not None:
                downloaded_attachments.append(result)
    
    logging.debug(f"\nDownloaded/Found {len(downloaded_attachments)} attachments")
    
    # Phase 2: Extract archives and find all file types
    logging.debug("PHASE 2: EXTRACTING AND FINDING ALL FILE TYPES")

    all_etl_files = []
    all_log_files = []
    all_txt_files = []
    all_trace_files = []
    all_csv_files = []

    with ThreadPoolExecutor(max_workers=6) as executor:
        extract_futures = {
            executor.submit(extract_and_find_file_types, abs_filename, attach, workspace): attach
            for abs_filename, attach, was_skipped in downloaded_attachments
        }
        for future in as_completed(extract_futures):
            attach = extract_futures[future]
            etl_files, log_files, txt_files, trace_files, csv_files = future.result()

            all_etl_files.extend(etl_files)
            all_log_files.extend(log_files)
            all_txt_files.extend(txt_files)
            all_trace_files.extend(trace_files)
            all_csv_files.extend(csv_files)

            if etl_files or log_files or txt_files or trace_files or csv_files:
                logging.debug(f"Found {len(etl_files)} ETL, {len(log_files)} .log, {len(txt_files)} .txt, {len(trace_files)} .trace, {len(csv_files)} .csv file(s) in {attach['document.file_name']}")
    
    logging.debug(f"\nTotal files found: {len(all_etl_files)} ETL, {len(all_log_files)} .log, {len(all_txt_files)} .txt, {len(all_trace_files)} .trace, {len(all_csv_files)} .csv")
    
    # Phase 3: Analyze ETL files 
    attachment_results = defaultdict(list)
    driver_versions_found = []  
    pipe_underrun_files = []
    
    if all_etl_files:
        logging.debug("PHASE 3: ANALYZING ETL FILES")
        
        try:
            with ProcessPoolExecutor(max_workers=min(4, os.cpu_count())) as executor:
                analysis_futures = {
                    executor.submit(analyze_etl_file, (etl_path, attach_info)): (etl_path, attach_info)
                    for etl_path, attach_info in all_etl_files
                }
                for future in as_completed(analysis_futures):
                    result = future.result()
                    etl_path, _ = analysis_futures[future]
                    if len(result) == 4:
                        attach_document_file_name, result_string, driver_data, pipe_underrun = result
                    else:
                        attach_document_file_name, result_string, driver_data = result
                        pipe_underrun = False  
                    
                    attachment_results[attach_document_file_name].append(result_string)

                    # Collect driver versions 
                    if driver_data and driver_data.get('found'):
                        driver_versions_found.append(driver_data)
                        logging.debug(f"[DRIVER INFO] Version: {driver_data['version']} (from {driver_data['file']})")
                        if driver_data.get('build'):
                            logging.debug(f"[DRIVER INFO] Build: {driver_data['build']}")
            
                    # Collect pipe underrun files
                    if pipe_underrun:
                        pipe_underrun_files.append({
                            'attachment': attach_document_file_name,
                            'file': os.path.basename(result_string.split(' : ')[0])
                        })

        except Exception as e:
            # Fallback to ThreadPoolExecutor if ProcessPool fails
            logging.debug(f"[WARNING] ProcessPoolExecutor failed: {e}, falling back to ThreadPoolExecutor")
            with ThreadPoolExecutor(max_workers=8) as executor:
                analysis_futures = {
                    executor.submit(analyze_etl_file, (etl_path, attach_info)): (etl_path, attach_info)
                    for etl_path, attach_info in all_etl_files
                }
                for future in as_completed(analysis_futures):
                    result = future.result()
                    etl_path, _ = analysis_futures[future]
                    if len(result) == 4:
                        attach_document_file_name, result_string, driver_data, pipe_underrun = result
                    else:
                        attach_document_file_name, result_string, driver_data = result
                        pipe_underrun = False  
                    
                    attachment_results[attach_document_file_name].append(result_string)

                    # Collect driver versions
                    if driver_data and driver_data.get('found'):
                        driver_versions_found.append(driver_data)
                        logging.debug(f"[DRIVER INFO] Version: {driver_data['version']} (from {driver_data['file']})")
                        if driver_data.get('build'):
                            logging.debug(f"[DRIVER INFO] Build: {driver_data['build']}")
                    # Collect pipe underrun files
                    if pipe_underrun:
                        pipe_underrun_files.append({
                            'attachment': attach_document_file_name,
                            'file': os.path.basename(result_string.split(' : ')[0])
                        })

    # Phase 4: Copy all extracted files (log/txt/trace/csv) to persistent_logs/ and save combined index
    all_log_txt_trace_files = all_log_files + all_txt_files + all_trace_files

    persistent_log_dir = os.path.join(workspace, 'persistent_logs')
    os.makedirs(persistent_log_dir, exist_ok=True)

    all_log_txt_trace_csv_persistent = []
    used_persistent_names = set()
    for file_path, attach_info in all_log_txt_trace_files + all_csv_files:
        if os.path.exists(file_path):
            base_name = os.path.basename(file_path)
            safe_name = f"{attach_info['id']}_{base_name}"

            # Prefer readable disambiguation for extracted archive files by embedding
            # part of their relative path, e.g. <id>_folder__subfolder_<basename>.
            extracted_prefix = os.path.join(workspace, f"extracted_{attach_info['id']}")
            try:
                common_root = os.path.commonpath([os.path.abspath(file_path), os.path.abspath(extracted_prefix)])
            except ValueError:
                common_root = ""

            if common_root == os.path.abspath(extracted_prefix):
                rel_from_extracted = os.path.relpath(file_path, extracted_prefix)
                rel_dir = os.path.dirname(rel_from_extracted)
                if rel_dir and rel_dir != '.':
                    rel_token = rel_dir.replace('\\', '__').replace('/', '__')
                    rel_token = re.sub(r'[^A-Za-z0-9._-]+', '-', rel_token).strip('-_')
                    if rel_token:
                        safe_name = f"{attach_info['id']}_{rel_token}_{base_name}"

            if safe_name in used_persistent_names:
                # Collision resolution: keep names readable by appending _2, _3, ...
                # to the already path-disambiguated candidate. 
                # This is preferred over using hashes to keep names readable for user.
                stem, ext = os.path.splitext(safe_name)
                counter = 2
                while safe_name in used_persistent_names:
                    safe_name = f"{stem}_{counter}{ext}"
                    counter += 1

            persistent_path = os.path.join(persistent_log_dir, safe_name)
            try:
                shutil.copy2(file_path, persistent_path)
                used_persistent_names.add(safe_name)
                all_log_txt_trace_csv_persistent.append((persistent_path, attach_info))
            except Exception as e:
                logging.warning(
                    "Failed to copy file to persistent_logs (source=%r, dest=%r): %s",
                    file_path,
                    persistent_path,
                    e,
                )
                all_log_txt_trace_csv_persistent.append((file_path, attach_info))

    # Save combined index — log_file_analyzer.py reads this via log_utils
    json_path = os.path.join(workspace, 'all_log_txt_trace_csv_files.json')
    try:
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(
                [{'file_path': fp, 'attach_info': ai} for fp, ai in all_log_txt_trace_csv_persistent],
                f, indent=2
            )
    except Exception as e:
        logging.error(f"Failed to save {json_path}: {e}")

    # Split for downstream consumers
    all_log_txt_trace_files_persistent = [
        (p, a) for p, a in all_log_txt_trace_csv_persistent if not p.lower().endswith('.csv')
    ]
    all_csv_files_persistent = [
        (p, a) for p, a in all_log_txt_trace_csv_persistent if p.lower().endswith('.csv')
    ]

    logging.debug("PHASE 4: CALLING log_file_analyzer FOR .LOG, .TXT, AND .TRACE FILES")

    # Print out attachment and their info
    print(f"\nAttachment Analysis:")
    print("-" * 80)
        

    print(f"\n1. ETL Analysis:")
    print("-" * 80)

    for attachment_name, attachment_info in attachment_results.items():
        print(f"Attachment name : {attachment_name}")
        pprint.pprint(f"Attachment info : {attachment_info}")
        print("-" * 80)

    logging.debug("PROCESSING COMPLETE")
    
    # Print pipe underrun summary
    if pipe_underrun_files:
        print(f"\n2. Pipe Underrun Analysis:")
        print(f"Found pipe underrun in {len(pipe_underrun_files)} ETL file(s):")
        print("-" * 80)
        
        for underrun_file in pipe_underrun_files:
            print(f"Attachment: {underrun_file['attachment']}")
            print(f"ETL File:   {underrun_file['file']}")
            print("-" * 40)
    else:
        print("\nPipe Underrun Analysis: No pipe underrun detected in any ETL files")

    # Print final summary with driver info
    if driver_versions_found:
        unique_combinations = set((d['build_type'], d['version'], d['build_date']) for d in driver_versions_found)
        
        print(f"\n3. Graphics Driver Analysis:")
        print(f"Found {len(unique_combinations)} different driver configuration(s) in {len(driver_versions_found)} trace(s):")
        print("-" * 80)
        
        for build_type, version, build_date in sorted(unique_combinations):
            files = [d['file'] for d in driver_versions_found 
                    if d['build_type'] == build_type and d['version'] == version and d['build_date'] == build_date]
            build_info = next((d['build_string'] for d in driver_versions_found 
                              if d['build_type'] == build_type and d['version'] == version and d.get('build_string')), None)
            
            print(f"Driver Build Type: {build_type}")
            print(f"Driver Version:    {version}")
            print(f"Driver Build Date: {build_date}")
            if build_info:
                print(f"Build String:      {build_info}")
            print(f"Files:             {len(files)} file(s)")
            
            for file in files:
                print(f"  - {file}")
            print()  
    else:
        print("\nGraphics Driver Information: Not found")


    # Build new attachment structure
    attachment_info_structure = build_attachment_structure(
        attachments, attachment_results, driver_versions_found,
        pipe_underrun_files, all_etl_files, all_log_txt_trace_files_persistent,
        all_csv_files=all_csv_files_persistent
    )


    # Combined output with new structure
    combined_output = {
        "attachment_info": attachment_info_structure,
        "summary": {
            "total_attachments": len(attachments),
            "file_type_counts": {
                "etl_files": len(all_etl_files),
                "log_files": len(all_log_files),
                "txt_files": len(all_txt_files),
                "trace_files": len(all_trace_files),
                "csv_files": len(all_csv_files_persistent)
            }
        }
    }

    output = json.dumps(combined_output, indent=2)
    print(f"The content of attachment_info_file is : {output}")

    file_output = os.path.join(os.environ['GNAI_TEMP_WORKSPACE'], f'{attachment_info_file}')

    try:
        with open(file_output, 'w', encoding='utf-8') as f:
            f.write(output)
            print(f'[SUCCESS] sighting_check_attachments Tool was executed successfully for file {attachment_info_file} and the output is at {file_output}')
            attachment_info_file = file_output
            print(f"attachment_info file is : {attachment_info_file}")
    except FileNotFoundError:
        print(f'[ERROR] Directory path does not exist: {os.path.dirname(file_output)}')
    except PermissionError:
        print(f'[ERROR] Permission denied when writing to file: {file_output}')
    except OSError as e:
        print(f'[ERROR] OS error occurred while writing file {file_output}: {e}')
    except UnicodeEncodeError as e:
        print(f'[ERROR] Unicode encoding error while writing to {file_output}: {e}')
    except Exception as e:
        print(f'[ERROR] Unexpected error occurred while writing to {file_output}: {e}')
