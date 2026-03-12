"""
1.Base classes for log processors

This module provides the abstract base class for all log processors.
Designed to be extensible for different log types (GOP, system logs, performance logs, etc.).

2.Utility functions for merging log analysis results

This module provides utilities to merge various types of log analysis results
into the attachment_info_file for state maintenance across different log processors.

Supported log types:
- GOP (Graphics Output Protocol) logs
- Burnin Test logs
- Future log types can be easily added
"""

from abc import ABC, abstractmethod
from typing import Dict, Tuple, List, Optional
import json
import tempfile
import os
import logging

class LogProcessor(ABC):
    """Abstract base class for log processors."""
    
    @abstractmethod
    def detect_log_type(self, file_path: str) -> Tuple[bool, str]:
        """
        Detect if the file is of this log type.
        
        Args:
            file_path (str): Path to the log file (.txt, .log, or .trace)
            
        Returns:
            Tuple[bool, str]: (is_this_log_type, reason/detection_info)
        """
        pass
    
    @abstractmethod
    def process_log(self, file_path: str) -> Dict:
        """
        Process the log file and return results.
        
        Args:
            file_path (str): Path to the log file (.txt, .log, or .trace)
            
        Returns:
            Dict: Dictionary containing parsed results and analysis
        """
        pass

    def _handle_generic_processing_result(
        self,
        attach_name: str,
        data: Dict,
        attachment_results: Dict,
        analysis_results: List,
        result_key: str,
        log_display: str,
    ) -> None:
        """
        Generic handler for successful or failed processing results.

        This centralizes common logic used by different log processors and can be
        reused by other processors (e.g. GOP, Burnin) by passing the appropriate
        result_key and log_display values.
        """
        import os
        if data and result_key in data and 'error' not in data:
            analysis_results.append(data)
            file_name = os.path.basename(data.get('file_path', 'Unknown'))
            if result_key == 'pattern_matches':
                # GOP-specific message
                attachment_results[attach_name].append(
                    f"{file_name} : {log_display} processed successfully"
                )
            else:
                # Generic message with event count
                event_count = len(data.get(result_key, {}).get('events', []))
                attachment_results[attach_name].append(
                    f"{file_name} : {log_display} processed successfully ({event_count} events)"
                )
        elif data and 'error' in data:
            error_msg = data.get('error', 'Unknown error')
            file_name = os.path.basename(data.get('file_path', 'Unknown'))
            attachment_results[attach_name].append(
                f"{file_name} : {log_display} Processing Failed - {error_msg}"
            )

    def _handle_common_processing_error(
        self,
        log_prefix: str,
        file_path: str,
        attach_info: Dict,
        error: Exception,
        attachment_results: Dict,
    ) -> None:
        """
        Generic handler for processing exceptions.

        This centralizes exception handling so other processors can reuse it by
        providing their own log_prefix (e.g. "GOP", "BURNIN").
        """
        file_name = os.path.basename(file_path)
        attach_name = attach_info.get('document.file_name', 'Unknown')
        attachment_results[attach_name].append(
            f"{file_name} : Processing exception - {str(error)}"
        )
        logging.error(f"[{log_prefix}] Exception processing {file_name}: {str(error)}")

