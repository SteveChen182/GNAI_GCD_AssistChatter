# GNAI AssistChatter

> A Chrome Extension that brings Intel GNAI-powered GPU sighting analysis directly into your browser's side panel.

GNAI AssisChatter connects your Chrome browser to Intel's internal GNAI platform via a local Python bridge. It lets GPU debug engineers analyze Hardware Sighting Documents (HSD) without leaving their browser — just enter an HSD ID and get a structured AI-generated analysis report streamed back in real time.

---

## Features

- **HSD-focused analysis** — Import any HSD ID and lock the session to it. The assistant reads the article, checks attachments, classifies the issue, and generates a 7-section structured report.
- **Real-time streaming** — Responses are streamed token by token with a live progress indicator.
- **Auto bridge management** — The extension automatically detects whether the local bridge is running and launches it via Native Messaging if not.
- **Multi-turn conversation** — Each HSD session maintains its own `conversation_id`, supporting follow-up questions with full context.
- **Debug connection tool** — Built-in "Debug Connection" button in the side panel shows bridge health, ping result, and endpoint status.
- **Persistent font size** — User font preference is saved across sessions.

---

## Architecture

```
Chrome Side Panel (UI)
       ↕  chrome.runtime port
  background.js  (Service Worker)
       ↕  HTTP fetch  (OpenAI-compatible)
  bridge_server.py  (localhost:8775)
       ↕  subprocess
  dt gnai ask ...  (SightingAssistantTool CLI)
       ↕
  Intel GNAI Platform (sighting_assistant)
```

| Layer      | File                               | Role                                                      |
| ---------- | ---------------------------------- | --------------------------------------------------------- |
| UI         | `sidepanel.html / sidepanel.js`  | Chat interface, HSD import, streaming render              |
| Background | `background.js`                  | Bridge health check, API calls, stream relay              |
| Bridge     | `bridge/bridge_server.py`        | Local HTTP server, translates requests to `dt gnai ask` |
| Launcher   | `bridge/native_host_launcher.py` | Native Messaging host, auto-starts bridge process         |
| Install    | `bridge/install_native_host.ps1` | Registers Native Messaging host in Chrome & Registry      |

---

## Prerequisites

- **Windows** (Native Messaging launcher is PowerShell-based)
- **Google Chrome**
- **Intel `dt` CLI** with GNAI access (`dt gnai ask --help` should work)
- **Python 3.x** (for running the bridge server)
- Intel corporate network or VPN

---

## Installation

