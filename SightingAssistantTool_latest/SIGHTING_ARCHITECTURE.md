# Sighting Assistant Tool  Architecture & Requirements

This document describes the architecture, requirements status, and runtime internals of the **SightingAssistantTool** GNAI local toolkit.

> For GNAI framework guidelines, naming conventions, and YAML schemas, see [CLAUDE.md](CLAUDE.md).
> Source: Intel Confluence  *Sighting Assistant Tool Requirement Spec.*

---

## 1. Introduction

Sighting Assistant Tool is a [GNAI Toolkit](https://gpusw-docs.intel.com/services/gnai/) that combines enterprise-grade LLMs (GPT, Claude) with Intel's internal knowledge sources  documentation, wikis, bspecs  and integrates with HSD-ES to enable Graphics Debug Engineers to accelerate issue resolution, gain deeper insights, and begin the debug process with a stronger starting point.

**Repository:** [intel-sandbox/SightingAssistantTool](https://github.com/intel-sandbox/SightingAssistantTool)

---

## 2. Target User

**Graphic Debug Engineer**

---

## 3. User Scenarios

1. Ask Sighting Assistant to analyze an issue and provide guidance for issue isolation.
2. Ask Sighting Assistant to read an HSD query (e.g. all 999 issues) and check whether the sighting includes required logs and traces depending on the type of sighting.

```bash
dt gnai ask "What is the summary of HSD id 15018275324" --assistant sighting_assistant
```

---

## 4. Requirements Status

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Read article from HSD | DONE |
| 2 | Read query from HSD (HSD-ES API) | TBD |
| 3 | Categorize issue from title, description, repo steps, comments | ONGOING |
| 4 | Analyze attachments and comments for required logs | ONGOING |
| 4a | ETL log analysis (Display ETL, Boot Trace, WPT, GPUView) | DONE |
| 4b | GOP log analysis | DONE |
| 4c | BSOD/TDR dump analysis via Sherlog | DONE |
| 4d | SNS results.csv analysis via GATS portal API | TBD |
| 4e | Triage Checklist compliance check | TBD |
| 4f | GVE Errata/Expected Behavior reference | TBD |
| 4g | Differentiate log type and update HSD description field | DONE |
| 4h | Display Debugger integration (GOP + ETL) | DONE |
| 4i | MeAna tool integration (GPUView logs) | TBD |
| 4j | Dispdiag tool integration (Dispdiag.dat) | TBD |
| 4k | PTAT Monitor CSV analysis | DONE |
| 4l | GfxPnp (GTMetrics) CSV analysis | DONE |
| 5 | Provide analysis result and suggestion | DONE |
| 6 | Prompt triage BKM to user according to issue type, post on HSD | ONGOING |

---

## 5. Issue Categories

sighting_get_category classifies issues into one of:

  Display, Display Audio, Gaming, Media, Content Protection, Performance,
  Corruption, BSOD, TDR, Underrun, App Crash, Hard Hang, Black Screen,
  Yellow Bang, WHQL, IGCC/IGS/ARC, GOP, DPMO, Installer, AI

Category is used to construct the category-specific RAG query in Phase 2 (see Section 7).

---

## 6. High-Level Tool Execution Flow

```
User: "Analyze HSD 14026871374"
         |
         v
+---------------------------------------------+
|          PHASE 1 - Data Gathering           |
|                                             |
|  1. sighting_read_article                   |
|     writes -> hsd_info_file                 |
|  2. sighting_attachments                    |
|     writes -> attachment_info_file          |
|               all_log_txt_trace_csv_files.json |
|               extracted_*/                  |
|               persistent_logs/              |
+--------------------+------------------------+
                     |
                     v
+---------------------------------------------+
|          PHASE 2 - Analysis                 |
|                                             |
|  3. sighting_get_category                   |
|     reads -> hsd_info_file                  |
|             + attachment_info_file          |
|  4. sighting_rag_search (Mandatory DFD)     |
|     query: MANDATORY_CHECKLIST_QUERY        |
|     profile: gpu-debug                      |
|  5. sighting_rag_search (Category BKM)      |
|     query: BKM_QUERY({Category}, issue)     |
|     profile: gpu-debug                      |
|  6. [if GOP filename indicators found]      |
|     sighting_gop_analyzer                   |
|     pre: log_file_analyzer.py               |
|  7. sighting_similarity_search              |
|  8. [if display logs found]                 |
|     sighting_displaydebugger                |
|     → intelligent analysis_focus from HSD   |
|  9. [if burnin logs found]                  |
|     sighting_burnin_log_analyzer            |
|  10. [if GDHM IDs found]                    |
|     sighting_sherlog_sync                   |
|  11. [if PTAT Monitor CSV found]            |
|     sighting_ptat_analyzer                  |
|     pre: log_file_analyzer.py ptat          |
|  12. [if GTMetrics CSV found]               |
|     sighting_gfxpnp_analyzer                |
|     pre: log_file_analyzer.py gfxpnp        |
+--------------------+------------------------+
                     |
                     v
           Structured 7-Section Report
```

---

## 7. Category to RAG BKM Routing

The assistant no longer routes to category-specific static BKM tools. Instead, it builds `BKM_QUERY` using detected category and main issue text, then invokes `sighting_rag_search` with `profile=gpu-debug`.

| Category Group | RAG Behavior |
|---------------|--------------|
| Any supported category from Section 5 | Build category-aware `BKM_QUERY` and fetch log-collection BKM guidance from DFD-related wiki content |
| Unknown / low-confidence category | Use fallback category text and still query via `sighting_rag_search` |

---

## 8. Detailed Technical Flow

### 8.1 Step 1 - Read Article from HSD-ES

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_read_article.yaml |
| Type | Command Tool |
| Script | src/read_article.py |
| Output | hsd_info_file in GNAI_TEMP_WORKSPACE |

Fetches HSD data fields and comments via HSD-ES API. Output is a JSON structure containing submitted_by, title, comments[], and all article fields. Current scope: single article. Planned: query-based bulk fetching.

---

### 8.2 Step 2 - Issue Categorization

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_get_category.yaml |
| Type | Agent Tool |
| Context | hsd_info_file |
| Output | category parameter for Step 3 |

Classifies into one of the 20 categories in Section 5. Used in Step 3 to determine expected attachment types.

---

### 8.3 Step 3 - Attachment Analysis

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_attachments.yaml |
| Script | src/check_attachments.py |
| Output | attachment_info_file, all_log_txt_trace_csv_files.json, extracted_*/, persistent_logs/ |

#### Wave-1: Parsing / Processing of Logs

Processing phases in order:
1. HSD API Call  hsd.get_attachments_list(hsd_id)
2. Basic Info Display  numbered list of all attachments pending analysis
3. Logging Setup  initialize debug logging
4. Parallel Download  ThreadPoolExecutor (8 workers) with duplicate detection
5. Archive Extraction  unpacks 7z and zip; categorizes into ETL / LOG / TXT
6. Analysis  driver info extraction, ETL classification, pipe underrun detection
7. Shared Index  populates all_log_txt_trace_csv_files.json; copies to persistent_logs/ with <attachment_id>_ prefix
8. GOP Processing  detects and parses GOP logs; merges results back into attachment structure
9. Output  dumps to attachment_info_file in GNAI_TEMP_WORKSPACE

If a ZIP contains multiple log types, description uses semicolons: 'Display ETL;GOP'

#### Wave-2: Attachment Sufficiency Decision

Determines whether correct log types are present for the identified issue category.

---

#### A. ETL Log Analysis

Script: src/etl_classifier.py

ETL Classification (priority-based pattern matching):

| Type | Detection Logic |
|------|----------------|
| BootTrace | Contains DxgkDdiStartDevice  early exit |
| WPT | Intel Graphics + Media patterns |
| Display ETL | Intel Graphics patterns only |
| GPUView | Media patterns only |
| Unknown | No significant patterns |

Driver Information Extracted:

| Field | Method |
|-------|--------|
| Build Type: Release | BuildString contains "(R)" |
| Build Type: Release Internal | BuildString contains "RI" |
| Version (Release) | From Version field |
| Version (RI) | Parsed from BuildString |
| Build Date | From Version field (date,version format) |
| Pipe Underrun | DispPipeUnderRun pattern matching |

Performance features: 1MB chunked processing, early exit for boot traces, content-hash caching, ProcessPoolExecutor with ThreadPoolExecutor fallback.

Manifests: src/manifests/  .man files passed to tracefmt.exe to decode binary ETL event data.

---

#### B. GOP Log Analysis

Script: src/log_file_analyzer.py

Classes:
- LogProcessor  abstract base class
- GOPLogProcessor  GOP log detection and parsing

Version Detection:

| GOP Version | Patterns |
|-------------|----------|
| New GOP | [IntelGOP], [InteluGOP], [IntelPEIM]  version from PeiGraphicsEntryPoint |
| Old GOP | [INFO] patterns  version from PreMem PEI Module |

Key Metrics Extracted (40+ pattern types):

| Metric | Detail |
|--------|--------|
| Link Training Status | Full Link Training (FLT) and Fast Link Training success/failure |
| Clock Recovery (CR) | Cycles, status, same_req |
| Channel Equalization (EQ) | Cycles, status, performance metrics |
| Display Mode Setting | Resolution (X/Y), pipe, Display ID |
| Frame Buffer Config | Max vs calculated sizes (MB), occurrence count |
| T-Values | T3, T5, T8, T10, DPCD timeout (New GOP only) |
| Display Capabilities | Supported features, lane count |
| Display Status | Connected display + Display ID |
| Last Successful Config | Lane count, VSwing, Pre-emphasis (Old GOP only) |
| Event Grouping | CR -> EQ -> LT sequences |
| Display ID Decoding | Hex -> Port, Instance, Connector, Reserved |

---

#### C. GDHM BSOD/TDR Dumps via Sherlog

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_sherlog_sync.yaml |
| Script | src/sherlog_subprocess.py |
| Repo | intel-innersource/drivers.gpu.core.sherlog-toolkit |

Invoked when GDHM dump IDs are found. Extracts all GDHM IDs (10-digit numbers, GDHM URLs, "GDHM dump X", "dump ID: X") from article content and runs Sherlog per ID.

---

#### D. DisplayDebugger Analysis (GOP + ETL Deep Analysis)

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_displaydebugger.yaml |
| Type | Command Tool |
| Script | src/displaydebugger_subprocess.py |
| Repo | intel-sandbox/displaydebugger |
| Integration | Subprocess (`gnai ask --assistant=displaydebugger`) |

Invoked when display-related logs (GOP or ETL) are found in attachments AND the HSD describes a display-related issue. The sighting_assistant constructs an **intelligent analysis_focus** based on HSD context:

| HSD Issue Pattern | analysis_focus Constructed |
|-------------------|---------------------------|
| Display not detected | "display detection and initialization sequence" |
| Modeset failure | "modeset and timing configuration" |
| Link training error | "link training and display connectivity" |
| Hotplug issue | "hotplug detection and handling" |
| HDCP failure | "HDCP authentication and key exchange" |
| Power/sleep issue | "power state transitions and display power management" |
| EDID problem | "EDID reading and display information" |
| Type-C/Alt Mode | "Type-C and Alt Mode configuration" |
| Panel issue | "panel initialization and embedded display" |
| Output/signal issue | "display output and signal issues" |

**Log Type Detection:**
- GOP logs: `.txt`/`.log` files with "boot", "gop", "uefi", "preos", "bios" in filename
- ETL logs: `.etl`, `.7z`, `.zip` files or filenames containing "gfxtrace"

**Execution Model:**
- Opens a separate CMD window per log file (like sherlog)
- Uses `gnai ask --log-file=<path> --assistant=displaydebugger` for native output capture
- stdin stays connected — user can interact with follow-up prompts and HSD upload
- Uses `/wait` + `process.wait()` for deterministic completion detection
- Output saved to `.output/displaydebugger_{hsd_id}_{filename}_analysis.txt`

**Parameters:**
- `hsd_id` — HSD ID being analyzed
- `hsd_info_file` — path to HSD article info (optional)
- `attachment_info_file` — path to attachment info (optional)
- `log_files` — list of display log file paths
- `analysis_focus` — intelligent focus string constructed by the assistant

---

#### E. PTAT Monitor CSV Analysis

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_ptat_analyzer.yaml |
| Type | Agent Tool (run.pre + LLM prompt) |
| Script | src/log_file_analyzer.py ptat |
| Class | `PTATLogProcessor` |
| Required Params | `id` (HSD ID), `sighting_ptat_analyzer_output_file` (optional) |
| Trigger | CSV file with "PTATMonitor" or "ptat" in filename |

**Detection:** Reads CSV header; requires `Relative Time(mS)`, `Gfx Component-Current Slice-Gfx Frequency(MHz)`, and `Turbo Parameters-Gt Clip Reason` columns.

**Key Metrics Extracted:**

| Metric | Detail |
|--------|--------|
| GFX Frequency | min / max / avg MHz |
| GT Clip Events | Total count of rows with non-empty clip reason values |
| Unique Clip Reasons | Deduplicated set of clip reason strings |
| Duration | Total recording duration in seconds |
| Total Samples | Row count |
| Plot | Dark-themed multi-series PNG → `.output/PTAT_logs_plots/` (filename/header use HSD ID prefix) |

**Plot Series:** CPU P-Core/E-Core avg frequency, IA/GT/Package/Rest-of-Package power (watts). GT clip shown as binary (0/1) fill on a separate bottom subplot.

**Merged into attachment_info_file:** `ptat_analysis` key at top-level via `_merge_ptat_results()`.

---

#### F. GfxPnp (GTMetrics) CSV Analysis

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_gfxpnp_analyzer.yaml |
| Type | Agent Tool (run.pre + LLM prompt) |
| Script | src/log_file_analyzer.py gfxpnp |
| Class | `GfxPnpLogProcessor` |
| Required Params | `id` (HSD ID), `sighting_gfxpnp_analyzer_output_file` (optional) |
| Trigger | CSV file with "GTMetrics" or "gfxpnp" in filename |

**Detection:** Reads CSV header; requires `Time[Sec]`, `RenderFreqEffective[MHz]`, `IaBias`, `RenderBias`, `MediaBias` columns.

**Key Metrics Extracted:**

| Metric | Detail |
|--------|--------|
| Column Stats | min / max / avg per column |
| Duration | Total recording duration in seconds |
| Total Samples | Row count |
| Plot | Dark-themed per-column subplots → `.output/GfxPnp_logs_plots/` (filename/header use HSD ID prefix) |

**Plot Series (one subplot each):** `RenderFreqEffective[MHz]` (cyan), `IaBias` (purple), `RenderBias` (red), `MediaBias` (orange). Average line overlay per subplot.

**Merged into attachment_info_file:** `gfxpnp_analysis` key at top-level via `_merge_gfxpnp_results()`.

---

### 8.4 Step 4 - Similar HSDs

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_similarity_search.yaml |
| Script | src/similarity_search.py |

Returns top 5 most similar past HSDs with confidence scores.

---

### 8.5 DFD Checklist and BKM Retrieval via RAG

| Field | Value |
|-------|-------|
| Tool YAML | tools/sighting_rag_search.yaml |
| Script | src/sighting_rag_search.py |
| Input Params | `search_query`, `profile`, `max_documents` |
| Profile Policy | Only `gpu-debug` profile is supported (hard-enforced). |

Execution behavior:
1. Query mandatory checklist with a deterministic `MANDATORY_CHECKLIST_QUERY`.
2. Query category/scenario guidance with deterministic `BKM_QUERY`.
3. Render Section 4 checklist table with columns `Checklist Item | Description | Yes/No`.
4. If retrieval is empty, emit explicit fallback rows rather than silently skipping Section 4.

---

### 8.6 Step 5 - Summary Generation and Final Output

| Section | Content |
|---------|---------|
| 1. Content Extraction & Summary | HSD details, attachments, GOP/PTAT/GfxPnp analysis, driver info, regression, RVP status |
| 2. Issue Classification | Category, confidence, reasoning |
| 3. Attachment Verification | Expected vs present vs missing, validity per category |
| 4. Suggestions as per DFD Checklist | DFD compliance table, BKM output, recommendations |
| 5. Triage & Troubleshooting Review | Comment analysis, pending actions, next steps |
| 6. Executive Summary & Recommendations | Priority, escalation, top 5 similar HSDs |
| 7. Technical Steps & Tool Invocation Log | Full tool trace, error recovery notes |

---

## 9. GNAI_TEMP_WORKSPACE Layout

GNAI creates a session-scoped temp directory at:
  %LOCALAPPDATA%\Temp\gnai-chat\<session-uuid>\

Observed layout (verified 2026-02-18):

```
$GNAI_TEMP_WORKSPACE/
 hsd_info_file                         <- sighting_read_article output
 attachment_info_file                  <- sighting_attachments output
 all_log_txt_trace_csv_files.json      <- index of all log/txt/trace/csv files
 messages.json                         <- GNAI internal - DO NOT TOUCH
 extracted_<attachment_id_1>/          <- named by attachment ID (numeric)
    SKU1-4 Burnin GPGPU FAIL/
        XiaoXin_14SE_..._2025_12_25.zip
 extracted_<attachment_id_2>/
    BIT_log.trace
    Bit_Gpgpu_Error.py
    IntError_2886.txt
    IntError_4070.txt
 persistent_logs/
  <attachment_id>_<filename_1>.txt  <- attachment id prefix prevents collisions
  <attachment_id>_<filename_2>.txt
  <attachment_id>_<filename_n>.txt
```

Naming Rules:
- extracted_<attachment_id>/  named by numeric HSD attachment ID, not filename
- persistent_logs/<attachment_id>_<original_filename>  prefix prevents name collisions
- messages.json  GNAI internal; tool scripts must never read or write this
- Workspace deleted when chat session ends

---

## 10. Tool Inventory

### Command Tools

| Tool YAML | Script | Purpose |
|-----------|--------|---------|
| sighting_read_article.yaml | src/read_article.py | Fetch HSD article + comments |
| sighting_attachments.yaml | src/check_attachments.py | Download, extract, classify attachments |
| sighting_sherlog_sync.yaml | src/sherlog_subprocess.py | Run Sherlog on GDHM dump IDs |
| sighting_displaydebugger.yaml | src/displaydebugger_subprocess.py | DisplayDebugger GOP + ETL deep analysis |
| sighting_similarity_search.yaml | src/similarity_search.py | Top-5 similar past HSDs |
| sighting_rag_search.yaml | src/sighting_rag_search.py | DFD mandatory checklist + category BKM retrieval via RAG |

### Agent Tools

| Tool YAML | Model | Purpose |
|-----------|-------|---------|
| sighting_gop_analyzer.yaml | claude-4-5-opus-thinking | Analyze GOP logs, structured table output. **Conditional:** only invoked when a `.log`/`.txt` filename contains GOP indicators (`gop`, `uefi`, `preos`, `bios`, `intelgop`, `intelugop`, `intelpeim`, `boot`). STC system trace logs never trigger this tool. |
| sighting_get_category.yaml |  | Classify issue category |

### Supporting Scripts

| Script | Used By | Purpose |
|--------|---------|---------|
| src/etl_classifier.py | check_attachments.py | ETL classification, driver info, pipe underrun |
| src/log_file_analyzer.py | sighting_gop_analyzer pre-step | GOP log detection and metric extraction |
| src/hsdes.py | All tools | HSD-ES API client (Kerberos auth, SSL bypass) |

---

## 11. Planned / Future Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| ~~Display Debugger~~ | ~~Deep GOP + ETL analysis~~ | **DONE** (see 8.3 D) |
| MeAna | Read GPUView logs | TBD |
| Dispdiag | Read Dispdiag.dat | TBD |
| GATS Portal API | SNS results.csv failure analysis | TBD |
| HSD query bulk read | Bulk triage of 999+ HSDs | TBD |
| JIRA MCP toolkit | Auto-post summary to JIRA / HSD | TBD |
| Triage Checklist (7.1) | Compliance check | TBD |

---

## 12. Known Limitations & Open Issues

| # | Issue | Status |
|---|-------|--------|
| 1 | console_output: "" on several tools silently drops errors | Open |
| 2 | No timeout: on sighting_sherlog_sync  may hit platform default | Open |
| 3 | sighting_gop_analyzer prompt uses non-standard {{.gop_analysis_results}} syntax | Open |
| 4 | RAG answer quality depends on wiki indexing quality and profile coverage (`gpu-debug`) | Open |
| 5 | Burnin log analyzer skill (SGQE-21307)  sub-agent cannot run Python, redesigned | PR #16 open |
| 6 | ~~Cross-toolkit transfer (Display Debugger)~~ | **DONE** — validated with `gnai --log-file` pattern |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| HSD | Hardware Sighting Document  Intel internal bug tracker |
| HSD-ES | HSD Enterprise System  API-accessible version |
| GDHM | Graphics Driver Hardware Module  crash dump format |
| GOP | Graphics Output Protocol  UEFI-level display firmware |
| ETL | Event Trace Log  Windows kernel-level trace file |
| WPT | Windows Performance Toolkit trace |
| GPUView | GPU activity trace viewer log format |
| DFD | Debug From Day-1  Intel GPU debug standard |
| BKM | Best Known Method  documented debug checklist |
| TDR | Timeout Detection and Recovery  GPU hang recovery |
| Sherlog | Intel internal tool for GDHM BSOD/TDR dump analysis |
| SNS | Silicon Needs System  validation results tracker |
| GATS | GPU Automated Test System portal |
| SAT | Sighting Assistant Tool (this toolkit) |

---

## 14. References

- GNAI Toolkit Docs: https://gpusw-docs.intel.com/services/gnai/
- HSD-ES API: https://wiki.ith.intel.com/display/HSDESWIKI/HSD-ES+API
- DFD Checklist: https://wiki.ith.intel.com/spaces/DgfxE2E/pages/4211708805
- Sherlog Toolkit: https://github.com/intel-innersource/drivers.gpu.core.sherlog-toolkit
- Display Debugger: https://github.com/intel-sandbox/displaydebugger
- E2E SNS: https://wiki.ith.intel.com/spaces/DgfxE2E/pages/4257710574/E2E+SNS
- 7.1 Triage Checklist: https://wiki.ith.intel.com/spaces/DgfxE2E/pages/4257710585/7.1+Triage+Checklist
- GVE Errata: https://wiki.ith.intel.com/spaces/PEGVPGGID/pages/1853443761
- GNAI MCP Toolkits: https://gpusw-docs.intel.com/services/gnai/developer/toolkits/

---

*Last updated: 2026-03-06*
