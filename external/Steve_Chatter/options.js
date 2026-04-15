// options.js
// Manage provider settings via chrome.storage.local

const DEFAULTS = {
  provider: "azure",
  azureEndpoint: "",
  azureApiKey: "",
  azureDeployment: "",
  azureApiVersion: "2023-05-15",
  openaiBaseUrl: "",
  openaiApiKey: "",
  openaiModel: "gpt-4o"
};

function setStatus(message, isError = false) {
  const status = document.getElementById("saveStatus");
  status.textContent = message;
  status.style.color = isError ? "#b91c1c" : "#065f46";
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || "").trim().replace(/\/+$/, "");
}

function collectFormData() {
  return {
    provider: document.getElementById("provider").value,
    azureEndpoint: normalizeEndpoint(document.getElementById("azureEndpoint").value),
    azureApiKey: document.getElementById("azureApiKey").value.trim(),
    azureDeployment: document.getElementById("azureDeployment").value.trim(),
    azureApiVersion: document.getElementById("azureApiVersion").value.trim() || "2023-05-15",
    openaiBaseUrl: normalizeEndpoint(document.getElementById("openaiBaseUrl").value),
    openaiApiKey: document.getElementById("openaiApiKey").value.trim(),
    openaiModel: document.getElementById("openaiModel").value.trim() || "gpt-4o"
  };
}

function applyFormData(config) {
  document.getElementById("provider").value = config.provider || "azure";
  document.getElementById("azureEndpoint").value = config.azureEndpoint || "";
  document.getElementById("azureApiKey").value = config.azureApiKey || "";
  document.getElementById("azureDeployment").value = config.azureDeployment || "";
  document.getElementById("azureApiVersion").value = config.azureApiVersion || "2023-05-15";
  document.getElementById("openaiBaseUrl").value = config.openaiBaseUrl || "";
  document.getElementById("openaiApiKey").value = config.openaiApiKey || "";
  document.getElementById("openaiModel").value = config.openaiModel || "gpt-4o";
}

async function loadConfig() {
  const config = await chrome.storage.local.get(DEFAULTS);
  applyFormData(config);
}

function validateConfig(config) {
  if (config.provider === "openai-compatible") {
    if (!config.openaiBaseUrl) {
      return "請填寫 OpenAI-compatible Base URL";
    }
    if (!config.openaiApiKey) {
      return "請填寫 OpenAI-compatible API Key";
    }
    if (!config.openaiModel) {
      return "請填寫 OpenAI-compatible Model";
    }
    return "";
  }

  if (!config.azureEndpoint) {
    return "請填寫 Azure Endpoint";
  }
  if (!config.azureApiKey) {
    return "請填寫 Azure API Key";
  }
  if (!config.azureDeployment) {
    return "請填寫 Azure Deployment";
  }
  if (!config.azureApiVersion) {
    return "請填寫 Azure API Version";
  }
  return "";
}

function parseEnvText(text) {
  const result = {};
  const lines = String(text || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("azureConfigForm");
  const clearBtn = document.getElementById("clearConfigBtn");
  const importEnvBtn = document.getElementById("importEnvBtn");
  const envInput = document.getElementById("envInput");
  const checkQuotaBtn = document.getElementById("checkQuotaBtn");
  const quotaStatus = document.getElementById("quotaStatus");
  const quotaResult = document.getElementById("quotaResult");

  await loadConfig();
  setStatus("已載入目前設定");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const config = collectFormData();
    const validationError = validateConfig(config);
    if (validationError) {
      setStatus(validationError, true);
      return;
    }

    await chrome.storage.local.set(config);
    setStatus("已儲存模型設定");
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.set(DEFAULTS);
    applyFormData(DEFAULTS);
    setStatus("已清空設定");
  });

  importEnvBtn.addEventListener("click", () => {
    const parsed = parseEnvText(envInput.value);
    const mapped = {
      provider: parsed.OPENAI_BASE_URL ? "openai-compatible" : "azure",
      azureEndpoint: normalizeEndpoint(parsed.AZURE_OPENAI_ENDPOINT || ""),
      azureApiKey: (parsed.AZURE_OPENAI_API_KEY || "").trim(),
      azureDeployment: (parsed.AZURE_OPENAI_DEPLOYMENT || "").trim(),
      azureApiVersion: (parsed.AZURE_OPENAI_API_VERSION || "2023-05-15").trim(),
      openaiBaseUrl: normalizeEndpoint(parsed.OPENAI_BASE_URL || parsed.OPENAI_API_BASE || ""),
      openaiApiKey: (parsed.OPENAI_API_KEY || "").trim(),
      openaiModel: (parsed.OPENAI_MODEL || "gpt-4o").trim()
    };

    const hasAnyValue =
      mapped.azureEndpoint ||
      mapped.azureApiKey ||
      mapped.azureDeployment ||
      mapped.openaiBaseUrl ||
      mapped.openaiApiKey;

    if (!hasAnyValue) {
      setStatus("找不到可用參數（AZURE_OPENAI_* 或 OPENAI_*）", true);
      return;
    }

    applyFormData(mapped);
    setStatus("已從 .env 解析完成，請按「儲存設定」");
  });

  checkQuotaBtn.addEventListener("click", async () => {
    quotaStatus.textContent = "檢查中...";
    quotaStatus.style.color = "#374151";
    quotaResult.textContent = "正在向供應商查詢...";

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHECK_QUOTA" }, resolve);
    });

    if (!response || !response.ok) {
      quotaStatus.textContent = "檢查失敗";
      quotaStatus.style.color = "#b91c1c";
      quotaResult.textContent = response?.error || "Unknown error";
      return;
    }

    const result = response.result || {};
    const headers = result.quotaHeaders || {};
    const headerLines = Object.keys(headers).length
      ? Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "(供應商未回傳可讀取的 quota/rate-limit 標頭)";

    quotaStatus.textContent = "檢查完成";
    quotaStatus.style.color = "#065f46";
    quotaResult.textContent =
      `Provider: ${result.provider || "unknown"}\n` +
      `Endpoint: ${result.endpoint || "unknown"}\n` +
      `HTTP Status: ${result.status || "unknown"}\n\n` +
      `${headerLines}`;
  });
});
