const TRANSLATIONS = {
  "zh-TW": {
    ready: "準備就緒",
    loadingPage: "載入網頁中...",
    loadingClipboard: "載入剪貼簿中...",
    sending: "發送中...",
    send: "發送",
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
    send: "Send",
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

let currentLanguage = "zh-TW";
let currentFontSize = 14;
let messages = [];
let pageContent = null;

function t(key) {
  return TRANSLATIONS[currentLanguage]?.[key] || key;
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
}

function addSystemMessage(content) {
  addMessage("system", content);
}

function applyLanguage() {
  document.getElementById("sendBtn").textContent = t("send");
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

async function prepareConnectionLanguage() {
  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "PREPARE_CONNECTION",
          language: currentLanguage
        },
        () => resolve()
      );
    });
  } catch (_) {
    // Warmup is best-effort; chat flow can still continue even if it fails.
  }
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

  const isZh = currentLanguage === "zh-TW";
  const context = isZh
    ? `頁面標題: ${pageContent.title}\n頁面網址: ${pageContent.url}\n\n頁面內容:\n${pageContent.text}`
    : `Page Title: ${pageContent.title}\nPage URL: ${pageContent.url}\n\nPage Content:\n${pageContent.text}`;
  const questionPrefix = isZh ? "使用者問題" : "User Question";

  if (messages.length === 0) {
    return [{ role: "user", content: `${context}\n\n${questionPrefix}: ${userQuestion}` }];
  }

  return [...messages, { role: "user", content: `${context}\n\n${questionPrefix}: ${userQuestion}` }];
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const question = input.value.trim();

  if (!question) {
    setStatus("error", t("emptyQuestion"));
    return;
  }

  try {
    setStatus("loading", t("sending"));
    sendBtn.disabled = true;
    input.disabled = true;

    addMessage("user", question);
    input.value = "";
    input.style.height = "auto";

    const apiMessages = buildApiMessages(question);
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "CHAT",
          messages: apiMessages,
          language: currentLanguage
        },
        resolve
      );
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unknown error");
    }

    addMessage("assistant", response.result);
    messages.push({ role: "user", content: question });
    messages.push({ role: "assistant", content: response.result });
    setStatus("ready", t("ready"));
  } catch (err) {
    setStatus("error", `${t("sendFailed")}: ${err.message || String(err)}`);
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
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
  const languageSelect = document.getElementById("languageSelect");
  const messageInput = document.getElementById("messageInput");

  const stored = await chrome.storage.local.get({ language: "zh-TW", chatFontSize: 14 });
  currentLanguage = ["zh-TW", "en"].includes(stored.language) ? stored.language : "zh-TW";
  languageSelect.value = currentLanguage;
  applyLanguage();
  applyFontSize(stored.chatFontSize);
  await prepareConnectionLanguage();

  document.getElementById("loadPageBtn").addEventListener("click", loadPage);
  document.getElementById("loadClipboardBtn").addEventListener("click", loadClipboard);
  document.getElementById("debugBtn").addEventListener("click", debugConnection);
  document.getElementById("clearBtn").addEventListener("click", clearChat);
  document.getElementById("sendBtn").addEventListener("click", sendMessage);

  document.getElementById("fontIncBtn").addEventListener("click", async () => {
    applyFontSize(currentFontSize + FONT_STEP);
    await chrome.storage.local.set({ chatFontSize: currentFontSize });
  });

  document.getElementById("fontDecBtn").addEventListener("click", async () => {
    applyFontSize(currentFontSize - FONT_STEP);
    await chrome.storage.local.set({ chatFontSize: currentFontSize });
  });

  languageSelect.addEventListener("change", async () => {
    currentLanguage = languageSelect.value;
    await chrome.storage.local.set({ language: currentLanguage });
    await prepareConnectionLanguage();
    applyLanguage();
    setStatus("ready", t("ready"));
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
