const TRANSLATIONS = {
  "zh-TW": {
    ready: "準備就緒",
    bridgeBooting: "Bridge 啟動與連線檢查中...",
    bridgeReadyAuto: "Bridge 已連線",
    bridgeAutoStartFailed: "Bridge 自動啟動失敗",
    loadingPage: "載入網頁中...",
    loadingClipboard: "載入剪貼簿中...",
    sending: "發送中...",
    sendingElapsed: "發送中... 已等待 {sec} 秒",
    send: "發送",
    stop: "中止",
    cancelled: "已中止本次請求",
    cancelling: "中止中...",
    cleared: "對話已清除",
    pageLoaded: "網頁已載入",
    clipboardLoaded: "剪貼簿已載入",
    noPage: "請先載入網頁或剪貼簿",
    emptyQuestion: "請先輸入問題",
    noTab: "找不到目前分頁",
    loadFailed: "載入失敗",
    sendFailed: "發送失敗",
    streamPartialNotice: "串流連線中斷，已保留目前收到的內容。",
    streamRetrying: "串流中斷，改用完整回覆重試中...",
    streamRecovered: "已改用完整回覆模式完成本次請求。",
    debugConn: "Debug 連線",
    debugRunning: "ＧＮＡＩ連線檢查中...",
    debugDone: "連線測試完成",
    debugFailed: "連線測試失敗",
    debugSuccess: "連線測試成功",
    debugTitle: "Bridge 除錯結果",
    titleStart: "開始對話",
    textStart: "請直接輸入問題開始對話。",
    inputPlaceholder: "輸入您的問題...",
    enterHsdPrompt: "請輸入hsd id",
    hsdInputPlaceholder: "請輸入 11 碼 HSD ID",
    invalidHsdId: "請輸入有效的hssd id",
    hsdLocked: "本次 Session HSD ID: {hsdId}",
    importHsdFromWebpage: "匯入頁面HSD",
    noValidHsdId: "無有效HSD ID",
    importedHsdId: "已從網址匯入 HSD ID: {hsdId}",
    hsdAlreadyLocked: "本次 Session 已鎖定 HSD ID，請先清除對話",
    reimportHsdConfirm: "重新匯入 HSD 將清除現有資料，是否要繼續？",
    realtimeFormatMode: "即時解析 HTML: {state}",
    modeOn: "開",
    modeOff: "關"
  },
  "en": {
    ready: "Ready",
    bridgeBooting: "Starting bridge and checking connection...",
    bridgeReadyAuto: "Bridge connected",
    bridgeAutoStartFailed: "Bridge auto-start failed",
    loadingPage: "Loading page...",
    loadingClipboard: "Loading clipboard...",
    sending: "Sending...",
    sendingElapsed: "Sending... waiting {sec}s",
    send: "Send",
    stop: "Stop",
    cancelled: "Request cancelled",
    cancelling: "Cancelling...",
    cleared: "Chat cleared",
    pageLoaded: "Page loaded",
    clipboardLoaded: "Clipboard loaded",
    noPage: "Please load page or clipboard first",
    emptyQuestion: "Please enter a question",
    noTab: "Cannot find active tab",
    loadFailed: "Load failed",
    sendFailed: "Send failed",
    streamPartialNotice: "Stream disconnected; partial response was kept.",
    streamRetrying: "Stream disconnected; retrying with full response...",
    streamRecovered: "Request completed via full-response fallback.",
    debugConn: "Debug Connection",
    debugRunning: "Running diagnostics...",
    debugDone: "Diagnostics complete",
    debugFailed: "Diagnostics failed",
    debugSuccess: "Connection test successful",
    debugTitle: "Bridge Debug Result",
    titleStart: "Start conversation",
    textStart: "Type your question to start the conversation.",
    inputPlaceholder: "Type your question...",
    enterHsdPrompt: "Please enter hsd id",
    hsdInputPlaceholder: "Enter 11-digit HSD ID",
    invalidHsdId: "Please enter a valid hssd id",
    hsdLocked: "Current session HSD ID: {hsdId}",
    importHsdFromWebpage: "Import HSD",
    noValidHsdId: "No valid HSD ID",
    importedHsdId: "Imported HSD ID from URL: {hsdId}",
    hsdAlreadyLocked: "Session HSD ID is already locked. Please clear chat first",
    reimportHsdConfirm: "Re-importing HSD will clear current data. Continue?",
    realtimeFormatMode: "Realtime HTML parsing: {state}",
    modeOn: "On",
    modeOff: "Off"
  }
};

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 20;
const FONT_STEP = 1;
const STREAM_UI_UPDATE_MIN_INTERVAL_MS = 500;
const HSD_ID_LENGTH = 11;
const QUICK_PUNCHLINE_TEMPLATE = "Please give me a punchline summary of HSD {ID} and skip attachment check";

