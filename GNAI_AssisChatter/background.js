// background.js - GNAI AssisChatter service worker (bridge mode)

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

const BRIDGE_CONFIG = {
  gnaiBaseUrl: "http://127.0.0.1:8775/v1",
  gnaiApiKey: "",
  gnaiModel: "gpt-4o",
  gnaiAssistant: "sighting_assistant",
  gnaiTemperature: 0.3,
  gnaiMaxTokens: 2000
};

const SYSTEM_PROMPTS = {
  "zh-TW": "你是一位專業且友善的 GNAI 助理。請使用繁體中文回答，優先基於使用者提供的網頁內容進行分析與問答。",
  "en": "You are a professional and helpful GNAI assistant. Answer in clear English and prioritize the provided webpage context."
};

async function getConfig() {
  const stored = await chrome.storage.local.get({ language: "zh-TW" });
  return {
    gnaiBaseUrl: BRIDGE_CONFIG.gnaiBaseUrl,
    gnaiApiKey: BRIDGE_CONFIG.gnaiApiKey,
    gnaiModel: BRIDGE_CONFIG.gnaiModel,
    gnaiAssistant: BRIDGE_CONFIG.gnaiAssistant,
    gnaiTemperature: BRIDGE_CONFIG.gnaiTemperature,
    gnaiMaxTokens: BRIDGE_CONFIG.gnaiMaxTokens,
    language: String(stored.language || "zh-TW").trim()
  };
}

function buildHealthCandidates(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return [];

  const candidates = [
    `${normalized}/health`,
    `${normalized}/v1/health`,
    `${normalized.replace(/\/v\d+$/i, "")}/health`,
    `${normalized.replace(/\/v\d+$/i, "")}/v1/health`
  ];

  return [...new Set(candidates.filter(Boolean))];
}

function buildEndpointCandidates(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return [];

  const hasVersionSuffix = /\/v\d+$/i.test(normalized);
  const v1Base = hasVersionSuffix ? normalized : `${normalized}/v1`;

  const candidates = [
    `${v1Base}/chat/completions`,
    `${normalized}/chat/completions`
  ];

  return [...new Set(candidates)];
}

async function callGnaiDetailed(messages, language, config) {
  if (!config.gnaiBaseUrl) {
    throw new Error("GNAI bridge base URL 設定缺失，請檢查 background.js。");
  }

  const endpoints = buildEndpointCandidates(config.gnaiBaseUrl);
  if (endpoints.length === 0) {
    throw new Error("無效的 GNAI Base URL");
  }

  const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS["zh-TW"];
  const payload = {
    model: config.gnaiModel,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: Number.isFinite(config.gnaiTemperature) ? config.gnaiTemperature : 0.3,
    max_tokens: Number.isFinite(config.gnaiMaxTokens) ? config.gnaiMaxTokens : 2000,
    assistant: config.gnaiAssistant
  };

  let lastError = "";
  const attempts = [];

  for (const url of endpoints) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "x-gnai-assistant": config.gnaiAssistant
      };

      if (config.gnaiApiKey) {
        headers.Authorization = `Bearer ${config.gnaiApiKey}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      attempts.push({ endpoint: url, status: response.status, ok: response.ok });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastError = `API error ${response.status} at ${url}: ${text}`;
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content;
      if (!content) {
        throw new Error("GNAI 回傳內容為空");
      }

      return {
        content,
        endpoint: url,
        status: response.status,
        attempts
      };
    } catch (err) {
      lastError = `${url}: ${err.message || String(err)}`;
      attempts.push({ endpoint: url, error: err.message || String(err), ok: false });
    }
  }

  const error = new Error(lastError || "呼叫 GNAI 失敗");
  error.attempts = attempts;
  throw error;
}

async function callGnai(messages, language, config) {
  const detailed = await callGnaiDetailed(messages, language, config);
  return detailed.content;
}

async function debugBridgeConnection(config) {
  const healthChecks = [];
  const healthCandidates = buildHealthCandidates(config.gnaiBaseUrl);

  for (const url of healthCandidates) {
    try {
      const response = await fetch(url, { method: "GET" });
      const text = await response.text().catch(() => "");
      healthChecks.push({
        url,
        ok: response.ok,
        status: response.status,
        bodySnippet: text.slice(0, 300)
      });
    } catch (err) {
      healthChecks.push({
        url,
        ok: false,
        error: err.message || String(err)
      });
    }
  }

  const pingMessages = [{ role: "user", content: "ping" }];
  const pingResult = await callGnaiDetailed(pingMessages, config.language || "zh-TW", config);

  return {
    bridgeBaseUrl: config.gnaiBaseUrl,
    assistant: config.gnaiAssistant,
    model: config.gnaiModel,
    healthChecks,
    ping: {
      ok: true,
      endpoint: pingResult.endpoint,
      status: pingResult.status,
      contentSnippet: String(pingResult.content || "").slice(0, 300),
      attempts: pingResult.attempts
    }
  };
}

async function getPageContent(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      let text = document.body ? document.body.innerText || "" : "";
      const title = document.title || "";
      const url = window.location.href || "";

      const MAX_LEN = 15000;
      if (text.length > MAX_LEN) {
        text = text.slice(0, MAX_LEN) + "\n\n[... content truncated ...]";
      }

      return { text, title, url, originalLength: text.length };
    }
  });

  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTENT") {
    (async () => {
      try {
        const content = await getPageContent(message.tabId);
        if (!content?.text?.trim()) {
          sendResponse({ ok: false, error: "無法取得頁面內容或內容為空" });
          return;
        }
        sendResponse({ ok: true, content });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "CHAT") {
    (async () => {
      try {
        const config = await getConfig();
        const detailed = await callGnaiDetailed(message.messages || [], message.language || "zh-TW", config);
        sendResponse({
          ok: true,
          result: detailed.content,
          debug: {
            endpoint: detailed.endpoint,
            status: detailed.status,
            attempts: detailed.attempts
          }
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err), attempts: err.attempts || [] });
      }
    })();
    return true;
  }

  if (message.type === "CHECK_CONNECTION") {
    (async () => {
      try {
        const config = await getConfig();
        if (!config.gnaiBaseUrl) {
          sendResponse({ ok: false, error: "請先設定 Base URL" });
          return;
        }

        const details = await debugBridgeConnection(config);
        sendResponse({ ok: true, details });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err), attempts: err.attempts || [] });
      }
    })();
    return true;
  }
});
