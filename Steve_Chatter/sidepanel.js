// sidepanel.js - Chatter Side Panel
// Using Intel Azure OpenAI

// Multi-language translations
const TRANSLATIONS = {
  'zh-TW': {
    'clear': '清除對話',
    'load-page': '載入網頁',
    'load-clipboard': '載入剪貼簿',
    'status-ready': '準備就緒',
    'status-loading-page': '載入網頁中...',
    'status-loading-clipboard': '載入剪貼簿中...',
    'status-page-loaded': '網頁已載入',
    'status-clipboard-loaded': '剪貼簿已載入',
    'status-sending': '發送中...',
    'status-error': '發生錯誤',
    'send': '發送',
    'empty-title': '開始對話',
    'empty-text': '可直接提問一般問題，或點擊「載入網頁 / 載入剪貼簿」後針對內容提問。',
    'input-placeholder': '輸入您的問題...',
    'system-page-loaded': '已載入網頁內容',
    'system-clipboard-loaded': '已載入剪貼簿內容',
    'system-cleared': '對話已清除',
    'error-no-tab': '找不到當前分頁',
    'error-load-page': '載入網頁失敗：',
    'error-load-clipboard': '載入剪貼簿失敗：',
    'error-clipboard-empty': '剪貼簿是空的',
    'error-send': '發送失敗：',
    'error-no-page': '請先載入網頁或剪貼簿',
    'error-empty-message': '請輸入問題',
    'page-access-checking': '頁面可讀取：檢查中...',
    'page-access-readable': '頁面可讀取：可用',
    'page-access-unreadable': '頁面可讀取：不可用'
  },
  'zh-CN': {
    'clear': '清除对话',
    'load-page': '载入网页',
    'load-clipboard': '载入剪贴板',
    'status-ready': '准备就绪',
    'status-loading-page': '载入网页中...',
    'status-loading-clipboard': '载入剪贴板中...',
    'status-page-loaded': '网页已载入',
    'status-clipboard-loaded': '剪贴板已载入',
    'status-sending': '发送中...',
    'status-error': '发生错误',
    'send': '发送',
    'empty-title': '开始对话',
    'empty-text': '可直接提问一般问题，或点击「载入网页 / 载入剪贴板」后针对内容提问。',
    'input-placeholder': '输入您的问题...',
    'system-page-loaded': '已载入网页内容',
    'system-clipboard-loaded': '已载入剪贴板内容',
    'system-cleared': '对话已清除',
    'error-no-tab': '找不到当前标签页',
    'error-load-page': '载入网页失败：',
    'error-load-clipboard': '载入剪贴板失败：',
    'error-clipboard-empty': '剪贴板是空的',
    'error-send': '发送失败：',
    'error-no-page': '请先载入网页或剪贴板',
    'error-empty-message': '请输入问题',
    'page-access-checking': '页面可读取：检查中...',
    'page-access-readable': '页面可读取：可用',
    'page-access-unreadable': '页面可读取：不可用'
  },
  'en': {
    'clear': 'Clear Chat',
    'load-page': 'Load Page',
    'load-clipboard': 'Load Clipboard',
    'status-ready': 'Ready',
    'status-loading-page': 'Loading page...',
    'status-loading-clipboard': 'Loading clipboard...',
    'status-page-loaded': 'Page loaded',
    'status-clipboard-loaded': 'Clipboard loaded',
    'status-sending': 'Sending...',
    'status-error': 'Error occurred',
    'send': 'Send',
    'empty-title': 'Start Conversation',
    'empty-text': 'You can ask general questions directly, or load a page/clipboard first and ask about that content.',
    'input-placeholder': 'Type your question...',
    'system-page-loaded': 'Page content loaded',
    'system-clipboard-loaded': 'Clipboard content loaded',
    'system-cleared': 'Chat cleared',
    'error-no-tab': 'Cannot find current tab',
    'error-load-page': 'Failed to load page: ',
    'error-load-clipboard': 'Failed to load clipboard: ',
    'error-clipboard-empty': 'Clipboard is empty',
    'error-send': 'Failed to send: ',
    'error-no-page': 'Please load page or clipboard first',
    'error-empty-message': 'Please enter a question',
    'page-access-checking': 'Page readable: checking...',
    'page-access-readable': 'Page readable: yes',
    'page-access-unreadable': 'Page readable: no'
  }
};