let currentLanguage = "en";
let currentFontSize = 14;
let messages = [];
let pageContent = null;
let sendingTicker = null;
let sendingStartedAt = 0;
let isSending = false;
let activeStreamPort = null;
let chatGeneration = 0;
let activeHsdId = null;
let activeConversationId = null;
let streamRenderState = null;
let streamRealtimeFormatting = false;
const STREAM_WAIT_FRAMES = ["▶", "▶▶", "▶▶▶"];

function extractHsdId(text) {
  const value = String(text || "");
  const m = value.match(/(?:\bHSD\s*[:#-]?\s*)?(\d{8,})\b/i);
  return m ? m[1] : null;
}

function t(key) {
  return TRANSLATIONS[currentLanguage]?.[key] || key;
}

function tFormat(key, vars = {}) {
  let value = t(key);
  for (const [name, v] of Object.entries(vars)) {
    value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(v));
  }
  return value;
}

function setStatus(mode, text) {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusText");
  dot.className = "status-dot";
  if (mode === "loading") dot.classList.add("loading");
  if (mode === "error") dot.classList.add("error");
  label.textContent = text || "";
}

function clearMessageContainer() {
  const box = document.getElementById("messages");
  box.innerHTML = `
    <div class="empty-state">
      <div class="empty-title">${t("titleStart")}</div>
      <div class="empty-text">${t("textStart")}</div>
    </div>
  `;
}

function addMessage(role, content) {
  const box = document.getElementById("messages");
  const empty = box.querySelector(".empty-state");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = `message ${role}`;
  if (role === "assistant") {
    let html = String(content || "");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");
    html = html.replace(/\n/g, "<br>");
    el.innerHTML = html;
  } else {
    el.textContent = content;
  }

  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function addSystemMessage(content) {
  addMessage("system", content);
}

function renderAssistantMessage(el, content) {
  if (!el) return;
  let html = String(content || "");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`(.+?)`/g, "<code>$1</code>");
  html = html.replace(/\n/g, "<br>");
  el.innerHTML = html;

  const box = document.getElementById("messages");
  box.scrollTop = box.scrollHeight;
}

function beginAssistantStream(el) {
  if (!el) return;

  el.textContent = "";
  el.style.whiteSpace = "pre-wrap";
  const now = Date.now();
  streamRenderState = {
    el,
    fullText: "",
    pending: "",
    rafId: null,
    timerId: null,
    lastFlushAt: now - STREAM_UI_UPDATE_MIN_INTERVAL_MS,
    textNode: document.createTextNode(""),
    indicatorNode: document.createElement("span"),
    indicatorTimer: null,
    indicatorIndex: 0
  };
  el.appendChild(streamRenderState.textNode);
  streamRenderState.indicatorNode.className = "stream-wait-indicator";
  streamRenderState.indicatorNode.textContent = STREAM_WAIT_FRAMES[0];
  el.appendChild(streamRenderState.indicatorNode);
  streamRenderState.indicatorTimer = setInterval(() => {
    const state = streamRenderState;
    if (!state || !state.indicatorNode) return;
    state.indicatorIndex = (state.indicatorIndex + 1) % STREAM_WAIT_FRAMES.length;
    state.indicatorNode.textContent = STREAM_WAIT_FRAMES[state.indicatorIndex];
  }, 500);
}

function scheduleAssistantFlush() {
  const state = streamRenderState;
  if (!state) return;
  if (state.rafId != null || state.timerId != null) return;

  const elapsed = Date.now() - state.lastFlushAt;
  const waitMs = Math.max(0, STREAM_UI_UPDATE_MIN_INTERVAL_MS - elapsed);

  if (waitMs === 0) {
    state.rafId = requestAnimationFrame(flushAssistantStream);
    return;
  }

  state.timerId = setTimeout(() => {
    const latest = streamRenderState;
    if (!latest) return;
    latest.timerId = null;
    latest.rafId = requestAnimationFrame(flushAssistantStream);
  }, waitMs);
}

function flushAssistantStream() {
  const state = streamRenderState;
  if (!state) return;

  state.rafId = null;
  if (!state.pending) return;

  const chunk = state.pending;
  state.pending = "";
  state.fullText += chunk;
  if (streamRealtimeFormatting) {
    renderAssistantMessage(state.el, state.fullText);
    if (state.indicatorTimer != null && state.indicatorNode) {
      state.el.appendChild(state.indicatorNode);
    }
  } else {
    state.textNode.appendData(chunk);
  }
  state.lastFlushAt = Date.now();

  const box = document.getElementById("messages");
  box.scrollTop = box.scrollHeight;
}

function queueAssistantDelta(delta) {
  const state = streamRenderState;
  if (!state) return;

  state.pending += String(delta || "");
  scheduleAssistantFlush();
}

function finishAssistantStream(finalText) {
  const state = streamRenderState;
  if (!state) return;

  if (state.indicatorTimer != null) {
    clearInterval(state.indicatorTimer);
    state.indicatorTimer = null;
  }
  if (state.indicatorNode && state.indicatorNode.parentNode) {
    state.indicatorNode.parentNode.removeChild(state.indicatorNode);
  }

  if (state.timerId != null) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  if (state.rafId != null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  flushAssistantStream();

  const doneText = String(finalText || state.fullText || "");
  state.el.style.whiteSpace = "";
  renderAssistantMessage(state.el, doneText);
  streamRenderState = null;
}

function cancelAssistantStreamRender() {
  const state = streamRenderState;
  if (!state) return;

  if (state.indicatorTimer != null) {
    clearInterval(state.indicatorTimer);
    state.indicatorTimer = null;
  }
  if (state.indicatorNode && state.indicatorNode.parentNode) {
    state.indicatorNode.parentNode.removeChild(state.indicatorNode);
  }

  if (state.timerId != null) {
    clearTimeout(state.timerId);
  }
  if (state.rafId != null) {
    cancelAnimationFrame(state.rafId);
  }
  state.el.style.whiteSpace = "";
  streamRenderState = null;
}

function applyLanguage() {
  document.getElementById("sendBtn").textContent = t("send");
  const stopBtn = document.getElementById("stopBtn");
  if (stopBtn) stopBtn.textContent = t("stop");
  const debugMenuBtn = document.getElementById("debugMenuBtn");
  if (debugMenuBtn) debugMenuBtn.textContent = t("debugConn");
  const formatModeBtn = document.getElementById("formatModeBtn");
  if (formatModeBtn) {
    const modeText = streamRealtimeFormatting ? t("modeOn") : t("modeOff");
    formatModeBtn.textContent = tFormat("realtimeFormatMode", { state: modeText });
  }
  const importHsdBtn = document.getElementById("importHsdBtn");
  if (importHsdBtn) importHsdBtn.textContent = t("importHsdFromWebpage");
  const input = document.getElementById("messageInput");
  input.placeholder = activeHsdId ? t("inputPlaceholder") : t("hsdInputPlaceholder");
  if (document.getElementById("messages").querySelector(".empty-state")) {
    clearMessageContainer();
  }
}

function closeSettingsMenu() {
  const menu = document.getElementById("settingsMenu");
  if (menu) menu.classList.remove("show");
}

function toggleSettingsMenu() {
  const menu = document.getElementById("settingsMenu");
  if (!menu) return;
  menu.classList.toggle("show");
}

function isValidHsdId(value) {
  return /^\d{11}$/.test(String(value || "").trim());
}

function setHsdInputMode() {
  const input = document.getElementById("messageInput");
  if (!input) return;

  if (activeHsdId) {
    input.removeAttribute("maxlength");
    input.removeAttribute("pattern");
    input.inputMode = "text";
    input.placeholder = t("inputPlaceholder");
    return;
  }

  input.setAttribute("maxlength", String(HSD_ID_LENGTH));
  input.setAttribute("pattern", "\\d{11}");
  input.inputMode = "numeric";
  input.placeholder = t("hsdInputPlaceholder");
}

function promptForHsdId() {
  addSystemMessage(t("enterHsdPrompt"));
  setStatus("ready", t("enterHsdPrompt"));
  setHsdInputMode();
  renderQuickActions();
  renderSessionHsdLabel();
}

function renderSessionHsdLabel() {
  const label = document.getElementById("sessionHsdLabel");
  if (!label) return;
  label.textContent = activeHsdId ? `HSD ${activeHsdId}` : "";
  updateHeaderLayoutForOverlap();
}

function updateHeaderLayoutForOverlap() {
  const header = document.getElementById("headerBar");
  const label = document.getElementById("sessionHsdLabel");
  const controls = document.getElementById("headerControls");
  const title = header?.querySelector(".header-title");
  if (!header || !label || !controls || !title) return;

  if (!(label.textContent || "").trim()) {
    header.classList.remove("stack-controls");
    return;
  }

  // Measure with single-row layout first, then stack controls only when needed.
  header.classList.remove("stack-controls");

  const titleRect = title.getBoundingClientRect();
  const labelRect = label.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  const spacing = 8;

  const overlapTitle = labelRect.left < (titleRect.right + spacing);
  const overlapControls = labelRect.right > (controlsRect.left - spacing);

  if (overlapTitle || overlapControls) {
    header.classList.add("stack-controls");
  }
}

function removeEnterHsdPromptMessage() {
  const box = document.getElementById("messages");
  if (!box) return;

  const candidates = box.querySelectorAll(".message.system");
  for (const node of candidates) {
    if ((node.textContent || "").trim() === t("enterHsdPrompt")) {
      node.remove();
      break;
    }
  }
}

function buildPunchlinePrompt(hsdId) {
  return QUICK_PUNCHLINE_TEMPLATE.replace("{ID}", String(hsdId || ""));
}

function getHsdConversationId() {
  return String(activeConversationId || "");
}

function renderStatusConversationId() {
  const el = document.getElementById("statusConversationId");
  if (!el) return;

  const cid = getHsdConversationId();
  if (!cid) {
    el.textContent = "";
    el.title = "";
    el.classList.remove("show");
    return;
  }

  const label = `CID: ${cid}`;
  el.textContent = label;
  el.title = label;
  el.classList.add("show");
}

function lockSessionHsdId(hsdId, options = {}) {
  const id = String(hsdId || "").trim();
  if (!isValidHsdId(id)) {
    return false;
  }

  if (activeHsdId && activeHsdId !== id) {
    addSystemMessage(t("hsdAlreadyLocked"));
    setStatus("error", t("hsdAlreadyLocked"));
    return false;
  }

  activeHsdId = id;
  activeConversationId = `${activeHsdId}-${Date.now()}`;
  const input = document.getElementById("messageInput");
  if (input) {
    input.value = "";
    input.style.height = "auto";
  }
  removeEnterHsdPromptMessage();
  setHsdInputMode();
  renderQuickActions();
  renderSessionHsdLabel();
  renderStatusConversationId();

  if (options.importedFromUrl) {
    addSystemMessage(tFormat("importedHsdId", { hsdId: activeHsdId }));
  }
  addSystemMessage(tFormat("hsdLocked", { hsdId: activeHsdId }));
  setStatus("ready", t("ready"));
  return true;
}

function extractHsdIdFromHsdesUrl(url) {
  const value = String(url || "").trim();
  const patterns = [
    /^https:\/\/hsdes\.intel\.com\/appstore\/article-one\/#\/article\/(\d{11})(?:[/?#].*)?$/i,
    /^https:\/\/hsdes\.intel\.com\/appstore\/article-one\/#\/(\d{11})(?:[/?#].*)?$/i
  ];

  for (const pattern of patterns) {
    const m = value.match(pattern);
    if (m) return m[1];
  }

  return "";
}

async function importHsdIdFromWebpage() {
  try {
    if (activeHsdId) {
      const shouldContinue = window.confirm(t("reimportHsdConfirm"));
      if (!shouldContinue) return;

      chatGeneration += 1;
      await cancelSending();
      cancelAssistantStreamRender();
      if (activeStreamPort) {
        try {
          activeStreamPort.disconnect();
        } catch (_) {
          // ignore
        }
        activeStreamPort = null;
      }

      messages = [];
      pageContent = null;
      activeHsdId = null;
      activeConversationId = null;
      renderQuickActions();
      renderSessionHsdLabel();
      hidePageInfo();
      clearMessageContainer();
    }

    const tab = await getCurrentTab();
    const url = String(tab?.url || "");
    const hsdId = extractHsdIdFromHsdesUrl(url);
    if (!hsdId) {
      addSystemMessage(t("noValidHsdId"));
      setStatus("error", t("noValidHsdId"));
      return;
    }

    lockSessionHsdId(hsdId, { importedFromUrl: true });
  } catch (_) {
    addSystemMessage(t("noValidHsdId"));
    setStatus("error", t("noValidHsdId"));
  }
}

function renderQuickActions() {
  const wrapper = document.getElementById("quickActions");
  const button = document.getElementById("quickPunchlineBtn");
  if (!wrapper || !button) return;

  if (!activeHsdId) {
    wrapper.classList.remove("show");
    button.textContent = "";
    button.disabled = true;
    return;
  }

  button.textContent = buildPunchlinePrompt(activeHsdId);
  button.disabled = isSending;
  wrapper.classList.add("show");
}

function formatDebugDetails(details) {
  const lines = [];
  lines.push(`== ${t("debugTitle")} ==`);
  lines.push(`bridgeBaseUrl: ${details?.bridgeBaseUrl || "N/A"}`);
  lines.push(`assistant: ${details?.assistant || "N/A"}`);
  lines.push(`model: ${details?.model || "N/A"}`);

  const healthChecks = Array.isArray(details?.healthChecks) ? details.healthChecks : [];
  lines.push("healthChecks:");
  if (healthChecks.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of healthChecks) {
      lines.push(`- ${item.url || "unknown"}`);
      lines.push(`  ok=${item.ok} status=${item.status ?? "N/A"}`);
      if (item.error) lines.push(`  error=${item.error}`);
      if (item.bodySnippet) lines.push(`  body=${String(item.bodySnippet).slice(0, 160)}`);
    }
  }

  const ping = details?.ping || {};
  lines.push("ping:");
  lines.push(`- ok=${ping.ok === true}`);
  lines.push(`- endpoint=${ping.endpoint || "N/A"}`);
  lines.push(`- status=${ping.status ?? "N/A"}`);
  if (ping.contentSnippet) {
    lines.push(`- content=${String(ping.contentSnippet).slice(0, 180)}`);
  }

  if (Array.isArray(ping.attempts) && ping.attempts.length > 0) {
    lines.push("- attempts:");
    for (const attempt of ping.attempts) {
      const status = attempt.status !== undefined ? attempt.status : "N/A";
      const msg = attempt.error ? ` error=${attempt.error}` : "";
      lines.push(`  * ${attempt.endpoint || "unknown"} ok=${attempt.ok} status=${status}${msg}`);
    }
  }

  return lines.join("\n");
}

function formatChatErrorDetails(details) {
  if (!details || typeof details !== "object") return "";

  const lines = [];
  lines.push("== Bridge 執行細節 ==");
  if (details.endpoint) lines.push(`endpoint: ${details.endpoint}`);
  if (details.status !== undefined) lines.push(`status: ${details.status}`);
  if (details.assistant) lines.push(`assistant: ${details.assistant}`);
  if (details.dtSource) lines.push(`dtSource: ${details.dtSource}`);
  if (details.durationMs !== undefined) lines.push(`durationMs: ${details.durationMs}`);
  if (details.returnCode !== undefined && details.returnCode !== null) {
    lines.push(`returnCode: ${details.returnCode}`);
  }
  if (details.hint) lines.push(`hint: ${details.hint}`);
  if (details.stderr) lines.push(`stderr:\n${String(details.stderr).slice(0, 1500)}`);
  if (details.stdout) lines.push(`stdout:\n${String(details.stdout).slice(0, 1500)}`);
  if (details.rawBody) lines.push(`rawBody:\n${String(details.rawBody).slice(0, 1500)}`);

  return lines.join("\n");
}

async function debugConnection() {
  try {
    setStatus("loading", t("debugRunning"));

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" }, resolve);
    });

    if (!response?.ok) {
      if (response?.details) {
        addSystemMessage(formatDebugDetails(response.details));
      }

      const lines = [
        `== ${t("debugTitle")} ==`,
        `error: ${response?.error || "Unknown error"}`
      ];
      const attempts = Array.isArray(response?.attempts) ? response.attempts : [];
      if (attempts.length > 0) {
        lines.push("attempts:");
        for (const attempt of attempts) {
          lines.push(`- ${attempt.endpoint || "unknown"} ok=${attempt.ok} status=${attempt.status ?? "N/A"} ${attempt.error ? `error=${attempt.error}` : ""}`);
        }
      }
      addSystemMessage(lines.join("\n"));
      setStatus("error", t("debugFailed"));
      return;
    }

    addSystemMessage(t("debugSuccess"));
    setStatus("ready", t("debugDone"));
  } catch (err) {
    addSystemMessage(`== ${t("debugTitle")} ==\nerror: ${err.message || String(err)}`);
    setStatus("error", t("debugFailed"));
  }
}

