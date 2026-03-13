const TRANSLATIONS = {
  "zh-TW": {
    ready: "準備就緒",
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
    debugConn: "Debug 連線",
    debugRunning: "ＧＮＡＩ連線檢查中...",
    debugDone: "連線測試完成",
    debugFailed: "連線測試失敗",
    debugSuccess: "連線測試成功",
    debugTitle: "Bridge 除錯結果",
    titleStart: "開始對話",
    textStart: "請直接輸入問題開始對話。",
    inputPlaceholder: "輸入您的問題..."
  },
  "en": {
    ready: "Ready",
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
    debugConn: "Debug Connection",
    debugRunning: "Running diagnostics...",
    debugDone: "Diagnostics complete",
    debugFailed: "Diagnostics failed",
    debugSuccess: "Connection test successful",
    debugTitle: "Bridge Debug Result",
    titleStart: "Start conversation",
    textStart: "Type your question to start the conversation.",
    inputPlaceholder: "Type your question..."
  }
};

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 20;
const FONT_STEP = 1;

let currentLanguage = "en";
let currentFontSize = 14;
let messages = [];
let pageContent = null;
let sendingTicker = null;
let sendingStartedAt = 0;
let isSending = false;
let activeStreamPort = null;

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

function applyLanguage() {
  document.getElementById("sendBtn").textContent = t("send");
  const stopBtn = document.getElementById("stopBtn");
  if (stopBtn) stopBtn.textContent = t("stop");
  const debugBtn = document.getElementById("debugBtn");
  if (debugBtn) debugBtn.textContent = t("debugConn");
  document.getElementById("messageInput").placeholder = t("inputPlaceholder");
  if (document.getElementById("messages").querySelector(".empty-state")) {
    clearMessageContainer();
  }
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
  if (!pageContent) {
    return [...messages, { role: "user", content: userQuestion }];
  }

  const context = `Page Title: ${pageContent.title}\nPage URL: ${pageContent.url}\n\nPage Content:\n${pageContent.text}`;
  const questionPrefix = "User Question";

  if (messages.length === 0) {
    return [{ role: "user", content: `${context}\n\n${questionPrefix}: ${userQuestion}` }];
  }

  return [...messages, { role: "user", content: `${context}\n\n${questionPrefix}: ${userQuestion}` }];
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const question = input.value.trim();

  if (!question) {
    setStatus("error", t("emptyQuestion"));
    return;
  }

  try {
    startSendingState();

    addMessage("user", question);
    input.value = "";
    input.style.height = "auto";

    const apiMessages = buildApiMessages(question);
    const assistantEl = addMessage("assistant", "");
    const response = await new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "chat-stream" });
      activeStreamPort = port;
      let received = "";
      let settled = false;

      port.onMessage.addListener((event) => {
        if (event?.type === "chunk") {
          received += String(event.delta || "");
          renderAssistantMessage(assistantEl, received);
          return;
        }

        if (event?.type === "done") {
          const finalText = String(event.result || received || "");
          renderAssistantMessage(assistantEl, finalText);
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
          reject({ ok: false, error: "Stream disconnected unexpectedly" });
        }
        activeStreamPort = null;
      });

      port.postMessage({
        type: "CHAT_STREAM",
        messages: apiMessages,
        language: "en"
      });
    });

    if (!response?.ok) {
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

    messages.push({ role: "user", content: question });
    messages.push({ role: "assistant", content: response.result });
    setStatus("ready", t("ready"));
  } catch (err) {
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

function clearChat() {
  messages = [];
  pageContent = null;
  hidePageInfo();
  clearMessageContainer();
  addSystemMessage(t("cleared"));
  setStatus("ready", t("ready"));
}

document.addEventListener("DOMContentLoaded", async () => {
  const messageInput = document.getElementById("messageInput");

  const stored = await chrome.storage.local.get({ chatFontSize: 14 });
  currentLanguage = "en";
  applyLanguage();
  applyFontSize(stored.chatFontSize);

  document.getElementById("loadPageBtn").addEventListener("click", loadPage);
  document.getElementById("loadClipboardBtn").addEventListener("click", loadClipboard);
  document.getElementById("debugBtn").addEventListener("click", debugConnection);
  document.getElementById("clearBtn").addEventListener("click", clearChat);
  document.getElementById("sendBtn").addEventListener("click", sendMessage);
  document.getElementById("stopBtn").addEventListener("click", cancelSending);

  document.getElementById("fontIncBtn").addEventListener("click", async () => {
    applyFontSize(currentFontSize + FONT_STEP);
    await chrome.storage.local.set({ chatFontSize: currentFontSize });
  });

  document.getElementById("fontDecBtn").addEventListener("click", async () => {
    applyFontSize(currentFontSize - FONT_STEP);
    await chrome.storage.local.set({ chatFontSize: currentFontSize });
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = `${messageInput.scrollHeight}px`;
  });

  setStatus("ready", t("ready"));
});