let currentLanguage = 'zh-TW';
let messages = []; // Chat history
let pageContent = null; // Loaded page content
const SUPPORTED_LANGUAGES = ['zh-TW', 'en'];
const SUPPORTED_MODELS = ['gpt-4o', 'gpt-5.2'];
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 20;
const FONT_SIZE_STEP = 1;
let currentFontSize = 14;
let currentModel = 'gpt-4o';

const QUOTA_LIMIT_HEADERS = [
  'ratelimit-limit',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens'
];
const QUOTA_REMAINING_HEADERS = [
  'ratelimit-remaining',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens'
];

const QUOTA_LOADING_TEXT = '讀取配額中...';

let quotaProgressFillEl = null;
let quotaProgressLabelEl = null;
let refreshQuotaBtnEl = null;
let quotaSyncInProgress = false;
let pendingQuotaIncrements = 0;
let quotaProgressState = {
  model: 'gpt-4o',
  used: null,
  limit: null,
  remaining: null,
  fallbackText: 'gpt-4o quota unavailable'
};

function t(key) {
  return TRANSLATIONS[currentLanguage]?.[key] || key;
}

function updateUILanguage() {
  // Update text elements
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const text = t(key);
    
    if (key === 'empty-text') {
      element.innerHTML = text.replace(/\n/g, '<br>');
    } else {
      element.textContent = text;
    }
  });
  
  // Update placeholder
  const input = document.getElementById('messageInput');
  input.placeholder = t('input-placeholder');

  const pageAccessText = document.getElementById('pageAccessText');
  if (pageAccessText && pageAccessText.dataset.state) {
    if (pageAccessText.dataset.state === 'readable') {
      pageAccessText.textContent = t('page-access-readable');
    } else if (pageAccessText.dataset.state === 'unreadable') {
      pageAccessText.textContent = t('page-access-unreadable');
    } else {
      pageAccessText.textContent = t('page-access-checking');
    }
  }
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function updateStatus(type, text) {
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");
  
  statusIndicator.className = `status-indicator ${type}`;
  statusText.textContent = text || "";
}

function clampFontSize(size) {
  const numeric = Number(size);
  if (Number.isNaN(numeric)) return 14;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, numeric));
}

function applyFontSize(size) {
  currentFontSize = clampFontSize(size);
  document.documentElement.style.setProperty('--chat-font-size', `${currentFontSize}px`);

  const decBtn = document.getElementById('fontDecBtn');
  const incBtn = document.getElementById('fontIncBtn');
  if (decBtn) decBtn.disabled = currentFontSize <= FONT_SIZE_MIN;
  if (incBtn) incBtn.disabled = currentFontSize >= FONT_SIZE_MAX;
}

async function changeFontSize(delta) {
  applyFontSize(currentFontSize + delta);
  await chrome.storage.local.set({ chatFontSize: currentFontSize });
}