async function ensureBridgeOnPanelOpen() {
  try {
    setStatus("loading", t("bridgeBooting"));
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "ENSURE_BRIDGE_READY" }, resolve);
    });

    if (!response?.ok) {
      const msg = response?.error || t("bridgeAutoStartFailed");
      setStatus("error", `${t("bridgeAutoStartFailed")}: ${msg}`);
      addSystemMessage(`Bridge auto-start failed: ${msg}`);
      return;
    }

    const status = response.status || {};
    if (status.ok) {
      setStatus("ready", t("bridgeReadyAuto"));
      return;
    }

    const err = status.error || t("bridgeAutoStartFailed");
    setStatus("error", `${t("bridgeAutoStartFailed")}: ${err}`);
    addSystemMessage(`Bridge auto-start failed: ${err}`);
  } catch (err) {
    setStatus("error", `${t("bridgeAutoStartFailed")}: ${err.message || String(err)}`);
  }
}

function applyFontSize(size) {
  const safe = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Number(size) || 14));
  currentFontSize = safe;
  document.documentElement.style.setProperty("--chat-font-size", `${safe}px`);
}

function stopSendingTicker() {
  if (sendingTicker) {
    clearInterval(sendingTicker);
    sendingTicker = null;
  }
}

function startSendingState() {
  isSending = true;
  sendingStartedAt = Date.now();
  const sendBtn = document.getElementById("sendBtn");
  const stopBtn = document.getElementById("stopBtn");
  const input = document.getElementById("messageInput");

  sendBtn.disabled = true;
  input.disabled = true;
  stopBtn.classList.add("show");

  const update = () => {
    const sec = Math.max(0, Math.floor((Date.now() - sendingStartedAt) / 1000));
    setStatus("loading", tFormat("sendingElapsed", { sec }));
  };

  update();
  stopSendingTicker();
  sendingTicker = setInterval(update, 1000);
  renderQuickActions();
}