def load_all_log_txt_files_from_temp():
    """Load all_log_txt_files structure from temporary JSON file created by check_attachments.py
    
    Note: Despite the function name containing 'txt', this loads .txt, .log, and .trace files.
    """
    
    current_workspace = os.environ.get('GNAI_TEMP_WORKSPACE', '.')
    
    # Try to find the temp file in common locations
    possible_paths = [
        os.path.join(current_workspace, 'all_log_txt_files.json'),  # Current workspace
        'all_log_txt_files.json',  # Current directory
        os.path.join(tempfile.gettempdir(), 'all_log_txt_files.json')  # System temp
    ]
    
    logging.debug(f"Searching for JSON file in {len(possible_paths)} locations:")
    for path in possible_paths:
        logging.debug(f"- {path} (exists: {os.path.exists(path)})")
    
    for temp_file_path in possible_paths:
        if os.path.exists(temp_file_path):
            try:
                with open(temp_file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Convert back to the tuple format
                all_log_txt_files = []
                for item in data:
                    file_path = item['file_path']
                    attach_info = item['attach_info']
                    
                    if os.path.exists(file_path):
                        all_log_txt_files.append((file_path, attach_info))
                    else:
                        logging.debug(f"File not found: {file_path}")
                
                logging.debug(f"Loaded {len(all_log_txt_files)} accessible files from JSON: {temp_file_path}")
                return all_log_txt_files
                
            except Exception as e:
                logging.debug(f"Error loading from {temp_file_path}: {e}")
                continue
    
    logging.debug("No all_log_txt_files data found. Run check_attachments.py first.")
    return []

def merge_log_results_to_attachment_info(
    log_type: str,
    log_results: List[Dict],
    workspace: Optional[str] = None,
    attachment_info_filename: str = 'attachment_info_file'
) -> bool:
    """
    Merge log analysis results into the attachment_info_file.
    
    Args:
        log_type (str): Type of log analysis ('gop', 'burnin', 'future_log_type', etc.)
        log_results (List[Dict]): List of log analysis results to merge
        workspace (str, optional): Workspace directory path. Defaults to GNAI_TEMP_WORKSPACE env var
        attachment_info_filename (str): Name of the attachment info file
        
    Returns:
        bool: True if merge was successful, False otherwise
    """
    
    if workspace is None:
        workspace = os.environ.get('GNAI_TEMP_WORKSPACE', '.')
    
    attachment_info_file_path = os.path.join(workspace, attachment_info_filename)
    
    if not os.path.exists(attachment_info_file_path):
        logging.error(f"attachment_info_file not found at {attachment_info_file_path}")
        return False
    
    try:
        # Read existing attachment_info_file
        with open(attachment_info_file_path, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
        
        # Check the structure - it should have 'attachment_info' at root level
        if 'attachment_info' not in existing_data:
            logging.error("Invalid attachment_info_file structure - missing 'attachment_info' key")
            return False
        
        # Merge based on log type - pass the entire data structure
        success = _merge_by_log_type(existing_data, log_type, log_results)
        
        if success:
            # Write back the merged data
            with open(attachment_info_file_path, 'w', encoding='utf-8') as f:
                json.dump(existing_data, f, indent=2)
            
            logging.info(f"Successfully merged {len(log_results)} {log_type} analysis results into {attachment_info_file_path}")
            return True
        else:
            logging.error(f"Failed to merge {log_type} results - unsupported log type or merge error")
            return False
            
    except json.JSONDecodeError as e:
        logging.error(f"Failed to parse attachment_info_file JSON: {e}")
        return False
    except Exception as e:
        logging.error(f"Failed to merge {log_type} results into attachment_info_file: {e}")
        return False

def _merge_by_log_type(data: Dict, log_type: str, log_results: List[Dict]) -> bool:
    """
    Merge log results based on the log type.
    
    Args:
        data (Dict): The entire attachment_info_file data structure
        log_type (str): Type of log analysis
        log_results (List[Dict]): Log analysis results to merge
        
    Returns:
        bool: True if merge was successful, False otherwise
    """
    
    log_type = log_type.lower()
    
    if log_type == 'gop':
        return _merge_gop_results(data, log_results)
    elif log_type == 'burnin':
        return _merge_burnin_results(data, log_results)

    #elif log_type == 'other':
        #return _merge_other_log_results(data, log_results)
    ## TO-DO
    ## Add more log types here as needed
    else:
        logging.warning(f"Unsupported log type: {log_type}")
        return False

def _merge_gop_results(data: Dict, gop_results: List[Dict]) -> bool:
    """Merge GOP analysis results into the attachment structure.
    
    Note: GOP logs are only found in .txt and .log files, never in .trace files.
    """
    try:
        if 'attachment_info' not in data:
            logging.error("No attachment_info found in data")
            return False
        
        attachment_info = data['attachment_info']
        
        for gop_result in gop_results:
            file_path = gop_result['file_path']
            
            # Extract original filename (remove ID prefix if present)
            file_name = os.path.basename(file_path)
            if '_' in file_name:
                parts = file_name.split('_', 1)
                if len(parts) > 1 and parts[0].isdigit():
                    file_name = parts[1]
            
            # Find the attachment and file in the structure
            merged = False
            for attachment_name, attachment_data in attachment_info.items():
                
                if attachment_data['attachment_type'] == 'archive':
                    sub_attachments = attachment_data.get('sub_attachments', {})
                    
                    if file_name in sub_attachments:
                        file_data = sub_attachments[file_name]
                        
                        # Update log_info with GOP results
                        if 'log_info' in file_data:
                            file_data['log_info'] = {
                                'log_type': 'gop_log',
                                'log_analysis_results': {
                                    'gop_version': gop_result['gop_version'],
                                    'pattern_matches': gop_result['pattern_matches']
                                }
                            }
                            merged = True
                            break
                        # Convert txt_info to log_info for GOP logs (GOP can be in .txt files)
                        elif 'txt_info' in file_data:
                            file_data['log_info'] = {
                                'log_type': 'gop_log',
                                'log_analysis_results': {
                                    'gop_version': gop_result['gop_version'],
                                    'pattern_matches': gop_result['pattern_matches']
                                }
                            }
                            del file_data['txt_info']
                            merged = True
                            break
                
                elif attachment_data['attachment_type'] == 'direct_file':
                    if attachment_name == file_name:
                        if 'log_info' in attachment_data:
                            attachment_data['log_info'] = {
                                'log_type': 'gop_log',
                                'log_analysis_results': {
                                    'gop_version': gop_result['gop_version'],
                                    'pattern_matches': gop_result['pattern_matches']
                                }
                            }
                            merged = True
                            break
                        elif 'txt_info' in attachment_data:
                            attachment_data['log_info'] = {
                                'log_type': 'gop_log',
                                'log_analysis_results': {
                                    'gop_version': gop_result['gop_version'],
                                    'pattern_matches': gop_result['pattern_matches']
                                }
                            }
                            del attachment_data['txt_info']
                            merged = True
                            break
            
            if not merged:
                logging.warning(f"Could not find location to merge GOP result for file: {file_name}")
        
        # Update file_type_counts in summary to include GOP files
        if 'summary' in data and 'file_type_counts' in data['summary']:
            data['summary']['file_type_counts']['gop_files'] = len(gop_results)
        
        return True
        
    except Exception as e:
        logging.error(f"Error merging GOP results: {e}")
        return False

def _merge_burnin_results(data: Dict, burnin_results: List[Dict]) -> bool:
    """Merge Burnin analysis results into the attachment structure.
    
    Note: Burnin logs are primarily found in .trace files, but can also be in .txt/.log files.
    """
    
    def _update_file_data_with_burnin_result(file_data: Dict, burnin_result: Dict):
        """Helper function to update file_data with burnin results, converting any info type to log_info."""
        # Update or convert to log_info with Burnin results
        for info_key in ['log_info', 'txt_info', 'trace_info']:
            if info_key in file_data:
                file_data['log_info'] = {
                    'log_type': 'burnin_test',
                    'log_analysis_results': burnin_result.get('burnin_result', {})
                }
                # Remove old info key if it was txt_info or trace_info
                if info_key != 'log_info':
                    del file_data[info_key]
                return True
        return False
    
    try:
        if 'attachment_info' not in data:
            logging.error("No attachment_info found in data")
            return False
        
        attachment_info = data['attachment_info']
        
        for burnin_result in burnin_results:
            file_path = burnin_result['file_path']
            
            # Extract original filename (remove ID prefix if present)
            file_name = os.path.basename(file_path)
            if '_' in file_name:
                parts = file_name.split('_', 1)
                if len(parts) > 1 and parts[0].isdigit():
                    file_name = parts[1]
            
            # Find the attachment and file in the structure
            merged = False
            for attachment_name, attachment_data in attachment_info.items():
                
                if attachment_data['attachment_type'] == 'archive':
                    sub_attachments = attachment_data.get('sub_attachments', {})
                    
                    if file_name in sub_attachments:
                        file_data = sub_attachments[file_name]
                        if _update_file_data_with_burnin_result(file_data, burnin_result):
                            merged = True
                            break
                
                elif attachment_data['attachment_type'] == 'direct_file':
                    if attachment_name == file_name:
                        if _update_file_data_with_burnin_result(attachment_data, burnin_result):
                            merged = True
                            break
            
            if not merged:
                logging.warning(f"Could not find location to merge Burnin result for file: {file_name}")
        
        # Update file_type_counts in summary to include Burnin files
        if 'summary' in data and 'file_type_counts' in data['summary']:
            data['summary']['file_type_counts']['burnin_files'] = len(burnin_results)
        
        return True
        
    except Exception as e:
        logging.error(f"Error merging Burnin results: {e}")
        return False
