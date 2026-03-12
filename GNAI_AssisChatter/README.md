# GNAI AssisChatter

這是一個參照 Steve_Chatter UI 風格建立的 Chrome Extension。
本版本已改為純 bridge 模式，不提供 Options 頁。

主要功能:

1. 載入目前網頁文字內容（或剪貼簿內容）
2. 在 Side Panel 問答
3. 透過本機 bridge (`http://127.0.0.1:8775/v1`) 呼叫 `dt gnai --assistant`
4. Side Panel 內建 `Debug 連線` 按鈕，可輸出詳細除錯訊息

## 檔案結構

- `manifest.json`: Extension 設定（MV3）
- `background.js`: API 呼叫與頁面內容擷取
- `sidepanel.html`: 側邊欄 UI
- `sidepanel.js`: 聊天互動與狀態管理
- `bridge/bridge_server.py`: 本機 bridge 服務
- `bridge/run_bridge.ps1`: bridge 啟動腳本

## 如何使用

1. 開啟 Chrome `chrome://extensions/`
2. 開啟 Developer mode
3. 點 `Load unpacked`
4. 選擇本資料夾 GNAI_AssisChatter
5. 啟動 bridge 後直接打開 side panel 使用

## 注意

1. 本 Extension 走固定 bridge URL：`http://127.0.0.1:8765/v1`。
2. 瀏覽器 Extension 無法直接在本機執行 `dt gnai` CLI 指令，所以一定透過 bridge。
3. 若 bridge 未啟動，請先到 side panel 按 `Debug 連線` 檢查健康狀態與錯誤細節。

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
