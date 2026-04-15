import os
import sys
from hsdes import HSDESAPI
import json
# Set UTF-8 encoding for output
sys.stdout.reconfigure(encoding='utf-8')

#hsd_info_file = os.environ['GNAI_INPUT_HSD_INFO_FILE']

hsd_info_file = "hsd_info_file" 

if __name__ == "__main__":
    hsd = HSDESAPI()
    # Retreiving only necessary fields.
    success, data_rows = hsd.read_article_by_id_select_fields(int(os.environ['GNAI_INPUT_ID']))
    comments = hsd.get_comments_list(int(os.environ['GNAI_INPUT_ID']))

    # write output to a file
    file_output = os.path.join(os.environ['GNAI_TEMP_WORKSPACE'], f'{hsd_info_file}')

    # Combined output
    combined_output = {
        "output": {
            "hsd_info_file" : file_output,
            "data_rows": data_rows,
            "comments": comments
        }
    }


    output = json.dumps(combined_output)
    #output = json.dumps(combined_output, indent=1)
    print(output)


    try:
        with open(file_output, 'w', encoding='utf-8') as f:
            f.write(output)
            #print(f"Hsd info file is : {hsd_info_file}")
            #print(f"file output is : {file_output}")
            #print(f'[SUCCESS]Sighting_read_article Tool was executed successfully for file {hsd_info_file} and the output is at {file_output}')
            hsd_info_file = file_output
            #print(f"Hsd info file is : {hsd_info_file}")
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
