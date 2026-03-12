# Sighting Assistant Tool


## Introduction

The Sighting Assistant Tool is a  [GNAI Toolkit](https://gpusw-docs.intel.com/services/gnai/developer/toolkits/) to enable Graphics Debug Engineers to accelerate issue resolution, gain deeper insights, and begin the debug process with a stronger starting point.


**Key Capabilities:**
- AI-powered HSD ID analysis and guidance for issue isolation
- Automated validation of HSD sightings to ensure required logs and traces are included based on sighting type
- Intelligent categorization and analysis of logs
- Seamless integration with existing GNAI toolkits/workflows such as Sherlog.


## Architecture Overview (Current Implementation)

![Architecture Diagram](./assets/SAT_Diagram_v1.svg) 


---

## Installation Guide


### Setup Steps

1. **Enable the extension**
   ```bash
   dt extensions enable gnai
   ```
2. **Clone the repository**
   ```bash
   git clone https://github.com/intel-sandbox/SightingAssistantTool.git sighting
   ```
3. **Navigate to the directory**
   ```bash
   cd sighting
   ```
4. **Register the toolkit**
   ```bash
   dt gnai toolkits register .
   ```

5. **Installation complete!**


### Verify installation (Optional)
   Run the command below and confirm that the sighting toolkit appears as registered and valid.
   ```bash
   dt gnai toolkits validate <sighting_toolkit_path>  
   ```
  

## Usage
   ```bash
   dt gnai ask "Please assist with the HSD id 14025723680"
   ```

## Debugging
Enable verbose output by adding the -v flag to see Python script details:

   ```bash
   dt gnai ask "Please assist with the HSD id 14025723680" -v
   ```


## Troubleshooting

### Pip Install Failure from Internal Repository

If `dt gnai toolkits register .` fails due to internal repository issues:

**Solution:** Add the following configuration to `%AppData%\pip\pip.ini`:

```ini
[global]
proxy = http://proxy-png.intel.com:912
extra-index-url = https://pypi.org/simple/
```


### Error: "Error Removing Python toolkit"

**Error Message:**
Error cleaning python-site-packages: Error removing python-site-packages: open \.gnai\toolkits\applications.ai.gnai.toolkits.server-hsdes\hsdes\.workspace\tools\python-site-packages\annotated_types: Access is denied.

**Solution:**
Manually delete the annotated_types folder at the path specified in the error message.


## **Additional Resources**
- [Sighting Assistant Tool Wiki](https://wiki.ith.intel.com/spaces/DgfxE2E/pages/4242651731/Sighting+Assistant+Tool+Requirement+Spec) 