### Step 1 — Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `GNAI_AssisChatter` folder
4. Copy the **Extension ID** shown by Chrome (you'll need it in Step 3)

### Step 2 — Prepare the toolkit (first time only)

The bridge calls `dt gnai ask` using the `sighting_assistant`. The toolkit path **must not contain spaces**.

```powershell
# Copy toolkit to a path without spaces
New-Item -ItemType Directory -Path C:\dt_sighting -Force
# Copy toolkit.yaml / tools / assistants / src from your SightingAssistantTool clone
```

Then register it:

```powershell
# Edit ~/.gnai/config.yaml — add the sighting toolkit entry:
# - name: sighting
#   type: local
#   path: "C:\\dt_sighting"
#   url: ""
```

> **Note:** If `cryptography` package in `.workspace` is v42+, downgrade it:
>
> ```powershell
> C:\dt_sighting\.workspace\tools\python\python.exe -m pip install "cryptography<42" `
>   --target "C:\dt_sighting\.workspace\tools\python-site-packages" `
>   --upgrade --no-deps `
>   --index-url https://gfx-assets.fm.intel.com/artifactory/api/pypi/pypi-gsae/simple
> ```

### Step 3 — Register the Native Messaging host

Open PowerShell in `GNAI_AssisChatter\bridge` and run:

```powershell
.\install_native_host.ps1 -ExtensionId <YOUR_EXTENSION_ID> -Browser chrome
```

This registers `com.gnai.bridge_launcher` so Chrome can auto-start the bridge.

### Step 4 — Reload the extension

In `chrome://extensions`, click **Reload** for GNAI AssisChatter (or restart Chrome).

### Step 5 — Validate

1. Open the extension side panel
2. Click the ⚙ gear icon → **Debug Connection**
3. If the bridge is not running, start it manually once:

```powershell
cd GNAI_AssisChatter\bridge
.\run_bridge.ps1
```

Then click **Debug Connection** again — it should show `🟢 Ready`.

---

## Usage

1. Navigate to an HSD page (`hsdes.intel.com/...`) or any relevant webpage
2. Open the GNAI AssisChatter side panel
3. Click **Import HSD** to auto-detect the HSD ID from the URL, or type it manually
4. Press **Send** — the assistant will run the full sighting analysis pipeline
5. Ask follow-up questions in the same session

> To skip attachment analysis and get a quick summary:
> _"Please give me a punchline summary of HSD XXXXXXXXXX and skip attachment check"_

---

## Bridge Configuration

All settings are controlled via environment variables in `bridge/run_bridge.ps1`:

| Variable                          | Default                | Description                            |
| --------------------------------- | ---------------------- | -------------------------------------- |
| `GNAI_BRIDGE_HOST`              | `127.0.0.1`          | Bridge listen address                  |
| `GNAI_BRIDGE_PORT`              | `8775`               | Bridge listen port                     |
| `GNAI_BRIDGE_TIMEOUT`           | `360`                | `dt gnai ask` timeout in seconds     |
| `GNAI_BRIDGE_DEFAULT_ASSISTANT` | `sighting_assistant` | Default GNAI assistant                 |
| `GNAI_BRIDGE_DT_PATH`           | _(auto)_             | Full path to `dt.exe` if not in PATH |
| `GNAI_BRIDGE_API_KEY`           | _(empty)_            | Optional Bearer token for bridge auth  |
| `GNAI_BRIDGE_DEBUG`             | `1`                  | Enable debug logging                   |
| `GNAI_BRIDGE_ECHO_RESPONSE`     | `1`                  | Echo responses to stdout               |

---

## File Structure

```
GNAI_AssisChatter/
├── manifest.json               # Chrome Extension MV3 config
├── background.js               # Service worker — bridge health, API calls, stream relay
├── sidepanel.html              # Side panel UI
├── sidepanel.js                # Chat logic, HSD session, streaming render
├── installation.md             # Quick 5-step install guide
└── bridge/
    ├── bridge_server.py        # Local HTTP bridge (OpenAI-compatible endpoints)
    ├── run_bridge.ps1          # Bridge startup script (sets env vars + sync toolkit)
    ├── native_host_launcher.py # Native Messaging host — auto-starts bridge
    ├── install_native_host.ps1 # Registers native host in Chrome & Windows Registry
    └── native_host_launcher.cmd# CMD wrapper for the native host
```

---

## Known Limitations

- Windows only (Native Messaging launcher uses PowerShell)
- Requires Intel corporate network or VPN for GNAI and HSDES access
- The toolkit path must **not contain spaces** (OneDrive paths with spaces will break `dt gnai ask`)
- Only one HSD session active at a time per side panel instance

---

## License

Intel Internal — Not for external distribution.

主要功能:

1. 載入目前網頁文字內容（或剪貼簿內容）
2. 在 Side Panel 問答
3. 透過本機 bridge (`http://127.0.0.1:8775/v1`) 呼叫 `dt gnai --assistant`
4. Side Panel 內建 `Debug 連線` 按鈕，可輸出詳細除錯訊息
5. 開啟 extension 時會自動檢查 bridge 連線，並可透過 Native Messaging 自動啟動 bridge

## 檔案結構

- `manifest.json`: Extension 設定（MV3）
- `background.js`: API 呼叫與頁面內容擷取
- `sidepanel.html`: 側邊欄 UI
- `sidepanel.js`: 聊天互動與狀態管理
- `bridge/bridge_server.py`: 本機 bridge 服務
- `bridge/run_bridge.ps1`: bridge 啟動腳本
- `bridge/native_host_launcher.py`: Native Messaging host，供 extension 啟動 bridge
- `bridge/install_native_host.ps1`: 安裝 Native Messaging host 的 PowerShell 腳本

## 如何使用

1. 開啟 Chrome `chrome://extensions/`
2. 開啟 Developer mode
3. 點 `Load unpacked`
4. 選擇本資料夾 GNAI_AssisChatter
5. 啟動 bridge 後直接打開 side panel 使用

## 注意

1. 本 Extension 走固定 bridge URL：`http://127.0.0.1:8775/v1`。
2. 瀏覽器 Extension 無法直接在本機執行 `dt gnai` CLI 指令，所以一定透過 bridge。
3. 若尚未安裝 Native Messaging host，extension 無法自動啟 bridge；可先手動執行 `bridge/run_bridge.ps1`。
4. 若 bridge 未啟動，請先到 side panel 按 `Debug 連線` 檢查健康狀態與錯誤細節。

## 啟用自動啟 bridge（Native Messaging）

1. 先載入 extension，於 `chrome://extensions` 複製此 extension ID。
2. 到 `bridge` 目錄執行：

```powershell
cd .\bridge
.\install_native_host.ps1 -ExtensionId <你的extension_id> -Browser chrome
```

3. 重新啟動瀏覽器並重新載入 extension。
4. 開啟 Side Panel 時，extension 會自動嘗試：
   - 先檢查 `health`
   - 若未連線，透過 Native Host 啟動 `run_bridge.ps1`
   - 再輪詢確認 bridge 已連線

## 使用本機 Bridge（已提供）

本資料夾已內建 Python bridge：

- `bridge/bridge_server.py`
- `bridge/run_bridge.ps1`
- `bridge/README.md`

啟動:

```powershell
cd .\bridge
.\run_bridge.ps1
```