function addMessage(role, content) {
  const container = document.getElementById('messagesContainer');
  
  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  if (role === 'assistant') {
    // Simple markdown-like formatting
    let html = content;
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    messageDiv.innerHTML = html;
  } else {
    messageDiv.textContent = content;
  }
  
  container.appendChild(messageDiv);
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function addSystemMessage(content) {
  const container = document.getElementById('messagesContainer');
  
  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  messageDiv.textContent = content;
  
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
}

function clearMessages() {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">💭</div>
      <div class="empty-state-title" data-i18n="empty-title">${t('empty-title')}</div>
      <div class="empty-state-text" data-i18n="empty-text">${t('empty-text').replace(/\n/g, '<br>')}</div>
    </div>
  `;
}

function showPageInfo(title, url) {
  const pageInfo = document.getElementById('pageInfo');
  const pageTitle = document.getElementById('pageTitle');
  const pageUrl = document.getElementById('pageUrl');
  
  pageTitle.textContent = title;
  pageUrl.textContent = url;
  pageInfo.classList.add('show');
}

function hidePageInfo() {
  const pageInfo = document.getElementById('pageInfo');
  pageInfo.classList.remove('show');
}

function isPageUrlReadable(url) {
  if (!url) return false;
  return /^(https?:|file:)/i.test(url);
}

function setPageAccessBadge(state) {
  const badge = document.getElementById('pageAccessBadge');
  const text = document.getElementById('pageAccessText');
  if (!badge || !text) return;

  badge.classList.remove('readable', 'unreadable');
  text.dataset.state = state;

  if (state === 'readable') {
    badge.classList.add('readable');
    text.textContent = t('page-access-readable');
  } else if (state === 'unreadable') {
    badge.classList.add('unreadable');
    text.textContent = t('page-access-unreadable');
  } else {
    text.textContent = t('page-access-checking');
  }
}

async function refreshPageAccessBadge() {
  setPageAccessBadge('checking');
  try {
    const tab = await getCurrentTab();
    setPageAccessBadge(isPageUrlReadable(tab?.url) ? 'readable' : 'unreadable');
  } catch {
    setPageAccessBadge('unreadable');
  }
}

async function loadPage() {
  const loadPageBtn = document.getElementById('loadPageBtn');
  
  try {
    updateStatus('loading', t('status-loading-page'));
    loadPageBtn.disabled = true;
    await refreshPageAccessBadge();
    
    const tab = await getCurrentTab();
    if (!tab || !tab.id) {
      updateStatus('error', t('error-no-tab'));
      return;
    }
    
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "GET_PAGE_CONTENT",
          tabId: tab.id
        },
        resolve
      );
    });
    
    if (response && response.ok) {
      // Clear previous conversation when loading new page
      messages = [];
      clearMessages();
      
      pageContent = response.content;
      
      // Show page info
      showPageInfo(pageContent.title, pageContent.url);
      
      // Add system message
      addSystemMessage(t('system-page-loaded'));
      
      updateStatus('ready', t('status-page-loaded'));
    } else {
      updateStatus('error', t('error-load-page') + (response?.error || 'Unknown error'));
      pageContent = null;
    }
  } catch (err) {
    updateStatus('error', t('error-load-page') + err.message);
    pageContent = null;
  } finally {
    loadPageBtn.disabled = false;
  }
}

async function loadClipboard() {
  const loadClipboardBtn = document.getElementById('loadClipboardBtn');
  
  try {
    updateStatus('loading', t('status-loading-clipboard'));
    loadClipboardBtn.disabled = true;
    
    // Read clipboard text
    const clipboardText = await navigator.clipboard.readText();
    
    if (!clipboardText || clipboardText.trim().length === 0) {
      updateStatus('error', t('error-clipboard-empty'));
      return;
    }
    
    // Clear previous conversation when loading new content
    messages = [];
    clearMessages();
    
    // Create page content object from clipboard
    pageContent = {
      title: 'Clipboard Content',
      url: 'clipboard://',
      text: clipboardText.trim()
    };
    
    // Show page info
    showPageInfo('📋 ' + t('load-clipboard'), `${clipboardText.length} 字元`);
    
    // Add system message
    addSystemMessage(t('system-clipboard-loaded'));
    
    updateStatus('ready', t('status-clipboard-loaded'));
  } catch (err) {
    updateStatus('error', t('error-load-clipboard') + err.message);
    pageContent = null;
  } finally {
    loadClipboardBtn.disabled = false;
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const userMessage = input.value.trim();
  
  if (!userMessage) {
    updateStatus('error', t('error-empty-message'));
    return;
  }
  
  try {
    updateStatus('loading', t('status-sending'));
    sendBtn.disabled = true;
    input.disabled = true;

    // 每次按下發送先做本地配額 +1 模擬（上限封頂，不額外呼叫配額服務）
    incrementQuotaProgressLocally();
    
    // Add user message to UI
    addMessage('user', userMessage);
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Build messages array for API
    const apiMessages = [];
    
    // If page content is loaded, include it as context. Otherwise do normal chat.
    if (pageContent) {
      if (messages.length === 0) {
        const contextMessage = `Page Title: ${pageContent.title}\nPage URL: ${pageContent.url}\n\nPage Content:\n${pageContent.text}\n\n---\n\nUser Question: ${userMessage}`;
        apiMessages.push({ role: 'user', content: contextMessage });
      } else {
        const contextMessage = `Page Title: ${pageContent.title}\nPage URL: ${pageContent.url}\n\nPage Content:\n${pageContent.text}`;
        apiMessages.push({ role: 'user', content: contextMessage });
        apiMessages.push({ role: 'assistant', content: 'I have the page content. How can I help you?' });
        apiMessages.push(...messages);
        apiMessages.push({ role: 'user', content: userMessage });
      }
    } else {
      apiMessages.push(...messages);
      apiMessages.push({ role: 'user', content: userMessage });
    }
    
    // Send to API
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
    
    if (response && response.ok) {
      // Add assistant response to UI
      addMessage('assistant', response.result);
      
      // Update conversation history
      messages.push({ role: 'user', content: userMessage });
      messages.push({ role: 'assistant', content: response.result });
      
      updateStatus('ready', t('status-ready'));
    } else {
      updateStatus('error', t('error-send') + (response?.error || 'Unknown error'));
    }
  } catch (err) {
    updateStatus('error', t('error-send') + err.message);
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

function clearChat() {
  messages = [];
  pageContent = null;
  clearMessages();
  hidePageInfo();
  addSystemMessage(t('system-cleared'));
  updateStatus('ready', t('status-ready'));
}

function formatQuotaValue(headers, keys) {
  if (!headers) return null;
  for (const key of keys) {
    const value = headers[key];
    if (value === undefined || value === null) {
      continue;
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }
  return null;
}

function showQuotaLoadingState() {
  if (!quotaProgressFillEl || !quotaProgressLabelEl) return;
  quotaProgressFillEl.style.width = '0%';
  quotaProgressLabelEl.textContent = QUOTA_LOADING_TEXT;
}

function parseNumericValue(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeModelQuota(quotaInfo = {}) {
  const used = parseNumericValue(
    quotaInfo.used ?? quotaInfo.usage ?? quotaInfo.calls_used ?? quotaInfo.tokens_used
  );
  const limit = parseNumericValue(
    quotaInfo.limit ?? quotaInfo.max ?? quotaInfo.calls_limit ?? quotaInfo.tokens_limit
  );
  let remaining = parseNumericValue(
    quotaInfo.remaining ?? quotaInfo.calls_remaining ?? quotaInfo.tokens_remaining
  );

  if (remaining === null && used !== null && limit !== null) {
    remaining = Math.max(0, limit - used);
  }

  return { used, limit, remaining, quotaType: quotaInfo.quota_type };
}

function getOrderedModelQuotaEntries(modelQuotas, preferredModel = 'gpt-4o') {
  if (!modelQuotas || typeof modelQuotas !== 'object') return [];
  const entries = Object.entries(modelQuotas);
  const preferredIndex = entries.findIndex(
    ([model]) => model.toLowerCase() === preferredModel.toLowerCase()
  );
  if (preferredIndex > -1) {
    const [entry] = entries.splice(preferredIndex, 1);
    return [entry, ...entries];
  }
  return entries;
}

function getPrimaryModelQuota(modelQuotas, preferredModel = currentModel) {
  const ordered = getOrderedModelQuotaEntries(modelQuotas, preferredModel);
  if (ordered.length === 0) return null;
  const [model, info] = ordered[0];
  return { model, info: normalizeModelQuota(info) };
}

function formatModelQuotaLines(modelQuotas) {
  const entries = getOrderedModelQuotaEntries(modelQuotas);
  if (entries.length === 0) {
    return ['(無法取得模型配額資訊)'];
  }

  return entries.map(([model, info]) => {
    const normalized = normalizeModelQuota(info);
    const usedLabel = normalized.used !== null ? normalized.used : 'unknown';
    const limitLabel = normalized.limit !== null ? normalized.limit : 'unknown';
    const remainingLabel = normalized.remaining !== null ? normalized.remaining : 'unknown';
    const typeText = normalized.quotaType ? ` (${normalized.quotaType})` : '';
    return `- ${model}${typeText}: Used ${usedLabel}/${limitLabel} · Remaining ${remainingLabel}`;
  });
}

function updateQuotaProgressFromState() {
  if (!quotaProgressFillEl || !quotaProgressLabelEl) {
    return;
  }

  const limit = quotaProgressState.limit;
  const used = quotaProgressState.used;
  const remaining = quotaProgressState.remaining;
  const model = quotaProgressState.model || currentModel || 'gpt-4o';
  const fallbackText = quotaProgressState.fallbackText || `${model} quota unavailable`;
  const percent = limit && limit > 0 && used !== null
    ? Math.min(100, Math.max(0, (used / limit) * 100))
    : 0;
  quotaProgressFillEl.style.width = limit && limit > 0 ? `${percent}%` : '0%';

  let labelText = fallbackText;
  if (limit !== null || used !== null || remaining !== null) {
    const labelUsed = used !== null ? used : 'unknown';
    const labelLimit = limit !== null ? limit : 'unknown';
    const parts = [`${model} ${labelUsed}/${labelLimit} used`];
    if (remaining !== null) {
      parts.push(`${remaining} remaining`);
    }
    labelText = parts.join(' · ');
  }

  if (pendingQuotaIncrements > 0) {
    labelText += ` · pending +${pendingQuotaIncrements}`;
  }

  quotaProgressLabelEl.textContent = labelText;
}

function applyPendingQuotaIncrements() {
  if (pendingQuotaIncrements <= 0) {
    return;
  }

  const limit = quotaProgressState.limit;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    return;
  }

  let used = quotaProgressState.used;
  if (used === null || !Number.isFinite(used)) {
    if (quotaProgressState.remaining !== null && Number.isFinite(quotaProgressState.remaining)) {
      used = Math.max(0, limit - quotaProgressState.remaining);
    } else {
      used = 0;
    }
  }

  const nextUsed = Math.min(limit, used + pendingQuotaIncrements);
  quotaProgressState.used = nextUsed;
  quotaProgressState.remaining = Math.max(0, limit - nextUsed);
  pendingQuotaIncrements = 0;

  updateQuotaProgressFromState();
}

function renderQuotaProgress(result = {}, fallbackText) {
  if (!quotaProgressFillEl || !quotaProgressLabelEl) {
    return;
  }

  const headers = result.quotaHeaders || {};
  const primaryModel = getPrimaryModelQuota(result.modelQuotas);
  const headerLimit = formatQuotaValue(headers, QUOTA_LIMIT_HEADERS);
  const headerRemaining = formatQuotaValue(headers, QUOTA_REMAINING_HEADERS);

  const model = primaryModel?.model || currentModel || 'gpt-4o';
  const limit = primaryModel?.info.limit ?? headerLimit;
  let remaining = primaryModel?.info.remaining ?? headerRemaining;
  let used = primaryModel?.info.used;

  if (used === null && limit !== null && remaining !== null) {
    used = Math.max(0, limit - remaining);
  }

  if (limit !== null && used !== null) {
    used = Math.min(limit, Math.max(0, used));
    remaining = Math.max(0, limit - used);
  }

  quotaProgressState = {
    model,
    used,
    limit,
    remaining,
    fallbackText: fallbackText || `${model} quota unavailable`
  };

  updateQuotaProgressFromState();
}

function incrementQuotaProgressLocally() {
  if (quotaSyncInProgress) {
    pendingQuotaIncrements += 1;
    updateQuotaProgressFromState();
    return;
  }

  const limit = quotaProgressState.limit;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    pendingQuotaIncrements += 1;
    updateQuotaProgressFromState();
    return;
  }

  let used = quotaProgressState.used;
  if (used === null || !Number.isFinite(used)) {
    if (quotaProgressState.remaining !== null && Number.isFinite(quotaProgressState.remaining)) {
      used = Math.max(0, limit - quotaProgressState.remaining);
    } else {
      used = 0;
    }
  }

  const nextUsed = Math.min(limit, used + 1);
  quotaProgressState.used = nextUsed;
  quotaProgressState.remaining = Math.max(0, limit - nextUsed);
  quotaProgressState.fallbackText = `${quotaProgressState.model || currentModel || 'gpt-4o'} quota`;

  updateQuotaProgressFromState();
}

async function refreshQuotaProgress() {
  quotaSyncInProgress = true;
  showQuotaLoadingState();
  const response = await requestQuotaData();
  quotaSyncInProgress = false;

  if (response && response.ok) {
    renderQuotaProgress(response.result || {}, `${currentModel} quota`);
    applyPendingQuotaIncrements();
  } else {
    renderQuotaProgress({}, response?.error || `${currentModel} quota unavailable`);
  }
}

async function requestQuotaData() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CHECK_QUOTA' }, resolve);
    });
    return response;
  } catch (error) {
    console.error('Quota request failed', error);
    return { ok: false, error: error?.message || String(error) };
  }
}

function formatQuotaOutput(response) {
  const result = response?.result || {};
  const allModelQuotas = result.modelQuotas || {};
  const modelBlocks = SUPPORTED_MODELS.map((model) => {
    const rawInfo = allModelQuotas[model];
    const info = rawInfo ? normalizeModelQuota(rawInfo) : { used: null, limit: null, remaining: null };
    const usedLabel = info.used !== null ? info.used : 'N/A';
    const limitLabel = info.limit !== null ? info.limit : 'N/A';
    const remainingLabel = info.remaining !== null ? info.remaining : 'N/A';

    return [
      `${model}`,
      `Used: ${usedLabel}/${limitLabel}`,
      `Remaining: ${remainingLabel}`
    ].join('\n');
  });

  return modelBlocks.join('\n\n');
}

document.addEventListener("DOMContentLoaded", async () => {
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const loadPageBtn = document.getElementById("loadPageBtn");
  const loadClipboardBtn = document.getElementById("loadClipboardBtn");
  const clearBtn = document.getElementById("clearBtn");
  const modelSelect = document.getElementById('modelSelect');
  const languageSelect = document.getElementById("languageSelect");
  const fontDecBtn = document.getElementById('fontDecBtn');
  const fontIncBtn = document.getElementById('fontIncBtn');
  quotaProgressFillEl = document.getElementById('quotaProgressFill');
  quotaProgressLabelEl = document.getElementById('quotaProgressLabel');
  refreshQuotaBtnEl = document.getElementById('refreshQuotaBtn');

  // Load saved language preference
  const { language } = await chrome.storage.local.get({ language: 'zh-TW' });
  currentLanguage = SUPPORTED_LANGUAGES.includes(language) ? language : 'zh-TW';
  languageSelect.value = currentLanguage;
  if (language !== currentLanguage) {
    await chrome.storage.local.set({ language: currentLanguage });
  }

  const { openaiModel } = await chrome.storage.local.get({ openaiModel: 'gpt-4o' });
  currentModel = SUPPORTED_MODELS.includes(openaiModel) ? openaiModel : 'gpt-4o';
  if (modelSelect) {
    modelSelect.value = currentModel;
  }
  if (openaiModel !== currentModel) {
    await chrome.storage.local.set({ openaiModel: currentModel });
  }
  
  updateUILanguage();
  await refreshPageAccessBadge();

  const { chatFontSize } = await chrome.storage.local.get({ chatFontSize: 14 });
  applyFontSize(chatFontSize);

  // Language change handler
  languageSelect.addEventListener('change', async () => {
    const newLanguage = languageSelect.value;
    currentLanguage = SUPPORTED_LANGUAGES.includes(newLanguage) ? newLanguage : 'zh-TW';
    languageSelect.value = currentLanguage;
    await chrome.storage.local.set({ language: currentLanguage });

    updateUILanguage();
    updateStatus('ready', t('status-ready'));
    await refreshPageAccessBadge();
  });

  modelSelect?.addEventListener('change', async () => {
    const newModel = modelSelect.value;
    currentModel = SUPPORTED_MODELS.includes(newModel) ? newModel : 'gpt-4o';
    modelSelect.value = currentModel;
    await chrome.storage.local.set({ openaiModel: currentModel });

    quotaProgressState.model = currentModel;
    if (!quotaProgressState.fallbackText || quotaProgressState.fallbackText.includes('quota')) {
      quotaProgressState.fallbackText = `${currentModel} quota`;
    }
    updateQuotaProgressFromState();

    // Model changed: re-sync quota immediately so the progress reflects the selected model.
    updateStatus('loading', `更新 ${currentModel} 配額中...`);
    try {
      await refreshQuotaProgress();
      addSystemMessage(`✅ 已切換模型為 ${currentModel}，配額已同步更新`);
      updateStatus('ready', t('status-ready'));
    } catch (error) {
      addSystemMessage(`⚠️ 模型切換為 ${currentModel}，但配額同步失敗：${error?.message || String(error)}`);
      updateStatus('error', '配額同步失敗');
    }
  });

  // Initialize
  updateStatus('ready', t('status-ready'));

  // Keep readability indicator fresh when the panel becomes active again.
  window.addEventListener('focus', refreshPageAccessBadge);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshPageAccessBadge();
    }
  });

  refreshQuotaProgress();

  refreshQuotaBtnEl?.addEventListener('click', async () => {
    refreshQuotaBtnEl.disabled = true;
    updateStatus('loading', '檢查配額中...');
    showQuotaLoadingState();
    const response = await requestQuotaData();
    if (response && response.ok) {
      renderQuotaProgress(response.result || {}, `${currentModel} quota`);
      addSystemMessage(formatQuotaOutput(response));
      updateStatus('ready', t('status-ready'));
    } else {
      addSystemMessage('🔍 無法取得 quota：' + (response?.error || '未知錯誤'));
      renderQuotaProgress({}, response?.error || `${currentModel} quota unavailable`);
      updateStatus('error', '配額檢查失敗');
    }
    refreshQuotaBtnEl.disabled = false;
  });

  // Load page button
  loadPageBtn.addEventListener('click', loadPage);

  // Load clipboard button (currently hidden in UI)
  loadClipboardBtn?.addEventListener('click', loadClipboard);

  // Clear button
  clearBtn.addEventListener('click', clearChat);

  // Send button
  sendBtn.addEventListener('click', sendMessage);

  // Font size controls
  fontDecBtn.addEventListener('click', () => changeFontSize(-FONT_SIZE_STEP));
  fontIncBtn.addEventListener('click', () => changeFontSize(FONT_SIZE_STEP));

  // Enter to send (Shift+Enter for new line)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
  });
});