function endSendingState() {
  isSending = false;
  stopSendingTicker();
  const sendBtn = document.getElementById("sendBtn");
  const stopBtn = document.getElementById("stopBtn");
  const input = document.getElementById("messageInput");

  sendBtn.disabled = false;
  input.disabled = false;
  stopBtn.classList.remove("show");
  renderQuickActions();
}

async function cancelSending() {
  if (!isSending) return;
  setStatus("loading", t("cancelling"));
  if (activeStreamPort) {
    activeStreamPort.postMessage({ type: "CANCEL_CHAT_STREAM" });
    return;
  }
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CANCEL_CHAT" }, () => resolve());
  });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showPageInfo(title, url) {
  document.getElementById("pageTitle").textContent = title || "(untitled)";
  document.getElementById("pageUrl").textContent = url || "";
  document.getElementById("pageInfo").classList.add("show");
}

function hidePageInfo() {
  document.getElementById("pageInfo").classList.remove("show");
}

async function loadPage() {
  try {
    setStatus("loading", t("loadingPage"));
    const tab = await getCurrentTab();
    if (!tab?.id) {
      setStatus("error", t("noTab"));
      return;
    }

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT", tabId: tab.id }, resolve);
    });

    if (!response?.ok) {
      throw new Error(response?.error || t("loadFailed"));
    }

    messages = [];
    pageContent = response.content;
    clearMessageContainer();
    showPageInfo(pageContent.title, pageContent.url);
    addSystemMessage(t("pageLoaded"));
    setStatus("ready", t("ready"));
  } catch (err) {
    setStatus("error", `${t("loadFailed")}: ${err.message || String(err)}`);
  }
}

