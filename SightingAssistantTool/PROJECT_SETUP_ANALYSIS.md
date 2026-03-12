# SightingAssistantTool 環境建置與架構分析報告

日期: 2026-03-12

## 1. 任務完成摘要

- 已完成專案分析（架構、功能、使用方式）
- 已建立 Python 虛擬環境並安裝 toolkit 主要依賴
- 已完成 CLI smoke test（本地 Python CLI 可正常啟動）
- 已確認目前無法直接驗證 `dt gnai` 流程，原因是本機缺少 `dt` 指令

## 2. 使用環境安裝結果

### 2.1 Python 環境

- 虛擬環境位置: `.venv`
- Python 版本: `3.14.0`

### 2.2 依賴來源

依照 `toolkit.yaml` 的 Python requirements 安裝:

- `requests`
- `requests-kerberos==0.15.0` (Windows)
- `py7zr`
- `rich`

### 2.3 已安裝套件（關鍵）

已確認安裝成功:

- requests 2.32.5
- requests-kerberos 0.15.0
- py7zr 1.1.0
- rich 14.3.3

以及相依套件（例）:

- cryptography 46.0.5
- pyspnego 0.12.1
- urllib3 2.6.3

### 2.4 安裝時注意事項

初次安裝曾遇到 PyPI timeout，後續使用 proxy 參數成功安裝:

```powershell
.\.venv\Scripts\python.exe -m pip install --proxy http://proxy-png.intel.com:912 --extra-index-url https://pypi.org/simple/ requests py7zr rich "requests-kerberos==0.15.0"
```

## 3. 程式架構（高層）

此專案是 GNAI toolkit，核心是以 `assistants/sighting_assistant.yaml` 編排多個工具（YAML）與 Python 腳本。

### 3.1 主要目錄

- `assistants/`
  - assistant 定義（主要為 `sighting_assistant.yaml`）
- `tools/`
  - 每個工具的 YAML（command tool / agent tool）
- `src/`
  - Python 實作（HSD API、附件分析、ETL/GOP 分析、Sherlog、DisplayDebugger）
- `assets/`
  - 架構圖
- `accuracy_test/`
  - 測試與驗證資料

### 3.2 核心流程（2 階段）

1. Phase 1: Data Gathering
   - 讀 HSD 文章
   - 抓附件並分析 ETL/log/txt/trace
   - 分類 issue 類別
   - 必要時觸發 Sherlog / GOP / DisplayDebugger
2. Phase 2: Analysis
   - Mandatory DFD Analyzer
   - Category 對應的 BKM Tool
   - Similarity Search

### 3.3 關鍵模組

- `src/hsdes.py`
  - 對接 HSDES REST API（article、attachments、comments、similarity）
- `src/read_article.py`
  - 讀取 HSD 內容並輸出 `hsd_info_file`
- `src/check_attachments.py`
  - 附件下載、解壓、ETL/LOG/TXT/TRACE 掃描、ETL 分類與 driver 資訊彙整
- `src/etl_classifier.py`
  - 呼叫 `tracefmt.exe` + manifests 分析 ETL 類型與 driver/pipe underrun
- `src/log_file_analyzer.py`
  - GOP/Burnin log 分析引擎
- `src/displaydebugger_subprocess.py`
  - 呼叫 displaydebugger toolkit，支援 ETL/GOP 自動偵測
- `src/sherlog_subprocess.py`
  - 針對 GDHM dump 觸發 sherlog 分析流程
- `src/similarity_search.py`
  - 呼叫 HSD similarity API 查詢相似案例

## 4. 功能說明（你最常會用到）

1. HSD 單號分析
   - 輸入 HSD ID，產生摘要、分類、附件檢查與建議
2. 附件完整性與可用性檢查
   - 依 issue 類別判斷必須檔案是否齊全
3. ETL/GOP 自動解析
   - ETL 類型辨識、driver version/build date、pipe underrun 偵測
4. Sherlog / DisplayDebugger 整合
   - 自動串接工具做 dump 與顯示問題分析
5. Similarity Search
   - 回傳相似 HSD 供 triage 參考

## 5. 使用方式

### 5.1 本地 Python 執行（開發/除錯）

```powershell
Set-Location .\SightingAssistantTool
.\.venv\Scripts\Activate.ps1

# 看 CLI 說明（可用）
python .\src\log_file_analyzer.py --help

# 測試 sherlog_subprocess 入口（未帶 GDHM ID 時會回傳 JSON error）
python .\src\sherlog_subprocess.py
```

### 5.2 GNAI 正式使用流程（需要 dt CLI）

依專案 README:

```powershell
dt extensions enable gnai
dt gnai toolkits register .
dt gnai ask "Please assist with the HSD id 14025723680"
```

## 6. 測試結果（CLI）

### 6.1 已通過

1. `python .\src\log_file_analyzer.py --help`
   - 正常輸出 usage 與參數（`{gop,burnin}`）
2. `python .\src\sherlog_subprocess.py`
   - 正常執行並輸出 JSON: `{"error": "No valid GDHM IDs found"}`
3. `python .\\src\\log_file_analyzer.py gop`
  - 可進入主流程並輸出合法 JSON: `{"gop_analysis_results": []}`

### 6.2 目前阻塞

1. `dt --version`
   - 系統回報 `dt` 指令不存在
   - 因此目前無法在此機器完成 `dt gnai ask ...` 的端到端驗證

## 7. 結論

- 專案 Python 執行環境已建置完成，核心依賴已安裝。
- 本地 CLI 入口可正常啟動，基本 smoke test 通過。
- 若要完成完整 GNAI CLI 驗證，需先在此機器安裝並可使用 `dt` 指令。
