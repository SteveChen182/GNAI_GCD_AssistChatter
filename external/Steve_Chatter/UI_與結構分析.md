# Steve_Chatter UI 與結構分析

更新日期: 2026-03-12

## 1. 專案定位

Steve_Chatter 是一個 Chrome Extension（Manifest V3），主流程是:

1. 從目前分頁擷取網頁文字（或使用剪貼簿內容）
2. 將內容作為上下文送到 GPT（Azure OpenAI 或 OpenAI-compatible）
3. 在 Side Panel 內進行多輪問答

---

## 2. UI 分析

### 2.1 主要介面（sidepanel.html）

UI 採單頁聊天面板，結構分為:

1. Header Bar
- 標題: Chatter
- 控制元件: 載入網頁、清除對話、配額檢查、模型選擇、語言選擇

2. Status Bar
- 即時狀態文字（ready/loading/error）
- 配額進度條（used/remaining）
- 頁面可讀取徽章（readable/unreadable）

3. Page Info 區
- 顯示當前上下文來源（title/url）
- 載入網頁或剪貼簿後才顯示

4. Messages 區
- user / assistant / system 三種訊息樣式
- 預設有 empty state 引導
- assistant 訊息支援簡易 markdown 顯示（粗體、code、換行）

5. Input 區
- 多行輸入框（Enter 發送、Shift+Enter 換行）
- 發送按鈕
- 字級放大/縮小按鈕

### 2.2 視覺風格

- 主題色為藍紫漸層（Header 與發送按鈕）
- 聊天氣泡左右分流，接近常見 IM 交互
- 頁面可讀取與 quota 透過狀態視覺化（小圓點 + 進度條）
- 字級可調，對可讀性友善

### 2.3 UX 特徵

- 載入新頁面時會清空舊對話，避免跨頁內容汙染
- 語言切換同時影響 UI 文案與系統提示語
- 發送時先做本地 quota +1 模擬，改善回饋速度
- 可手動按配額檢查，顯示後端 headers / model quota

---

## 3. 程式結構分析

### 3.1 檔案與責任

1. manifest.json
- 宣告 side_panel、options_page、background service worker
- 權限: activeTab、scripting、storage、sidePanel、clipboardRead
- host_permissions: <all_urls>

2. sidepanel.html
- Side Panel 的 UI 結構與樣式

3. sidepanel.js
- 前端狀態管理與互動流程
- 多語系文案
- 對 background.js 發送 GET_PAGE_CONTENT / CHAT / CHECK_QUOTA 訊息

4. background.js
- service worker
- 開啟 side panel
- 擷取網頁內容（executeScript）
- 呼叫 LLM API（Azure / OpenAI-compatible）
- quota 查詢與 headers 回傳

5. options.html / options.js
- Provider 設定（Azure 或 OpenAI-compatible）
- .env 文字貼上解析與欄位帶入
- 設定儲存至 chrome.storage.local
- 配額測試按鈕

### 3.2 訊息通道（runtime messaging）

主要 message type:

- GET_PAGE_CONTENT
  - sidepanel -> background
  - background 注入頁面腳本，回傳 title/url/text

- CHAT
  - sidepanel -> background
  - background 依 provider 呼叫 API，回傳回答

- CHECK_QUOTA
  - sidepanel/options -> background
  - background 取 quota 相關資訊回傳

---

## 4. 資料流（端到端）

1. 使用者按「載入網頁」
- sidepanel.js 呼叫 GET_PAGE_CONTENT
- background.js 透過 scripting 抓 document.body.innerText
- 內容截斷到 15,000 字
- sidepanel.js 保存為 pageContent 並顯示 page info

2. 使用者發送問題
- sidepanel.js 依是否有 pageContent 組裝 messages
- 送 CHAT 給 background.js
- background.js 加上語言對應 system prompt
- 依 provider 路徑呼叫:
  - Azure: /openai/deployments/{deployment}/chat/completions
  - OpenAI-compatible: /v1/chat/completions（含 fallback path）
- 回傳 assistant 結果並更新 UI/history