async function loadClipboard() {
  try {
    setStatus("loading", t("loadingClipboard"));
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) {
      throw new Error("Clipboard is empty");
    }

    messages = [];
    pageContent = {
      title: "Clipboard Content",
      url: "clipboard://",
      text: text.trim()
    };
    clearMessageContainer();
    showPageInfo("📋 Clipboard", `${text.length} chars`);
    addSystemMessage(t("clipboardLoaded"));
    setStatus("ready", t("ready"));
  } catch (err) {
    setStatus("error", `${t("loadFailed")}: ${err.message || String(err)}`);
  }
}

function buildApiMessages(userQuestion) {
  const sessionHint = activeHsdId
    ? [{ role: "system", content: `Active HSD ID for this session is ${activeHsdId}. Keep this HSD context for follow-up questions unless user explicitly requests to change HSD.` }]
    : [];

  return [...sessionHint, ...messages, { role: "user", content: String(userQuestion || "") }];
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const question = input.value.trim();
  const thisGeneration = chatGeneration;
  let apiMessages = null;

  if (!question) {
    setStatus("error", t("emptyQuestion"));
    return;
  }

  if (!activeHsdId) {
    if (!isValidHsdId(question)) {
      setStatus("error", t("invalidHsdId"));
      addSystemMessage(t("invalidHsdId"));
      return;
    }

    lockSessionHsdId(question);
    return;
  }

  try {
    startSendingState();

    addMessage("user", question);
    input.value = "";
    input.style.height = "auto";

    apiMessages = buildApiMessages(question);
    const assistantEl = addMessage("assistant", "");
    beginAssistantStream(assistantEl);
    let response = await new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "chat-stream" });
      activeStreamPort = port;
      let received = "";
      let settled = false;
      const conversationId = getHsdConversationId();

      port.onMessage.addListener((event) => {
        if (thisGeneration !== chatGeneration) {
          settled = true;
          try {
            port.disconnect();
          } catch (_) {
            // ignore
          }
          return;
        }

        if (event?.type === "chunk") {
          received += String(event.delta || "");
          queueAssistantDelta(event.delta);
          return;
        }

        if (event?.type === "heartbeat") {
          return;
        }

        if (event?.type === "done") {
          const finalText = String(event.result || received || "");
          finishAssistantStream(finalText);
          settled = true;
          resolve({ ok: true, result: finalText, debug: event.debug || null });
          port.disconnect();
          return;
        }

        if (event?.type === "error") {
          settled = true;
          reject({
            ok: false,
            error: event.error || "Unknown error",
            attempts: event.attempts || [],
            details: event.details || null,
            cancelled: Boolean(event.cancelled)
          });
          port.disconnect();
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          if (received.trim()) {
            const partialText = String(received);
            finishAssistantStream(partialText);
            settled = true;
            resolve({
              ok: true,
              result: partialText,
              partial: true,
              warning: "Stream disconnected unexpectedly"
            });
          } else {
            settled = true;
            resolve({
              ok: true,
              needsFallback: true,
              warning: "Stream disconnected unexpectedly"
            });
          }
        }
        activeStreamPort = null;
      });

      port.postMessage({
        type: "CHAT_STREAM",
        messages: apiMessages,
        language: "en",
        conversationId
      });
    });

    if (response?.needsFallback) {
      setStatus("loading", t("streamRetrying"));
      const fallback = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "CHAT",
            messages: apiMessages,
            language: "en",
            conversationId: getHsdConversationId()
          },
          resolve
        );
      });

      if (!fallback?.ok) {
        throw {
          ok: false,
          error: fallback?.error || response.warning || "Stream disconnected unexpectedly",
          attempts: fallback?.attempts || [],
          details: fallback?.details || null,
          cancelled: Boolean(fallback?.cancelled)
        };
      }

      const fallbackText = String(fallback.result || "");
      finishAssistantStream(fallbackText);
      response = {
        ok: true,
        result: fallbackText,
        usedFallback: true,
        debug: fallback.debug || null
      };
    }

    if (!response?.ok) {
      cancelAssistantStreamRender();
      if (response?.details) {
        const detailText = formatChatErrorDetails(response.details);
        if (detailText) addSystemMessage(detailText);
      }
      if (response?.cancelled) {
        addSystemMessage(t("cancelled"));
        setStatus("ready", t("ready"));
        return;
      }
      throw new Error(response?.error || "Unknown error");
    }

    if (thisGeneration === chatGeneration) {
      messages.push({ role: "user", content: question });
      messages.push({ role: "assistant", content: response.result });
    }
    if (response?.partial) {
      addSystemMessage(t("streamPartialNotice"));
    }
    if (response?.usedFallback) {
      addSystemMessage(t("streamRecovered"));
    }
    setStatus("ready", t("ready"));
  } catch (err) {
    cancelAssistantStreamRender();
    if (err?.details) {
      const detailText = formatChatErrorDetails(err.details);
      if (detailText) addSystemMessage(detailText);
    }
    if (err?.cancelled) {
      addSystemMessage(t("cancelled"));
      setStatus("ready", t("ready"));
      return;
    }
    if (activeStreamPort) {
      try {
        activeStreamPort.disconnect();
      } catch (_) {
        // ignore
      }
      activeStreamPort = null;
    }
    const msg = err?.error || err?.message || String(err);
    setStatus("error", `${t("sendFailed")}: ${msg}`);
  } finally {
    endSendingState();
    input.focus();
  }
}

async function clearChat() {
  chatGeneration += 1;
  await cancelSending();
  cancelAssistantStreamRender();
  if (activeStreamPort) {
    try {
      activeStreamPort.disconnect();
    } catch (_) {
      // ignore
    }
    activeStreamPort = null;
  }
  messages = [];
  pageContent = null;
  activeHsdId = null;
  activeConversationId = null;
  renderQuickActions();
  renderSessionHsdLabel();
  renderStatusConversationId();
  hidePageInfo();
  clearMessageContainer();
  addSystemMessage(t("cleared"));
  promptForHsdId();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const messageInput = document.getElementById("messageInput");
    if (!messageInput) return;

    let stored = { chatFontSize: 14, streamRealtimeFormatting: false };
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        stored = await chrome.storage.local.get({ chatFontSize: 14, streamRealtimeFormatting: false });
      }
    } catch (_) {
      // Fallback to defaults when storage API is temporarily unavailable.
    }

    streamRealtimeFormatting = Boolean(stored.streamRealtimeFormatting);
    currentLanguage = "en";
    applyLanguage();
    applyFontSize(stored.chatFontSize);

    const bindClick = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", handler);
    };

    bindClick("loadPageBtn", loadPage);
    bindClick("loadClipboardBtn", loadClipboard);
    bindClick("settingsBtn", (e) => {
      e.stopPropagation();
      toggleSettingsMenu();
    });
    bindClick("importHsdBtn", async () => {
      closeSettingsMenu();
      await importHsdIdFromWebpage();
    });
    bindClick("debugMenuBtn", async () => {
      closeSettingsMenu();
      await debugConnection();
    });
    bindClick("formatModeBtn", async () => {
      streamRealtimeFormatting = !streamRealtimeFormatting;
      applyLanguage();
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ streamRealtimeFormatting });
      }
    });
    bindClick("clearBtn", clearChat);
    bindClick("sendBtn", sendMessage);
    bindClick("stopBtn", cancelSending);
    bindClick("quickPunchlineBtn", () => {
      if (!activeHsdId || isSending) return;
      const inputEl = document.getElementById("messageInput");
      if (!inputEl) return;
      inputEl.value = buildPunchlinePrompt(activeHsdId);
      inputEl.style.height = "auto";
      inputEl.style.height = `${inputEl.scrollHeight}px`;
      sendMessage();
    });

    bindClick("fontIncBtn", async () => {
      applyFontSize(currentFontSize + FONT_STEP);
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ chatFontSize: currentFontSize });
      }
    });

    bindClick("fontDecBtn", async () => {
      applyFontSize(currentFontSize - FONT_STEP);
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ chatFontSize: currentFontSize });
      }
    });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener("input", () => {
    if (!activeHsdId) {
      const sanitized = messageInput.value.replace(/\D/g, "").slice(0, HSD_ID_LENGTH);
      if (sanitized !== messageInput.value) {
        messageInput.value = sanitized;
      }
    }
    messageInput.style.height = "auto";
    messageInput.style.height = `${messageInput.scrollHeight}px`;
  });

    try {
      await ensureBridgeOnPanelOpen();
    } catch (err) {
      const msg = err?.message || String(err);
      setStatus("error", `${t("bridgeAutoStartFailed")}: ${msg}`);
    }

    renderQuickActions();
    renderSessionHsdLabel();
    renderStatusConversationId();
    promptForHsdId();
    window.addEventListener("resize", updateHeaderLayoutForOverlap);
    document.addEventListener("click", (event) => {
      const wrap = document.querySelector(".settings-wrap");
      if (!wrap) return;
      if (!wrap.contains(event.target)) {
        closeSettingsMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeSettingsMenu();
    });
    messageInput.focus();
  } catch (err) {
    const msg = err?.message || String(err);
    setStatus("error", `${t("sendFailed")}: ${msg}`);
    console.error("sidepanel init failed", err);
  }
});