3. 配額同步
- sidepanel/options 送 CHECK_QUOTA
- background.js 查 quota endpoint 或讀取 rate-limit headers
- sidepanel.js 更新 quota progress UI

---

## 5. UI 與架構一致性觀察

1. 已實作但 UI 未露出的功能
- sidepanel.js 有 loadClipboard() 與 loadClipboardBtn 綁定
- 目前 sidepanel.html 沒有 loadClipboardBtn 元件
- 結果: 程式邏輯支援剪貼簿，但 UI 入口目前不存在

2. 多語系資源與實際可選語言不完全一致
- TRANSLATIONS 有 zh-TW / zh-CN / en
- SUPPORTED_LANGUAGES 只有 zh-TW / en
- language selector 也只有繁中與英文

3. 模型選單與 provider 關係
- model selector（gpt-4o / gpt-5.2）主要影響 openaiModel 與 quota 顯示
- Azure 路徑實際用的是 azureDeployment，不直接使用 model selector

4. README 與現況有部分差異
- README 提到 Clipboard 功能可用
- 但目前 side panel UI 沒有 clipboard 按鈕

---

## 6. Quick Action Buttons（GNAI_AssisChatter）

定義位置：`GNAI_AssisChatter/sidepanel.js` — `QUICK_ACTIONS` 陣列（第 120 行附近）

最後更新：2026-04-21

| 標籤（Label） | 按下後填入 input 顯示的文字 | 實際送出的 Prompt |
|---|---|---|
| **Last Status & Action** | `Summarize the latest status and action request for HSD {id}` | `Please summarize the latest status of HSD {id}, including the current problem description, progress, and the most recent action request.` |
| **Test Environment** | `Describe the test environment for HSD {id}` | `Please describe the test environment for HSD {id}, including hardware platform, OS version, driver version, and any relevant configuration details.` |
| **Next Step** | `What is the recommended next step for HSD {id}?` | `Based on the current status and findings of HSD {id}, what is the recommended next action or investigation step?` |
| **Potential Duplicated Issue** | `Find potential duplicate issues for HSD {id}` | `Please check if HSD {id} has any potential duplicate or related sightings. Look for similar symptoms, affected platforms, or known issues that may overlap.` |

> 注意：「按下後填入 input 顯示的文字」目前在 code 中並非獨立欄位，實際上 input 填入的即為完整 prompt。此欄為供人閱讀的簡短描述。

---

## 7. 架構優點

1. 模組邊界清晰
- UI（sidepanel）與 API 呼叫（background）分離

2. Provider 抽象完成度不錯
- 支援 Azure 與 OpenAI-compatible，並有 endpoint fallback

3. 可觀測性好
- 有狀態列、配額檢查、錯誤訊息回饋

4. 設定管理完整
- options 頁面可設定、清空、匯入 .env 並做基本驗證

---

## 7. 主要風險與改善建議

1. 權限範圍偏大
- <all_urls> + activeTab + scripting + clipboardRead 屬高權限組合
- 建議依實際需求縮小 host_permissions

2. 頁面內容可能含敏感資訊
- 目前直接送全文到模型
- 建議增加脫敏策略（email/token/ID masking）

3. Clipboard 功能入口缺失
- 建議補回 UI 按鈕，或移除相關程式避免混淆

4. 語言資源一致性
- 若不支援 zh-CN，建議移除未啟用文案；或補上 selector 與設定流

5. 大頁面處理
- 目前採固定截斷 15,000 字
- 建議改為段落切片 + 摘要策略，提高回答品質

---

## 8. 結論

Steve_Chatter 的整體設計是「側邊欄聊天 UI + background API gateway + options 設定中心」，架構清楚、擴充性良好，已具備實用的網頁問答能力。

在 UI 與結構上最關鍵的現況是:

1. 主功能（載入網頁 -> GPT 問答）流程完整
2. Provider 與 quota 管理已成形
3. 存在少量一致性問題（clipboard 入口、zh-CN 開關、README 與 UI 差異）

若補齊上述一致性項目，這個 extension 會更接近可正式交付的品質。
