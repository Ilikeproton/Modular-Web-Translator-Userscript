// ==UserScript==
// @name         Modular Web Translator Userscript
// @namespace    https://github.com/Ilikeproton/Modular-Web-Translator-Userscript
// @version      1.8.4
// @description  Extensible web page translator userscript with remote site and provider modules.
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.meta.js
// @downloadURL  https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "1.8.4";
  const MODULE_REGISTRY_NAME = "ModularWebTranslator";
  const REMOTE_BASE_URL =
    "https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main";
  const REMOTE_MANIFEST_URL = `${REMOTE_BASE_URL}/modules/manifest.json`;
  const REMOTE_PROVIDER_MANIFEST_URL = `${REMOTE_BASE_URL}/providers/manifest.json`;
  const AUTO_BALANCED_PROVIDER_ID = "auto-balanced";
  const STORAGE_KEY = "mwt-settings";
  const MANIFEST_CACHE_KEY = "mwt-manifest-cache";
  const PROVIDER_MANIFEST_CACHE_KEY = "mwt-provider-manifest-cache:v2";
  const MODULE_CACHE_KEY_PREFIX = "mwt-module-cache:";
  const PROVIDER_CACHE_KEY_PREFIX = "mwt-provider-cache:";
  const QUEUE_CONCURRENCY = 1;
  const DEFAULT_MANIFEST_TTL_MS = 30 * 60 * 1000;
  const DEFAULT_MODULE_TTL_MS = 30 * 60 * 1000;
  const TRANSLATION_RETRY_COOLDOWN_MS = 15000;
  const PROVIDER_REQUEST_POLICY = {
    default: {
      minIntervalMs: 1200,
      failureBackoffMs: 15000,
    },
    "google-web": {
      minIntervalMs: 1800,
      failureBackoffMs: 60000,
    },
    "google-fr-web": {
      minIntervalMs: 1800,
      failureBackoffMs: 60000,
    },
    "google-de-web": {
      minIntervalMs: 1800,
      failureBackoffMs: 60000,
    },
    "bing-web": {
      minIntervalMs: 2200,
      failureBackoffMs: 60000,
    },
    "lara-web": {
      minIntervalMs: 1500,
      failureBackoffMs: 30 * 60 * 1000,
    },
    "qq-web": {
      minIntervalMs: 2200,
      failureBackoffMs: 30000,
    },
    "yandex-web": {
      minIntervalMs: 2200,
      failureBackoffMs: 30000,
    },
    "youdao-web": {
      minIntervalMs: 2400,
      failureBackoffMs: 30000,
    },
    "deepl-web": {
      minIntervalMs: 2600,
      failureBackoffMs: 30000,
    },
    "baidu-web": {
      minIntervalMs: 2200,
      failureBackoffMs: 30000,
    },
    "sogou-web": {
      minIntervalMs: 2000,
      failureBackoffMs: 30000,
    },
  };

  const CONFIG = {
    debug: true,
    textPreviewLength: 96,
  };

  const LANGUAGE_OPTIONS = [
    {
      id: "zh-CN",
      label: "Simplified Chinese",
    },
    {
      id: "en",
      label: "English",
    },
    {
      id: "ja",
      label: "Japanese",
    },
    {
      id: "ko",
      label: "Korean",
    },
    {
      id: "fr",
      label: "French",
    },
    {
      id: "de",
      label: "German",
    },
    {
      id: "es",
      label: "Spanish",
    },
    {
      id: "ru",
      label: "Russian",
    },
    {
      id: "vi",
      label: "Vietnamese",
    },
    {
      id: "th",
      label: "Thai",
    },
  ];

  const DEFAULT_SETTINGS = {
    provider: AUTO_BALANCED_PROVIDER_ID,
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  };

  const state = {
    settings: null,
    providerManifest: getDefaultProviderManifest(),
    providerCatalog: new Map(),
    providerRegistry: new Map(),
    providerLoadTasks: new Map(),
    translationCache: new Map(),
    providerRequestState: new Map(),
    queue: [],
    activeRequests: 0,
    settingsListeners: new Set(),
    uiRoot: null,
    uiDetails: {
      title: "Modular Web Translator",
      moduleName: "",
      description: "",
    },
    translationDebugCounter: 0,
    uiNotice: "",
    outsideClickHandler: null,
    moduleRegistry: new Map(),
  };
  const builtInProviders = new Map();
  const builtInSiteModules = new Map();
  state.providerCatalog = new Map(
    state.providerManifest.providers.map((provider) => [provider.id, provider])
  );
  state.settings = normalizeSettings(readSettings());

  function log(...args) {
    if (!CONFIG.debug) {
      return;
    }

    console.log("[modular-web-translator]", ...args);
  }

  function previewText(text) {
    const normalized = normalizeInlineText(String(text || ""));
    if (!normalized) {
      return "";
    }

    if (normalized.length <= CONFIG.textPreviewLength) {
      return normalized;
    }

    return `${normalized.slice(0, CONFIG.textPreviewLength - 3)}...`;
  }

  function ensureStyles() {
    const css = `
      .mwt-translation-inline {
        margin-top: 8px;
        padding-left: 10px;
        border-left: 2px solid rgba(96, 165, 250, 0.45);
        color: inherit;
        font-size: inherit;
        line-height: inherit;
      }

      .mwt-translation-inline[data-state="loading"] {
        opacity: 0.65;
      }

      .mwt-translation-inline[data-state="error"] {
        border-left-color: rgba(239, 68, 68, 0.55);
      }

      .mwt-translation-meta {
        display: block;
        margin-bottom: 4px;
        color: inherit;
        opacity: 0.58;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .mwt-translation-text {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .mwt-settings-root {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .mwt-settings-toggle {
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
        color: #111827;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .mwt-settings-panel {
        position: absolute;
        right: 0;
        bottom: 52px;
        width: 300px;
        padding: 14px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
        color: #111827;
        display: none;
      }

      .mwt-settings-root[data-open="true"] .mwt-settings-panel {
        display: block;
      }

      .mwt-settings-title {
        margin: 0 0 6px;
        font-size: 14px;
        font-weight: 700;
      }

      .mwt-settings-subtitle {
        margin: 0 0 10px;
        font-size: 12px;
        line-height: 1.45;
        color: #4b5563;
      }

      .mwt-settings-field + .mwt-settings-field {
        margin-top: 10px;
      }

      .mwt-settings-label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 600;
        opacity: 0.72;
      }

      .mwt-settings-select {
        width: 100%;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 10px;
        background: #ffffff;
        color: #111827;
        padding: 8px 10px;
        font-size: 13px;
      }

      .mwt-settings-hint {
        margin-top: 10px;
        font-size: 12px;
        line-height: 1.45;
        color: #4b5563;
      }
    `;

    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getDefaultProviderManifest() {
    return normalizeProviderManifest({
      schemaVersion: 1,
      version: "1.8.3",
      cacheTtlMinutes: 30,
      moduleCacheTtlMinutes: 30,
      providers: [
        {
          id: "google-web",
          label: "Google Web",
          version: "1.0.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/google-web.provider.js`,
          minRuntimeVersion: "1.0.0",
          isDefault: true,
          languageMap: {
            "zh-CN": "zh-CN",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "google-fr-web",
          label: "Google FR Web",
          version: "1.0.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/google-fr-web.provider.js`,
          minRuntimeVersion: "1.5.0",
          languageMap: {
            "zh-CN": "zh-CN",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "google-de-web",
          label: "Google DE Web",
          version: "1.0.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/google-de-web.provider.js`,
          minRuntimeVersion: "1.5.0",
          languageMap: {
            "zh-CN": "zh-CN",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "bing-web",
          label: "Bing Web",
          version: "1.1.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/bing-web.provider.js`,
          minRuntimeVersion: "1.7.0",
          languageMap: {
            "zh-CN": "zh-Hans",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "lara-web",
          label: "Lara Web",
          version: "1.0.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/lara-web.provider.js`,
          minRuntimeVersion: "1.6.0",
          languageMap: {
            "zh-CN": "zh-CN",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "youdao-web",
          label: "Youdao Web",
          version: "1.1.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/youdao-web.provider.js`,
          minRuntimeVersion: "1.7.0",
          languageMap: {
            "zh-CN": "zh-CHS",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
        {
          id: "sogou-web",
          label: "Sogou Web",
          version: "1.1.0",
          scriptUrl: `${REMOTE_BASE_URL}/providers/sogou-web.provider.js`,
          minRuntimeVersion: "1.2.0",
          languageMap: {
            "zh-CN": "zh-CHS",
            en: "en",
            ja: "ja",
            ko: "ko",
            fr: "fr",
            de: "de",
            es: "es",
            ru: "ru",
            vi: "vi",
            th: "th",
          },
        },
      ],
    });
  }

  function normalizeProviderManifest(rawManifest) {
    const manifest = rawManifest && typeof rawManifest === "object" ? rawManifest : {};
    const providers = Array.isArray(manifest.providers) ? manifest.providers : [];

    return {
      schemaVersion: Number(manifest.schemaVersion) || 1,
      version: String(manifest.version || "1.0.0"),
      cacheTtlMinutes:
        Number(manifest.cacheTtlMinutes) || DEFAULT_MANIFEST_TTL_MS / 60 / 1000,
      moduleCacheTtlMinutes:
        Number(manifest.moduleCacheTtlMinutes) || DEFAULT_MODULE_TTL_MS / 60 / 1000,
      providers: providers
        .filter((entry) => entry && typeof entry === "object" && entry.id && entry.scriptUrl)
        .map((entry) => ({
          id: String(entry.id),
          label: String(entry.label || entry.id),
          version: String(entry.version || "1.0.0"),
          scriptUrl: String(entry.scriptUrl),
          minRuntimeVersion: String(entry.minRuntimeVersion || "1.0.0"),
          isDefault: Boolean(entry.isDefault),
          languageMap:
            entry.languageMap && typeof entry.languageMap === "object"
              ? Object.assign({}, entry.languageMap)
              : {},
        })),
    };
  }

  function setProviderManifest(manifest) {
    state.providerManifest = manifest;
    state.providerCatalog = new Map(manifest.providers.map((provider) => [provider.id, provider]));
  }

  function getConcreteProviderCatalogEntry(providerId) {
    return state.providerCatalog.get(providerId) || null;
  }

  function getConcreteProviderCatalogEntries() {
    return Array.from(state.providerCatalog.values());
  }

  function getAutoBalancedLanguageMap() {
    const languageMap = {};

    for (const provider of getConcreteProviderCatalogEntries()) {
      if (!provider || !provider.languageMap) {
        continue;
      }

      for (const [languageId, mappedLanguageId] of Object.entries(provider.languageMap)) {
        if (mappedLanguageId) {
          languageMap[languageId] = languageId;
        }
      }
    }

    return languageMap;
  }

  function getAutoBalancedProviderEntry() {
    return {
      id: AUTO_BALANCED_PROVIDER_ID,
      label: "Auto Balance",
      version: SCRIPT_VERSION,
      minRuntimeVersion: SCRIPT_VERSION,
      isVirtual: true,
      languageMap: getAutoBalancedLanguageMap(),
    };
  }

  function isVirtualProviderId(providerId) {
    return providerId === AUTO_BALANCED_PROVIDER_ID;
  }

  function getProviderCatalogEntry(providerId) {
    if (isVirtualProviderId(providerId)) {
      return getAutoBalancedProviderEntry();
    }

    return getConcreteProviderCatalogEntry(providerId);
  }

  function getProviderCatalogEntries() {
    return [getAutoBalancedProviderEntry()].concat(getConcreteProviderCatalogEntries());
  }

  function normalizeSettings(rawSettings) {
    const merged = Object.assign({}, DEFAULT_SETTINGS, rawSettings || {});
    const fallbackProvider = getProviderCatalogEntry(DEFAULT_SETTINGS.provider)
      ? DEFAULT_SETTINGS.provider
      : (getProviderCatalogEntries()[0] ? getProviderCatalogEntries()[0].id : DEFAULT_SETTINGS.provider);
    const provider = getProviderCatalogEntry(merged.provider)
      ? merged.provider
      : fallbackProvider;
    const languageId = findAvailableLanguageId(provider, merged.targetLanguage);

    return {
      provider,
      sourceLanguage: "auto",
      targetLanguage: languageId,
    };
  }

  function readSettings() {
    return storageGet(STORAGE_KEY, DEFAULT_SETTINGS);
  }

  function writeSettings(settings) {
    storageSet(STORAGE_KEY, settings);
  }

  function storageGet(key, fallbackValue) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallbackValue);
      }
    } catch (error) {
      log("GM_getValue failed", error);
    }

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch (error) {
      log("localStorage read failed", error);
    }

    return fallbackValue;
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
      }
    } catch (error) {
      log("GM_setValue failed", error);
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      log("localStorage write failed", error);
    }
  }

  function getAvailableLanguages(providerId) {
    const provider = getProviderCatalogEntry(providerId);
    if (!provider || !provider.languageMap) {
      return [];
    }

    return LANGUAGE_OPTIONS.filter((language) => provider.languageMap[language.id]);
  }

  function findAvailableLanguageId(providerId, requestedLanguageId) {
    const languages = getAvailableLanguages(providerId);
    if (languages.length === 0) {
      return DEFAULT_SETTINGS.targetLanguage;
    }
    const match = languages.find((language) => language.id === requestedLanguageId);
    return match ? match.id : languages[0].id;
  }

  function mapLanguageCode(languageId, providerId) {
    const provider = getProviderCatalogEntry(providerId);
    if (!provider || !provider.languageMap || !provider.languageMap[languageId]) {
      throw new Error(`Unsupported target language: ${languageId}`);
    }

    return provider.languageMap[languageId];
  }

  function getLanguageLabel(languageId) {
    const option = LANGUAGE_OPTIONS.find((language) => language.id === languageId);
    return option ? option.label : languageId;
  }

  function getProviderLabel(providerId) {
    const provider = getProviderCatalogEntry(providerId);
    return provider ? provider.label : providerId;
  }

  function ensureSettingsUi(details) {
    if (details) {
      state.uiDetails = Object.assign({}, state.uiDetails, details);
    }

    if (state.uiRoot) {
      syncSettingsUi();
      return state.uiRoot;
    }

    const root = document.createElement("div");
    root.className = "mwt-settings-root";
    root.dataset.open = "false";
    root.innerHTML = `
      <button type="button" class="mwt-settings-toggle">Translator</button>
      <section class="mwt-settings-panel">
        <h2 class="mwt-settings-title"></h2>
        <p class="mwt-settings-subtitle"></p>
        <div class="mwt-settings-field">
          <label class="mwt-settings-label" for="mwt-provider-select">Provider</label>
          <select id="mwt-provider-select" class="mwt-settings-select" data-setting="provider"></select>
        </div>
        <div class="mwt-settings-field">
          <label class="mwt-settings-label" for="mwt-language-select">Target Language</label>
          <select id="mwt-language-select" class="mwt-settings-select" data-setting="targetLanguage"></select>
        </div>
        <div class="mwt-settings-hint" data-role="hint"></div>
      </section>
    `;

    const toggle = root.querySelector(".mwt-settings-toggle");
    const providerSelect = root.querySelector("[data-setting='provider']");
    const languageSelect = root.querySelector("[data-setting='targetLanguage']");

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      root.dataset.open = root.dataset.open === "true" ? "false" : "true";
    });

    providerSelect.addEventListener("change", () => {
      void applySettingsFromUi(providerSelect.value, languageSelect.value);
    });

    languageSelect.addEventListener("change", () => {
      void applySettingsFromUi(providerSelect.value, languageSelect.value);
    });

    state.outsideClickHandler = (event) => {
      if (!root.contains(event.target)) {
        root.dataset.open = "false";
      }
    };

    document.addEventListener("click", state.outsideClickHandler);
    document.body.appendChild(root);
    state.uiRoot = root;
    syncSettingsUi();
    return root;
  }

  function syncSettingsUi() {
    if (!state.uiRoot) {
      return;
    }

    const title = state.uiRoot.querySelector(".mwt-settings-title");
    const subtitle = state.uiRoot.querySelector(".mwt-settings-subtitle");
    const providerSelect = state.uiRoot.querySelector("[data-setting='provider']");
    const languageSelect = state.uiRoot.querySelector("[data-setting='targetLanguage']");
    const hint = state.uiRoot.querySelector("[data-role='hint']");

    title.textContent = state.uiDetails.title || "Modular Web Translator";
    subtitle.textContent =
      state.uiDetails.description || "Remote site modules are loaded from GitHub.";

    providerSelect.innerHTML = getProviderCatalogEntries()
      .map((provider) => {
        const selected = provider.id === state.settings.provider ? " selected" : "";
        return `<option value="${escapeHtml(provider.id)}"${selected}>${escapeHtml(
          provider.label
        )}</option>`;
      })
      .join("");

    const availableLanguages = getAvailableLanguages(state.settings.provider);
    languageSelect.innerHTML = availableLanguages
      .map((language) => {
        const selected = language.id === state.settings.targetLanguage ? " selected" : "";
        return `<option value="${escapeHtml(language.id)}"${selected}>${escapeHtml(
          language.label
        )}</option>`;
      })
      .join("");

    const moduleLabel = state.uiDetails.moduleName ? `Active module: ${state.uiDetails.moduleName}. ` : "";
    const autoBalanceHint = isVirtualProviderId(state.settings.provider)
      ? " Requests are distributed across available providers to reduce rate limits."
      : "";
    const baseHint =
      `${moduleLabel}Provider: ${getProviderLabel(state.settings.provider)}. ` +
      `Language: ${getLanguageLabel(state.settings.targetLanguage)}.` +
      autoBalanceHint;
    hint.textContent = state.uiNotice ? `${baseHint} ${state.uiNotice}` : baseHint;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function applySettingsFromUi(providerId, languageId) {
    try {
      await applySettings({
        provider: providerId,
        targetLanguage: languageId,
      });
    } catch (error) {
      state.uiNotice = `Provider load failed: ${formatError(error)}`;
      syncSettingsUi();
      console.error("[modular-web-translator] failed to apply settings", error);
    }
  }

  async function applySettings(nextSettings) {
    const normalized = normalizeSettings(nextSettings);
    const currentSignature = JSON.stringify(state.settings);
    const nextSignature = JSON.stringify(normalized);

    if (currentSignature === nextSignature) {
      state.uiNotice = "";
      syncSettingsUi();
      return;
    }

    if (!isVirtualProviderId(normalized.provider)) {
      await ensureProviderLoaded(normalized.provider);
    }
    state.settings = normalized;
    state.uiNotice = "";
    writeSettings(normalized);
    syncSettingsUi();
    notifySettingsChanged();
  }

  function onSettingsChanged(listener) {
    state.settingsListeners.add(listener);
    return () => {
      state.settingsListeners.delete(listener);
    };
  }

  function notifySettingsChanged() {
    for (const listener of Array.from(state.settingsListeners)) {
      try {
        listener(Object.assign({}, state.settings));
      } catch (error) {
        console.error("[modular-web-translator] settings listener failed", error);
      }
    }
  }

  function createSection(slotLabel) {
    const root = document.createElement("div");
    root.className = "mwt-translation-inline";
    root.dataset.slot = slotLabel.toLowerCase();
    root.dataset.state = "loading";

    const meta = document.createElement("span");
    meta.className = "mwt-translation-meta";

    const text = document.createElement("div");
    text.className = "mwt-translation-text";

    root.appendChild(meta);
    root.appendChild(text);

    return {
      root,
      meta,
      text,
      slotLabel,
    };
  }

  function attachSectionAfter(section, anchor) {
    if (!section || !anchor || !anchor.parentElement) {
      return;
    }

    if (!section.root.isConnected || section.root.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement("afterend", section.root);
    }
  }

  function removeSection(section) {
    if (section && section.root && section.root.isConnected) {
      section.root.remove();
    }
  }

  function setSectionMeta(section, metaText) {
    if (!section) {
      return;
    }

    section.meta.textContent = metaText;
  }

  function setSectionLoading(section, metaText) {
    if (!section) {
      return;
    }

    section.root.dataset.state = "loading";
    section.meta.textContent = metaText;
    section.text.textContent = "Translating...";
  }

  function setSectionSuccess(section, metaText, translatedText) {
    if (!section) {
      return;
    }

    section.root.dataset.state = "ready";
    section.meta.textContent = metaText;
    section.text.textContent = translatedText;
  }

  function setSectionError(section, metaText, error) {
    if (!section) {
      return;
    }

    section.root.dataset.state = "error";
    section.meta.textContent = metaText;
    section.text.textContent = `Translation failed: ${formatError(error)}`;
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set(nodes));
  }

  function normalizeInlineText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeMultilineText(text) {
    return (text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
      .filter((line, index, list) => line || (index > 0 && list[index - 1]))
      .join("\n")
      .trim();
  }

  function getFirstText(root, selectors, normalizer) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (!element) {
        continue;
      }

      const text = normalizer(element.textContent);
      if (!text) {
        continue;
      }

      return {
        text,
        element,
      };
    }

    return null;
  }

  function formatError(error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    return message.length > 140 ? `${message.slice(0, 137)}...` : message;
  }

  function debounce(task, waitMs) {
    let timer = null;
    return function debounced(...args) {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        task.apply(this, args);
      }, waitMs);
    };
  }

  function buildFormBody(payload) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      params.append(key, value == null ? "" : String(value));
    }
    return params.toString();
  }

  function parseResponseCookies(responseHeaders) {
    const cookieParts = [];
    for (const line of String(responseHeaders || "").split(/\r?\n/)) {
      const match = line.match(/^set-cookie:\s*([^;]+)/i);
      if (match && match[1]) {
        cookieParts.push(match[1].trim());
      }
    }
    return cookieParts.join("; ");
  }

  function mergeCookieHeaders(...cookieHeaders) {
    const cookieMap = new Map();

    for (const header of cookieHeaders) {
      for (const cookiePart of String(header || "").split(/;\s*/)) {
        if (!cookiePart || !cookiePart.includes("=")) {
          continue;
        }

        const separatorIndex = cookiePart.indexOf("=");
        const name = cookiePart.slice(0, separatorIndex).trim();
        const value = cookiePart.slice(separatorIndex + 1).trim();

        if (!name) {
          continue;
        }

        cookieMap.set(name, `${name}=${value}`);
      }
    }

    return Array.from(cookieMap.values()).join("; ");
  }

  function request(options) {
    const method = options.method || "GET";
    const headers = Object.assign({}, options.headers || {});
    const timeoutMs = Math.max(1, Number(options.timeout) || 15000);

    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        let requestHandle = null;

        function settleWith(settler, value) {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          settler(value);
        }

        function rejectWith(message) {
          settleWith(reject, new Error(message));
        }

        timer = setTimeout(() => {
          try {
            if (requestHandle && typeof requestHandle.abort === "function") {
              requestHandle.abort();
            }
          } catch (error) {
            log("request abort failed", error);
          }

          rejectWith(`Request timed out for ${options.url}`);
        }, timeoutMs + 250);

        requestHandle = GM_xmlhttpRequest({
          method,
          url: options.url,
          headers,
          cookie: options.cookie,
          data: options.data,
          timeout: timeoutMs,
          onload(response) {
            if (response.status >= 200 && response.status < 300) {
              settleWith(resolve, response);
              return;
            }

            rejectWith(`HTTP ${response.status} for ${options.url}`);
          },
          onerror() {
            rejectWith(`Request failed for ${options.url}`);
          },
          ontimeout() {
            rejectWith(`Request timed out for ${options.url}`);
          },
          onabort() {
            rejectWith(`Request aborted for ${options.url}`);
          },
        });
      });
    }

    return fetch(options.url, {
      method,
      headers,
      body: options.data,
    }).then(async (response) => {
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${options.url}`);
      }

      return {
        status: response.status,
        responseText,
      };
    });
  }

  async function requestText(options) {
    const response = await request(options);
    return response.responseText;
  }

  async function requestJson(options) {
    const responseText = await requestText(options);

    try {
      return JSON.parse(responseText);
    } catch (error) {
      throw new Error(`JSON parse failed for ${options.url}`);
    }
  }

  function parseGoogleTranslation(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      return "";
    }

    return payload[0]
      .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
      .join("")
      .trim();
  }

  function registerBuiltInFallbacks() {
    registerBuiltInProviderFallbacks();
    registerExpandedBuiltInSiteModuleFallbacks();
  }

  function registerBuiltInProviderFallbacks() {
    function registerGoogleMirrorProvider(providerId, label, endpointBase, refererUrl) {
      builtInProviders.set(providerId, {
        id: providerId,
        label,
        async translateText(text, settings) {
          const targetLanguage = mapLanguageCode(settings.targetLanguage, providerId);
          const sourceLanguage = settings.sourceLanguage || "auto";
          const response = await requestJson({
            method: "POST",
            url:
              `${endpointBase}/translate_a/single?client=gtx&dt=t` +
              `&sl=${encodeURIComponent(sourceLanguage)}` +
              `&tl=${encodeURIComponent(targetLanguage)}`,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "application/json, text/plain, */*",
              Origin: endpointBase,
              Referer: refererUrl,
            },
            data: buildFormBody({
              q: text,
            }),
            timeout: 15000,
          });

          const translated = parseGoogleTranslation(response);
          if (!translated) {
            throw new Error(`${label} returned an empty result.`);
          }

          return {
            text: translated,
            detectedSourceLanguage:
              Array.isArray(response) && typeof response[2] === "string"
                ? response[2]
                : sourceLanguage,
          };
        },
      });
    }

    registerGoogleMirrorProvider(
      "google-web",
      "Google Web",
      "https://translate.googleapis.com",
      "https://translate.google.com/"
    );
    registerGoogleMirrorProvider(
      "google-fr-web",
      "Google FR Web",
      "https://translate.google.fr",
      "https://translate.google.fr/"
    );
    registerGoogleMirrorProvider(
      "google-de-web",
      "Google DE Web",
      "https://translate.google.de",
      "https://translate.google.de/"
    );

    const BING_BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
    let bingBootstrap = null;
    let bingBootstrapExpiresAt = 0;

    function parseBingBootstrap(html) {
      const igMatch = html.match(/IG:"([^"]+)"/);
      const abuseMatch = html.match(
        /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",\d+\]/
      );
      const iidMatches = Array.from(
        html.matchAll(/data-iid="(translator\.\d+)"/g),
        (match) => match[1]
      );
      const iid = iidMatches.length ? iidMatches[iidMatches.length - 1] : "";

      if (!igMatch || !abuseMatch || !iid) {
        throw new Error("Failed to initialize Bing translator session.");
      }

      return {
        ig: igMatch[1],
        iid,
        key: abuseMatch[1],
        token: abuseMatch[2],
      };
    }

    async function ensureBingBootstrap(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && bingBootstrap && bingBootstrapExpiresAt > now) {
        return bingBootstrap;
      }

      const response = await request({
        method: "GET",
        url: "https://www.bing.com/translator",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      });

      bingBootstrap = Object.assign(parseBingBootstrap(response.responseText || ""), {
        cookie: parseResponseCookies(response.responseHeaders),
      });
      bingBootstrapExpiresAt = now + BING_BOOTSTRAP_TTL_MS;
      return bingBootstrap;
    }

    async function translateWithBing(text, settings, retried) {
      const bootstrap = await ensureBingBootstrap(retried);
      const targetLanguage = mapLanguageCode(settings.targetLanguage, "bing-web");
      const sourceLanguage =
        settings.sourceLanguage && settings.sourceLanguage !== "auto"
          ? settings.sourceLanguage
          : "auto-detect";

      const response = await requestJson({
        method: "POST",
        url:
          "https://www.bing.com/ttranslatev3" +
          `?isVertical=1&&IG=${encodeURIComponent(bootstrap.ig)}` +
          `&IID=${encodeURIComponent(bootstrap.iid)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.bing.com",
          Referer: "https://www.bing.com/translator",
        },
        cookie: bootstrap.cookie,
        data: buildFormBody({
          fromLang: sourceLanguage,
          text,
          to: targetLanguage,
          tryFetchingGenderDebiasedTranslations: "true",
          token: bootstrap.token,
          key: bootstrap.key,
        }),
        timeout: 15000,
      });

      const firstItem = Array.isArray(response) ? response[0] : null;
      const firstTranslation =
        firstItem && Array.isArray(firstItem.translations) ? firstItem.translations[0] : null;
      const translated = firstTranslation && firstTranslation.text ? firstTranslation.text : "";
      const errorMessage =
        response && typeof response.errorMessage === "string" ? response.errorMessage.trim() : "";

      if (translated) {
        return {
          text: translated,
          detectedSourceLanguage:
            firstItem &&
            firstItem.detectedLanguage &&
            typeof firstItem.detectedLanguage.language === "string"
              ? firstItem.detectedLanguage.language
              : sourceLanguage,
        };
      }

      if (!retried) {
        return translateWithBing(text, settings, true);
      }

      throw new Error(errorMessage || "Bing returned an empty result.");
    }

    builtInProviders.set("bing-web", {
      id: "bing-web",
      label: "Bing Web",
      async translateText(text, settings) {
        return translateWithBing(text, settings, false);
      },
    });

    function buildLaraPayload(text, targetLanguage, sourceLanguage) {
      return JSON.stringify({
        q: text,
        source: sourceLanguage === "auto" ? "" : sourceLanguage,
        target: targetLanguage,
        instructions: [],
        style: "faithful",
        adapt_to: [],
        glossaries: [],
        content_type: "text/plain",
      });
    }

    function parseLaraTranslation(response, fallbackSourceLanguage) {
      const content = response && response.content ? response.content : null;
      const translations = content && Array.isArray(content.translations) ? content.translations : [];
      const translated = translations
        .map((item) => (item && typeof item.translation === "string" ? item.translation : ""))
        .join("")
        .trim();
      const quota = content && content.quota ? content.quota : null;

      if (!translated) {
        if (
          quota &&
          Number.isFinite(Number(quota.current_value)) &&
          Number.isFinite(Number(quota.threshold)) &&
          Number(quota.current_value) >= Number(quota.threshold)
        ) {
          throw new Error("Lara quota exceeded.");
        }

        throw new Error(
          response && typeof response.status !== "undefined"
            ? `Lara error ${response.status}`
            : "Lara returned an empty result."
        );
      }

      return {
        text: translated,
        detectedSourceLanguage:
          content && typeof content.source_language === "string"
            ? content.source_language
            : fallbackSourceLanguage,
      };
    }

    builtInProviders.set("lara-web", {
      id: "lara-web",
      label: "Lara Web",
      async translateText(text, settings) {
        const targetLanguage = mapLanguageCode(settings.targetLanguage, "lara-web");
        const sourceLanguage = settings.sourceLanguage || "auto";

        const response = await requestJson({
          method: "POST",
          url: "https://webapi.laratranslate.com/translate/segmented",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Origin: "https://app.laratranslate.com",
            Referer: "https://app.laratranslate.com/",
            "X-Lara-Client": "Webapp",
          },
          data: buildLaraPayload(text, targetLanguage, sourceLanguage),
          timeout: 15000,
        });

        return parseLaraTranslation(response, sourceLanguage);
      },
    });

    const QQ_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
    let qqBootstrap = null;
    let qqBootstrapExpiresAt = 0;

    async function ensureQqBootstrap(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && qqBootstrap && qqBootstrapExpiresAt > now) {
        return qqBootstrap;
      }

      const pageResponse = await request({
        method: "GET",
        url: "https://fanyi.qq.com/",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const html = pageResponse.responseText || "";
      const reauthMatch = html.match(/reauthuri\s*=\s*["']([^"']+)["']/i);

      if (!reauthMatch) {
        throw new Error("Failed to initialize QQ Fanyi session.");
      }

      const initialCookie = parseResponseCookies(pageResponse.responseHeaders);
      const authResponse = await request({
        method: "POST",
        url: `https://fanyi.qq.com/api/${reauthMatch[1]}`,
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://fanyi.qq.com",
          Referer: "https://fanyi.qq.com/",
        },
        cookie: initialCookie,
        timeout: 15000,
      });
      const authPayload = JSON.parse(authResponse.responseText || "{}");
      const mergedCookie = mergeCookieHeaders(
        initialCookie,
        parseResponseCookies(authResponse.responseHeaders)
      );

      if (!authPayload.qtv || !authPayload.qtk) {
        throw new Error("QQ Fanyi bootstrap did not return qtv/qtk.");
      }

      qqBootstrap = {
        qtv: authPayload.qtv,
        qtk: authPayload.qtk,
        cookie: mergedCookie,
      };
      qqBootstrapExpiresAt = now + QQ_BOOTSTRAP_TTL_MS;
      return qqBootstrap;
    }

    async function translateWithQq(text, settings, retried) {
      const bootstrap = await ensureQqBootstrap(retried);
      const targetLanguage = mapLanguageCode(settings.targetLanguage, "qq-web");
      const sourceLanguage = settings.sourceLanguage || "auto";
      const response = await requestJson({
        method: "POST",
        url: "https://fanyi.qq.com/api/translate",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://fanyi.qq.com",
          Referer: "https://fanyi.qq.com/",
        },
        cookie: bootstrap.cookie,
        data: buildFormBody({
          source: sourceLanguage,
          target: targetLanguage,
          sourceText: text,
          qtv: bootstrap.qtv,
          qtk: bootstrap.qtk,
          sessionUuid: `translate_uuid${Date.now()}`,
        }),
        timeout: 15000,
      });

      const records =
        response && response.translate && Array.isArray(response.translate.records)
          ? response.translate.records
          : [];
      const translated = records
        .map((item) => (item && typeof item.targetText === "string" ? item.targetText : ""))
        .join("")
        .trim();
      const detected =
        response && response.translate && typeof response.translate.source === "string"
          ? response.translate.source
          : sourceLanguage;

      if (translated) {
        return {
          text: translated,
          detectedSourceLanguage: detected,
        };
      }

      if (!retried) {
        return translateWithQq(text, settings, true);
      }

      throw new Error(
        response && response.message
          ? `QQ Fanyi error: ${response.message}`
          : "QQ Fanyi returned an empty result."
      );
    }

    builtInProviders.set("qq-web", {
      id: "qq-web",
      label: "QQ Fanyi",
      async translateText(text, settings) {
        return translateWithQq(text, settings, false);
      },
    });

    function createYandexRequestId() {
      return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}-0-0`;
    }

    builtInProviders.set("yandex-web", {
      id: "yandex-web",
      label: "Yandex Web",
      async translateText(text, settings) {
        const targetLanguage = mapLanguageCode(settings.targetLanguage, "yandex-web");
        const sourceLanguage = settings.sourceLanguage || "auto";
        const lang =
          sourceLanguage === "auto"
            ? targetLanguage
            : `${sourceLanguage}-${targetLanguage}`;

        const response = await requestJson({
          method: "POST",
          url:
            "https://translate.yandex.net/api/v1/tr.json/translate" +
            `?id=${encodeURIComponent(createYandexRequestId())}` +
            "&srv=tr-text&reason=auto&format=text" +
            `&lang=${encodeURIComponent(lang)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json, text/plain, */*",
            Origin: "https://translate.yandex.com",
            Referer: "https://translate.yandex.com/",
          },
          data: buildFormBody({
            text,
          }),
          timeout: 15000,
        });

        const translated = Array.isArray(response.text) ? response.text.join(" ").trim() : "";
        const detected =
          response && typeof response.lang === "string" && response.lang.includes("-")
            ? response.lang.split("-")[0]
            : sourceLanguage;

        if (!translated) {
          throw new Error(
            response && response.message
              ? `Yandex error: ${response.message}`
              : "Yandex returned an empty result."
          );
        }

        return {
          text: translated,
          detectedSourceLanguage: detected,
        };
      },
    });

    const YOUDAO_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
    const YOUDAO_BOOTSTRAP_SIGN_KEY = "EZAmCfVOH2CrBGMtPrtIPUzyv3bheLdk";
    const YOUDAO_BOOTSTRAP_KEY_ID = "ai-translate-llm-pre";
    const YOUDAO_KEY_ID = "ai-translate-llm";
    const YOUDAO_PRODUCT = "webfanyi";
    const YOUDAO_APP_VERSION = "12.0.0";
    const YOUDAO_VENDOR = "web";
    const YOUDAO_KEYFROM = "fanyi.web";
    const YOUDAO_AI_CLIENT = "webaitrans";
    const YOUDAO_AI_KEYFROM = "webfanyi.webaitrans";
    const YOUDAO_FALLBACK_UUID = "abcdefg";
    let youdaoBootstrap = null;
    let youdaoBootstrapExpiresAt = 0;

    function buildYoudaoSignedFields(fields, pointParam, secretKey) {
      const signatureInput = pointParam
        .map((field) => {
          if (field === "key") {
            return `key=${secretKey}`;
          }
          return `${field}=${fields[field] == null ? "" : String(fields[field])}`;
        })
        .join("&");

      return Object.assign({}, fields, {
        sign: md5(signatureInput),
        pointParam: pointParam.join(","),
      });
    }

    function buildMultipartBody(payload) {
      const boundary = `----MWTBoundary${Date.now().toString(16)}${Math.random()
        .toString(16)
        .slice(2)}`;
      const parts = [];

      for (const [key, value] of Object.entries(payload)) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${value == null ? "" : String(value)}\r\n`
        );
      }
      parts.push(`--${boundary}--\r\n`);

      return {
        boundary,
        body: parts.join(""),
      };
    }

    function parseTranslateDirection(payload, fallbackSourceLanguage, fallbackTargetLanguage) {
      const direction =
        payload &&
        payload.data &&
        typeof payload.data.translateDirection === "string" &&
        payload.data.translateDirection.includes("2")
          ? payload.data.translateDirection
          : "";
      const [detectedSourceLanguage, detectedTargetLanguage] = direction
        ? direction.split("2")
        : [fallbackSourceLanguage, fallbackTargetLanguage];

      return {
        sourceLanguage: detectedSourceLanguage || fallbackSourceLanguage,
        targetLanguage: detectedTargetLanguage || fallbackTargetLanguage,
      };
    }

    function parseYoudaoChatStream(responseText, fallbackSourceLanguage) {
      const blocks = String(responseText || "").split(/\r?\n\r?\n+/);
      let translated = "";
      let detectedSourceLanguage = fallbackSourceLanguage;

      for (const block of blocks) {
        const lines = block
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          continue;
        }

        const dataLines = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (dataLines.length === 0) {
          continue;
        }

        let payload = null;
        try {
          payload = JSON.parse(dataLines.join("\n"));
        } catch (error) {
          continue;
        }

        if (
          payload &&
          typeof payload.translateDirection === "string" &&
          payload.translateDirection.includes("2")
        ) {
          detectedSourceLanguage =
            payload.translateDirection.split("2")[0] || detectedSourceLanguage;
        }
        if (payload && typeof payload.content === "string" && payload.content) {
          translated += payload.content;
        }
      }

      if (!translated.trim()) {
        throw new Error("Youdao returned an empty result.");
      }

      return {
        text: translated.trim(),
        detectedSourceLanguage,
      };
    }

    async function fetchYoudaoJson(options) {
      const response = await request(options);
      return {
        response,
        payload: JSON.parse(response.responseText || "{}"),
      };
    }

    async function ensureYoudaoBootstrap(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && youdaoBootstrap && youdaoBootstrapExpiresAt > now) {
        return youdaoBootstrap;
      }

      const pageResponse = await request({
        method: "GET",
        url: "https://fanyi.youdao.com/",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      });

      const initialCookie = parseResponseCookies(pageResponse.responseHeaders);
      const yduuid = md5(`${Date.now()}-${Math.random()}`);
      const secretFields = buildYoudaoSignedFields(
        {
          keyid: YOUDAO_BOOTSTRAP_KEY_ID,
          client: "fanyideskweb",
          product: YOUDAO_PRODUCT,
          appVersion: YOUDAO_APP_VERSION,
          vendor: YOUDAO_VENDOR,
          mysticTime: String(Date.now()),
          keyfrom: YOUDAO_KEYFROM,
          mid: "1",
          screen: "1",
          model: "1",
          network: "wifi",
          abtest: "0",
          yduuid,
        },
        ["client", "mysticTime", "product", "key"],
        YOUDAO_BOOTSTRAP_SIGN_KEY
      );

      const { response, payload } = await fetchYoudaoJson({
        method: "GET",
        url: `https://luna-ai.youdao.com/translate_llm/secret?${buildFormBody(secretFields)}`,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        cookie: initialCookie,
        timeout: 15000,
      });

      const mergedCookie = mergeCookieHeaders(
        initialCookie,
        parseResponseCookies(response.responseHeaders)
      );
      const token =
        payload && payload.data && typeof payload.data.token === "string" ? payload.data.token : "";
      const secretKey =
        payload && payload.data && typeof payload.data.secretKey === "string"
          ? payload.data.secretKey
          : "";

      if (!token || !secretKey) {
        throw new Error("Failed to initialize Youdao session.");
      }

      youdaoBootstrap = {
        cookie: mergedCookie,
        token,
        secretKey,
        yduuid,
      };
      youdaoBootstrapExpiresAt = now + YOUDAO_BOOTSTRAP_TTL_MS;
      return youdaoBootstrap;
    }

    async function warmYoudaoConversation(bootstrap) {
      const signedFields = buildYoudaoSignedFields(
        {
          product: YOUDAO_PRODUCT,
          appVersion: YOUDAO_APP_VERSION,
          client: "web",
          mid: "1",
          vendor: YOUDAO_VENDOR,
          screen: "1",
          model: "1",
          imei: "1",
          network: "wifi",
          keyfrom: YOUDAO_KEYFROM,
          keyid: YOUDAO_KEY_ID,
          mysticTime: String(Date.now()),
          yduuid: bootstrap.yduuid,
          abtest: "0",
          token: bootstrap.token,
        },
        [
          "abtest",
          "appVersion",
          "client",
          "imei",
          "keyfrom",
          "keyid",
          "mid",
          "model",
          "mysticTime",
          "network",
          "product",
          "screen",
          "token",
          "vendor",
          "yduuid",
          "key",
        ],
        bootstrap.secretKey
      );

      await request({
        method: "GET",
        url: `https://luna-ai.youdao.com/translate_llm/v3/uuid/generate?${buildFormBody(
          signedFields
        )}`,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        cookie: bootstrap.cookie,
        timeout: 15000,
      });
    }

    async function translateWithYoudao(text, settings, retried) {
      try {
        const bootstrap = await ensureYoudaoBootstrap(retried);
        const requestedTargetLanguage = mapLanguageCode(settings.targetLanguage, "youdao-web");
        const requestedSourceLanguage =
          settings.sourceLanguage && settings.sourceLanguage !== "auto"
            ? settings.sourceLanguage
            : "auto";
        const encodedInput = encodeURIComponent(text);
        const directionFields = buildYoudaoSignedFields(
          {
            product: YOUDAO_PRODUCT,
            appVersion: YOUDAO_APP_VERSION,
            client: "web",
            mid: "1",
            vendor: YOUDAO_VENDOR,
            screen: "1",
            model: "1",
            imei: "1",
            network: "wifi",
            keyfrom: YOUDAO_KEYFROM,
            keyid: YOUDAO_KEY_ID,
            mysticTime: String(Date.now()),
            yduuid: YOUDAO_FALLBACK_UUID,
            abtest: "0",
            token: bootstrap.token,
            input: encodedInput,
          },
          [
            "abtest",
            "appVersion",
            "client",
            "imei",
            "input",
            "keyfrom",
            "keyid",
            "mid",
            "model",
            "mysticTime",
            "network",
            "product",
            "screen",
            "token",
            "vendor",
            "yduuid",
            "key",
          ],
          bootstrap.secretKey
        );
        const directionMultipart = buildMultipartBody(directionFields);
        const directionPayload = await requestJson({
          method: "POST",
          url: "https://luna-ai.youdao.com/translate_llm/v3/translateDirection",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${directionMultipart.boundary}`,
            Accept: "application/json, text/plain, */*",
            Origin: "https://fanyi.youdao.com",
            Referer: "https://fanyi.youdao.com/",
          },
          cookie: bootstrap.cookie,
          data: directionMultipart.body,
          timeout: 15000,
        });

        const direction = parseTranslateDirection(
          directionPayload,
          requestedSourceLanguage,
          requestedTargetLanguage
        );

        try {
          await warmYoudaoConversation(bootstrap);
        } catch (error) {
          // The chat request does not consume the generated id directly.
        }

        const chatFields = buildYoudaoSignedFields(
          {
            product: YOUDAO_PRODUCT,
            appVersion: YOUDAO_APP_VERSION,
            client: YOUDAO_AI_CLIENT,
            mid: "1",
            vendor: YOUDAO_VENDOR,
            screen: "1",
            model: "1",
            imei: "1",
            network: "wifi",
            keyfrom: YOUDAO_AI_KEYFROM,
            keyid: YOUDAO_KEY_ID,
            mysticTime: String(Date.now()),
            yduuid: bootstrap.yduuid,
            functionEnglishName: "LLM_translate",
            input: encodedInput,
            useTerm: "0",
            free: "false",
            singleBox: "false",
            fromLang: direction.sourceLanguage,
            toLang: direction.targetLanguage,
            roundNo: "1",
            showSuggest: "0",
            token: bootstrap.token,
            source: YOUDAO_AI_CLIENT,
          },
          [
            "appVersion",
            "client",
            "free",
            "fromLang",
            "functionEnglishName",
            "imei",
            "input",
            "keyfrom",
            "keyid",
            "mid",
            "model",
            "mysticTime",
            "network",
            "product",
            "roundNo",
            "screen",
            "showSuggest",
            "singleBox",
            "source",
            "toLang",
            "token",
            "useTerm",
            "vendor",
            "yduuid",
            "key",
          ],
          bootstrap.secretKey
        );
        const chatMultipart = buildMultipartBody(chatFields);
        const chatResponse = await request({
          method: "POST",
          url: "https://luna-ai.youdao.com/translate_llm/v3/chat",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${chatMultipart.boundary}`,
            Accept: "text/event-stream, text/plain, */*",
            Origin: "https://fanyi.youdao.com",
            Referer: "https://fanyi.youdao.com/",
          },
          cookie: bootstrap.cookie,
          data: chatMultipart.body,
          timeout: 30000,
        });

        return parseYoudaoChatStream(chatResponse.responseText || "", direction.sourceLanguage);
      } catch (error) {
        if (!retried) {
          return translateWithYoudao(text, settings, true);
        }
        throw error;
      }
    }

    builtInProviders.set("youdao-web", {
      id: "youdao-web",
      label: "Youdao Web",
      async translateText(text, settings) {
        return translateWithYoudao(text, settings, false);
      },
    });

    function buildDeepLTimestamp(text) {
      const letterCount = (String(text).match(/i/g) || []).length + 1;
      const now = Date.now();
      return now - (now % letterCount) + letterCount;
    }

    builtInProviders.set("deepl-web", {
      id: "deepl-web",
      label: "DeepL Web",
      async translateText(text, settings) {
        const targetLanguage = mapLanguageCode(settings.targetLanguage, "deepl-web");
        const sourceLanguage =
          settings.sourceLanguage && settings.sourceLanguage !== "auto"
            ? settings.sourceLanguage.toUpperCase()
            : "AUTO";

        const response = await requestJson({
          method: "POST",
          url: "https://www2.deepl.com/jsonrpc?method=LMT_handle_texts",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.deepl.com",
            Referer: "https://www.deepl.com/en/translator",
          },
          data: JSON.stringify({
            jsonrpc: "2.0",
            method: "LMT_handle_texts",
            id: Date.now(),
            params: {
              texts: [
                {
                  text,
                  requestAlternatives: 0,
                },
              ],
              splitting: "newlines",
              lang: {
                source_lang_user_selected: sourceLanguage,
                target_lang: targetLanguage,
              },
              commonJobParams: {
                mode: "translate",
              },
              timestamp: buildDeepLTimestamp(text),
            },
          }),
          timeout: 15000,
        });

        const translated =
          response &&
          response.result &&
          Array.isArray(response.result.texts) &&
          response.result.texts[0] &&
          typeof response.result.texts[0].text === "string"
            ? response.result.texts[0].text.trim()
            : "";

        if (!translated) {
          throw new Error(
            response && response.error && response.error.message
              ? `DeepL error: ${response.error.message}`
              : "DeepL returned an empty result."
          );
        }

        return {
          text: translated,
          detectedSourceLanguage:
            response &&
            response.result &&
            response.result.lang &&
            typeof response.result.lang.detected === "string"
              ? response.result.lang.detected
              : sourceLanguage,
        };
      },
    });

    builtInProviders.set("baidu-web", {
      id: "baidu-web",
      label: "Baidu Fanyi",
      async translateText(text, settings) {
        const targetLanguage = mapLanguageCode(settings.targetLanguage, "baidu-web");
        const sourceLanguage = settings.sourceLanguage || "auto";
        const response = await requestJson({
          method: "POST",
          url: "https://fanyi.baidu.com/transapi",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json, text/plain, */*",
            Origin: "https://fanyi.baidu.com",
            Referer: "https://fanyi.baidu.com/",
          },
          data: buildFormBody({
            from: sourceLanguage,
            to: targetLanguage,
            query: text,
            source: "txt",
          }),
          timeout: 15000,
        });

        const translated = Array.isArray(response.data)
          ? response.data
              .map((item) => (item && typeof item.dst === "string" ? item.dst : ""))
              .join("")
              .trim()
          : "";

        if (!translated) {
          throw new Error(
            response && response.errmsg
              ? `Baidu error: ${response.errmsg}`
              : "Baidu returned an empty result."
          );
        }

        return {
          text: translated,
          detectedSourceLanguage:
            response && typeof response.from === "string" ? response.from : sourceLanguage,
        };
      },
    });

    const SOGOU_BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
    let sogouBootstrap = null;
    let sogouBootstrapExpiresAt = 0;

    async function ensureSogouBootstrap(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && sogouBootstrap && sogouBootstrapExpiresAt > now) {
        return sogouBootstrap;
      }

      const response = await request({
        method: "GET",
        url: "https://fanyi.sogou.com/text",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const html = response.responseText || "";

      const uuidMatch = html.match(/"uuid":"([^"]+)"/);
      const secretCodeMatch = html.match(/"secretCode":(\d+)/);

      if (!uuidMatch || !secretCodeMatch) {
        throw new Error("Failed to initialize a Sogou session.");
      }

      sogouBootstrap = {
        uuid: uuidMatch[1],
        secretCode: secretCodeMatch[1],
        cookie: parseResponseCookies(response.responseHeaders),
      };
      sogouBootstrapExpiresAt = now + SOGOU_BOOTSTRAP_TTL_MS;
      return sogouBootstrap;
    }

    async function translateWithSogou(text, settings, retried) {
      const bootstrap = await ensureSogouBootstrap(retried);
      const to = mapLanguageCode(settings.targetLanguage, "sogou-web");
      const from = settings.sourceLanguage || "auto";
      const signature = md5(`${from}${to}${text}${bootstrap.secretCode}`);

      const response = await requestJson({
        method: "POST",
        url: "https://fanyi.sogou.com/api/transpc/text/result",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://fanyi.sogou.com",
          Referer: "https://fanyi.sogou.com/text",
          "X-Requested-With": "XMLHttpRequest",
        },
        data: buildFormBody({
          from,
          to,
          text,
          client: "pc",
          fr: "browser_pc",
          needQc: 1,
          s: signature,
          uuid: bootstrap.uuid,
        }),
        cookie: bootstrap.cookie,
        timeout: 15000,
      });

      const translation = response && response.data ? response.data.translate : null;
      const detected =
        response && response.data && response.data.detect
          ? response.data.detect.detect
          : from;
      const errorCode = translation && translation.errorCode != null ? String(translation.errorCode) : "";

      if (translation && translation.errorCode === "0" && translation.dit) {
        return {
          text: translation.dit,
          detectedSourceLanguage: detected,
        };
      }

      if (!retried && (errorCode === "s10" || errorCode === "10")) {
        return translateWithSogou(text, settings, true);
      }

      throw new Error(
        errorCode
          ? `Sogou error ${errorCode}`
          : "Sogou returned an empty result."
      );
    }

    builtInProviders.set("sogou-web", {
      id: "sogou-web",
      label: "Sogou Web",
      async translateText(text, settings) {
        return translateWithSogou(text, settings, false);
      },
    });
  }

  function registerBuiltInSiteModuleFallbacks() {
    const POST_SELECTORS = [
      "shreddit-post",
      "article[data-testid='post-container']",
      "[data-testid='post-container']",
    ];

    const TITLE_SELECTORS = [
      "a[id^='post-title-']",
      "[slot='title']",
      "a[data-testid='post-title']",
      "h3",
      "faceplate-screen-reader-content",
    ];

    const BODY_SELECTORS = [
      "shreddit-post-text-body",
      "[slot='text-body']",
      "[data-post-click-location='text-body']",
      "div[data-click-id='text']",
      "div.md",
      "[data-testid='post-content']",
    ];

    function isRedditNewPage(url) {
      return (
        url.hostname === "www.reddit.com" &&
        (url.pathname === "/new" ||
          url.pathname === "/new/" ||
          url.pathname.startsWith("/new/"))
      );
    }

    function getPostNodes(root) {
      const nodes = [];
      for (const selector of POST_SELECTORS) {
        nodes.push(...root.querySelectorAll(selector));
      }
      return uniqueNodes(nodes);
    }

    function getPostId(postNode) {
      return (
        postNode.getAttribute("id") ||
        postNode.getAttribute("post-id") ||
        postNode.dataset.postId ||
        ""
      );
    }

    function getPostUrl(postNode) {
      const permalink = postNode.getAttribute("permalink");
      if (permalink) {
        try {
          return new URL(permalink, location.origin).toString();
        } catch (error) {
          return permalink;
        }
      }

      const link =
        postNode.querySelector("a[href*='/comments/']") ||
        postNode.querySelector("a[id^='post-title-']") ||
        postNode.querySelector("a[data-testid='post-title']") ||
        postNode.querySelector("a[href]");

      if (!link) {
        return "";
      }

      try {
        return new URL(link.getAttribute("href"), location.origin).toString();
      } catch (error) {
        return link.getAttribute("href") || "";
      }
    }

    function extractRedditPost(postNode) {
      const titleFromAttribute = normalizeInlineText(postNode.getAttribute("post-title"));
      const titleNode =
        titleFromAttribute
          ? {
              text: titleFromAttribute,
              element:
                postNode.querySelector("a[id^='post-title-']") ||
                postNode.querySelector("[slot='title']") ||
                postNode.querySelector("a[data-testid='post-title']") ||
                postNode,
            }
          : getFirstText(postNode, TITLE_SELECTORS, normalizeInlineText);

      const bodyNode = getFirstText(postNode, BODY_SELECTORS, normalizeMultilineText);

      if (!titleNode && !bodyNode) {
        return null;
      }

      return {
        id: getPostId(postNode),
        url: getPostUrl(postNode),
        title: titleNode ? titleNode.text : "",
        body: bodyNode ? bodyNode.text : "",
        titleElement: titleNode ? titleNode.element : null,
        bodyElement: bodyNode ? bodyNode.element : null,
      };
    }

    function getInsertAnchor(slot, sourceElement) {
      if (!sourceElement) {
        return null;
      }

      if (slot === "title") {
        return (
          sourceElement.closest("a[id^='post-title-']") ||
          sourceElement.closest("a[data-testid='post-title']") ||
          sourceElement.closest("a[href*='/comments/']") ||
          sourceElement
        );
      }

      return sourceElement;
    }

    function getMetaText(slotLabel, runtime, providerId) {
      const providerLabel = providerId
        ? runtime.getProviderLabel(providerId)
        : runtime.getCurrentProviderLabel();
      return `${slotLabel} | ${providerLabel} | ${runtime.getCurrentLanguageLabel()}`;
    }

    function createContext(postNode, extracted) {
      return {
        postNode,
        extracted,
        sections: {
          title: null,
          body: null,
        },
        runId: 0,
        pendingSignature: "",
        renderSignature: "",
      };
    }

    builtInSiteModules.set("reddit-new", {
      id: "reddit-new",
      name: "Reddit /new",
      mount(runtime) {
        if (!document.body || !isRedditNewPage(window.location)) {
          return;
        }

        const contexts = new Set();
        const contextByNode = new WeakMap();
        let scanTimer = null;
        let observer = null;
        let unsubscribe = null;
        let lastSettings = runtime.getSettings();

        function cleanupDetachedContexts() {
          for (const context of Array.from(contexts)) {
            if (!context.postNode.isConnected) {
              if (context.sections.title) {
                runtime.ui.removeSection(context.sections.title);
              }
              if (context.sections.body) {
                runtime.ui.removeSection(context.sections.body);
              }
              contexts.delete(context);
            }
          }
        }

        function ensureSection(context, slot, sourceElement) {
          if (!sourceElement) {
            if (context.sections[slot]) {
              runtime.ui.removeSection(context.sections[slot]);
            }
            context.sections[slot] = null;
            return null;
          }

          const anchor = getInsertAnchor(slot, sourceElement);
          if (!anchor || !anchor.parentElement) {
            return null;
          }

          const slotLabel = slot === "title" ? "Title" : "Body";
          let section = context.sections[slot];
          if (!section) {
            section = runtime.ui.createSection(slotLabel);
            context.sections[slot] = section;
          }

          runtime.ui.attachSectionAfter(section, anchor);
          runtime.ui.setSectionMeta(section, getMetaText(slotLabel, runtime));
          return section;
        }

        function getContextTranslationSignature(context) {
          const settings = runtime.getSettings();
          return JSON.stringify({
            targetLanguage: settings.targetLanguage,
            title: context.extracted.title,
            body: context.extracted.body,
          });
        }

        function translateContext(context) {
          if (!context.postNode.isConnected) {
            return;
          }

          const extracted = extractRedditPost(context.postNode);
          if (!extracted) {
            return;
          }

          context.extracted = extracted;

          const titleSection = ensureSection(context, "title", extracted.titleElement);
          const bodySection = ensureSection(context, "body", extracted.bodyElement);
          const signature = getContextTranslationSignature(context);

          if (signature === context.renderSignature || signature === context.pendingSignature) {
            return;
          }

          const runId = context.runId + 1;
          context.runId = runId;
          context.pendingSignature = signature;

          if (extracted.title && titleSection) {
            runtime.ui.setSectionLoading(titleSection, getMetaText("Title", runtime));
          }
          if (extracted.body && bodySection) {
            runtime.ui.setSectionLoading(bodySection, getMetaText("Body", runtime));
          }

          const jobs = [];

          if (extracted.title && titleSection) {
            jobs.push(
              runtime.translateText(extracted.title).then((result) => {
                if (context.runId !== runId) {
                  return;
                }
                runtime.ui.setSectionSuccess(
                  titleSection,
                  getMetaText("Title", runtime, result.providerId),
                  result.text
                );
              })
            );
          }

          if (extracted.body && bodySection) {
            jobs.push(
              runtime.translateText(extracted.body).then((result) => {
                if (context.runId !== runId) {
                  return;
                }
                runtime.ui.setSectionSuccess(
                  bodySection,
                  getMetaText("Body", runtime, result.providerId),
                  result.text
                );
              })
            );
          }

          Promise.all(jobs)
            .then(() => {
              if (context.runId !== runId) {
                return;
              }
              context.pendingSignature = "";
              context.renderSignature = signature;
            })
            .catch((error) => {
              if (context.runId !== runId) {
                return;
              }
              context.pendingSignature = "";
              if (extracted.title && titleSection) {
                runtime.ui.setSectionError(
                  titleSection,
                  getMetaText("Title", runtime),
                  error
                );
              }
              if (extracted.body && bodySection) {
                runtime.ui.setSectionError(bodySection, getMetaText("Body", runtime), error);
              }
            });
        }

        function refreshAllContexts(reason) {
          cleanupDetachedContexts();
          for (const context of contexts) {
            if (reason === "provider") {
              if (!context.renderSignature) {
                context.pendingSignature = "";
                translateContext(context);
              }
              continue;
            }

            context.renderSignature = "";
            context.pendingSignature = "";
            translateContext(context);
          }
        }

        function scanPosts() {
          cleanupDetachedContexts();
          const posts = getPostNodes(document);
          for (const postNode of posts) {
            const extracted = extractRedditPost(postNode);
            if (!extracted || (!extracted.title && !extracted.body)) {
              continue;
            }

            let context = contextByNode.get(postNode);
            if (!context) {
              context = createContext(postNode, extracted);
              contextByNode.set(postNode, context);
              contexts.add(context);
            }

            context.extracted = extracted;
            translateContext(context);
          }
        }

        function scheduleScan() {
          if (scanTimer) {
            clearTimeout(scanTimer);
          }
          scanTimer = setTimeout(scanPosts, 120);
        }

        runtime.ui.ensureSettingsUi({
          title: "Modular Web Translator",
          moduleName: "Reddit /new",
          description:
            "Remote module loading is blocked by the current page CSP, so the built-in fallback module is active.",
        });

        scanPosts();
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        unsubscribe = runtime.onSettingsChanged((nextSettings) => {
          const reason =
            nextSettings.targetLanguage !== lastSettings.targetLanguage ? "language" : "provider";
          lastSettings = nextSettings;
          refreshAllContexts(reason);
        });

        return () => {
          if (scanTimer) {
            clearTimeout(scanTimer);
          }
          if (observer) {
            observer.disconnect();
          }
          if (unsubscribe) {
            unsubscribe();
          }
        };
      },
    });
  }

  function registerExpandedBuiltInSiteModuleFallbacks() {
    const FEED_POST_SELECTORS = [
      "shreddit-post",
      "article[data-testid='post-container']",
      "[data-testid='post-container']",
    ];
    const FEED_TITLE_SELECTORS = [
      "a[id^='post-title-']",
      "[slot='title']",
      "a[data-testid='post-title']",
      "h3",
      "faceplate-screen-reader-content",
    ];
    const FEED_BODY_SELECTORS = [
      "shreddit-post-text-body",
      "[slot='text-body']",
      "[data-post-click-location='text-body']",
      "div[data-click-id='text']",
      "div.md",
      "[data-testid='post-content']",
    ];
    const EXCLUDED_FEED_PREFIXES = [
      "/explore",
      "/settings",
      "/message",
      "/topics",
      "/media",
      "/notifications",
      "/login",
      "/register",
      "/premium",
      "/submit",
      "/chat",
    ];
    const EXPLORE_CONTAINER_SELECTOR = [
      "[data-testid='community-card']",
      "faceplate-card",
      "article",
      "section",
      "li",
      "div[data-testid]",
      "div[class*='card']",
      "div[class*='Card']",
    ].join(", ");
    const EXPLORE_TITLE_SELECTORS = [
      "a[href^='/r/']",
      "h2",
      "h3",
      "[data-testid='card-title']",
    ];
    const EXPLORE_BODY_SELECTORS = [
      "p",
      "[data-testid='description']",
      "[slot='description']",
      "span",
    ];

    function getMetaText(slotLabel, runtime, providerId) {
      const providerLabel = providerId
        ? runtime.getProviderLabel(providerId)
        : runtime.getCurrentProviderLabel();
      return `${slotLabel} | ${providerLabel} | ${runtime.getCurrentLanguageLabel()}`;
    }

    function createContext(node, extracted) {
      return {
        node,
        extracted,
        sections: {
          title: null,
          body: null,
        },
        runId: 0,
        pendingSignature: "",
        renderSignature: "",
        failedSignature: "",
        retryNotBefore: 0,
      };
    }

    function createCollectionController(runtime, options) {
      const contexts = new Set();
      const contextByNode = new WeakMap();
      let scanTimer = null;
      let observer = null;
      let unsubscribe = null;
      let lastSettings = runtime.getSettings();

      function cleanupDetachedContexts() {
        for (const context of Array.from(contexts)) {
          if (!context.node.isConnected) {
            if (context.sections.title) {
              runtime.ui.removeSection(context.sections.title);
            }
            if (context.sections.body) {
              runtime.ui.removeSection(context.sections.body);
            }
            contexts.delete(context);
          }
        }
      }

      function ensureSection(context, slot, sourceElement) {
        const anchor = options.getAnchor(slot, sourceElement);
        if (!anchor || !anchor.parentElement) {
          if (context.sections[slot]) {
            runtime.ui.removeSection(context.sections[slot]);
          }
          context.sections[slot] = null;
          return null;
        }

        const slotLabel = slot === "title" ? "Title" : "Body";
        let section = context.sections[slot];
        if (!section) {
          section = runtime.ui.createSection(slotLabel);
          context.sections[slot] = section;
        }

        runtime.ui.attachSectionAfter(section, anchor);
        runtime.ui.setSectionMeta(section, getMetaText(slotLabel, runtime));
        return section;
      }

      function getSignature(context) {
        const settings = runtime.getSettings();
        return JSON.stringify({
          targetLanguage: settings.targetLanguage,
          title: context.extracted.title,
          body: context.extracted.body,
        });
      }

      function translateContext(context) {
        if (!context.node.isConnected) {
          return;
        }

        const extracted = options.extract(context.node);
        if (!extracted) {
          return;
        }

        context.extracted = extracted;
        const titleSection = ensureSection(context, "title", extracted.titleElement);
        const bodySection = ensureSection(context, "body", extracted.bodyElement);
        const signature = getSignature(context);
        if (signature === context.renderSignature || signature === context.pendingSignature) {
          return;
        }
        if (signature === context.failedSignature && Date.now() < context.retryNotBefore) {
          return;
        }

        const runId = context.runId + 1;
        context.runId = runId;
        context.pendingSignature = signature;
        const jobs = [];

        if (extracted.title && titleSection) {
          runtime.ui.setSectionLoading(titleSection, getMetaText("Title", runtime));
          jobs.push(
            runtime.translateText(extracted.title).then((result) => {
              if (context.runId !== runId) {
                return;
              }
              runtime.ui.setSectionSuccess(
                titleSection,
                getMetaText("Title", runtime, result.providerId),
                result.text
              );
            })
          );
        }

        if (extracted.body && bodySection) {
          runtime.ui.setSectionLoading(bodySection, getMetaText("Body", runtime));
          jobs.push(
            runtime.translateText(extracted.body).then((result) => {
              if (context.runId !== runId) {
                return;
              }
              runtime.ui.setSectionSuccess(
                bodySection,
                getMetaText("Body", runtime, result.providerId),
                result.text
              );
            })
          );
        }

        Promise.all(jobs)
          .then(() => {
            if (context.runId !== runId) {
              return;
            }
            context.pendingSignature = "";
            context.renderSignature = signature;
            context.failedSignature = "";
            context.retryNotBefore = 0;
          })
          .catch((error) => {
            if (context.runId !== runId) {
              return;
            }
            context.pendingSignature = "";
            context.failedSignature = signature;
            context.retryNotBefore = Date.now() + TRANSLATION_RETRY_COOLDOWN_MS;
            if (titleSection) {
              runtime.ui.setSectionError(titleSection, getMetaText("Title", runtime), error);
            }
            if (bodySection) {
              runtime.ui.setSectionError(bodySection, getMetaText("Body", runtime), error);
            }
          });
      }

      function refreshAllContexts(reason) {
        cleanupDetachedContexts();
        for (const context of contexts) {
          if (reason === "provider") {
            if (!context.renderSignature || context.failedSignature) {
              context.pendingSignature = "";
              context.failedSignature = "";
              context.retryNotBefore = 0;
              translateContext(context);
            }
            continue;
          }

          context.renderSignature = "";
          context.pendingSignature = "";
          context.failedSignature = "";
          context.retryNotBefore = 0;
          translateContext(context);
        }
      }

      function scanNodes() {
        cleanupDetachedContexts();
        const nodes = options.getNodes(document);
        for (const node of nodes) {
          const extracted = options.extract(node);
          if (!extracted || (!extracted.title && !extracted.body)) {
            continue;
          }

          let context = contextByNode.get(node);
          if (!context) {
            context = createContext(node, extracted);
            contextByNode.set(node, context);
            contexts.add(context);
          }

          context.extracted = extracted;
          translateContext(context);
        }
      }

      function scheduleScan() {
        if (scanTimer) {
          clearTimeout(scanTimer);
        }
        scanTimer = setTimeout(scanNodes, options.scanDelay);
      }

      runtime.ui.ensureSettingsUi(options.uiDetails);
      scanNodes();

      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      unsubscribe = runtime.onSettingsChanged((nextSettings) => {
        const reason =
          nextSettings.targetLanguage !== lastSettings.targetLanguage ? "language" : "provider";
        lastSettings = nextSettings;
        refreshAllContexts(reason);
      });

      return () => {
        if (scanTimer) {
          clearTimeout(scanTimer);
        }
        if (observer) {
          observer.disconnect();
        }
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }

    function isRedditFeedPage(url) {
      if (url.hostname !== "www.reddit.com") {
        return false;
      }
      const pathname = url.pathname || "/";
      if (
        EXCLUDED_FEED_PREFIXES.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
        )
      ) {
        return false;
      }
      return (
        pathname === "/" ||
        pathname === "/new" ||
        pathname === "/new/" ||
        pathname.startsWith("/new/") ||
        pathname === "/r/popular" ||
        pathname === "/r/popular/" ||
        /^\/r\/[^/]+\/?$/.test(pathname) ||
        /^\/r\/[^/]+\/(hot|new|top|rising|controversial)\/?$/.test(pathname)
      );
    }

    function getFeedPostNodes(root) {
      const nodes = [];
      for (const selector of FEED_POST_SELECTORS) {
        nodes.push(...root.querySelectorAll(selector));
      }
      return uniqueNodes(nodes);
    }

    function extractFeedPost(postNode) {
      const titleFromAttribute = normalizeInlineText(postNode.getAttribute("post-title"));
      const titleNode =
        titleFromAttribute
          ? {
              text: titleFromAttribute,
              element:
                postNode.querySelector("a[id^='post-title-']") ||
                postNode.querySelector("[slot='title']") ||
                postNode.querySelector("a[data-testid='post-title']") ||
                postNode,
            }
          : getFirstText(postNode, FEED_TITLE_SELECTORS, normalizeInlineText);
      const bodyNode = getFirstText(postNode, FEED_BODY_SELECTORS, normalizeMultilineText);
      if (!titleNode && !bodyNode) {
        return null;
      }
      return {
        title: titleNode ? titleNode.text : "",
        body: bodyNode ? bodyNode.text : "",
        titleElement: titleNode ? titleNode.element : null,
        bodyElement: bodyNode ? bodyNode.element : null,
      };
    }

    function getFeedAnchor(slot, sourceElement) {
      if (!sourceElement) {
        return null;
      }
      if (slot === "title") {
        return (
          sourceElement.closest("a[id^='post-title-']") ||
          sourceElement.closest("a[data-testid='post-title']") ||
          sourceElement.closest("a[href*='/comments/']") ||
          sourceElement
        );
      }
      return sourceElement;
    }

    const redditFeedFallback = {
      id: "reddit-feed",
      name: "Reddit Feed",
      mount(runtime) {
        if (!document.body || !isRedditFeedPage(window.location)) {
          return;
        }
        return createCollectionController(runtime, {
          scanDelay: 120,
          getNodes: getFeedPostNodes,
          extract: extractFeedPost,
          getAnchor: getFeedAnchor,
          uiDetails: {
            title: "Modular Web Translator",
            moduleName: "Reddit Feed",
            description:
              "Built-in Reddit feed fallback is active because remote module execution was blocked by the current page CSP.",
          },
        });
      },
    };

    function isRedditExplorePage(url) {
      return url.hostname === "www.reddit.com" && url.pathname.startsWith("/explore");
    }

    function getExploreCardNodes(root) {
      const links = Array.from(root.querySelectorAll("a[href^='/r/']"));
      const cards = links
        .map(
          (link) =>
            link.closest(EXPLORE_CONTAINER_SELECTOR) ||
            link.closest("article, section, li") ||
            link.parentElement
        )
        .filter(Boolean);
      return uniqueNodes(cards).filter((node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        if (node.closest("header, nav")) {
          return false;
        }
        if (node.querySelector("shreddit-post, [data-testid='post-container']")) {
          return false;
        }
        return Boolean(node.querySelector("a[href^='/r/']"));
      });
    }

    function pickFirstMeaningful(root, selectors, normalizer, minLength) {
      for (const selector of selectors) {
        const candidates = root.querySelectorAll(selector);
        for (const element of candidates) {
          const text = normalizer(element.textContent);
          if (text && text.length >= minLength) {
            return {
              text,
              element,
            };
          }
        }
      }
      return null;
    }

    function extractExploreCard(cardNode) {
      const titleNode = pickFirstMeaningful(
        cardNode,
        EXPLORE_TITLE_SELECTORS,
        normalizeInlineText,
        2
      );
      const bodyNode = pickFirstMeaningful(
        cardNode,
        EXPLORE_BODY_SELECTORS,
        normalizeInlineText,
        20
      );
      if (!titleNode && !bodyNode) {
        return null;
      }
      return {
        title: titleNode ? titleNode.text : "",
        body: bodyNode ? bodyNode.text : "",
        titleElement: titleNode ? titleNode.element : null,
        bodyElement: bodyNode ? bodyNode.element : null,
      };
    }

    const redditExploreFallback = {
      id: "reddit-explore",
      name: "Reddit Explore",
      mount(runtime) {
        if (!document.body || !isRedditExplorePage(window.location)) {
          return;
        }
        return createCollectionController(runtime, {
          scanDelay: 160,
          getNodes: getExploreCardNodes,
          extract: extractExploreCard,
          getAnchor(slot, sourceElement) {
            return sourceElement && sourceElement.parentElement ? sourceElement : null;
          },
          uiDetails: {
            title: "Modular Web Translator",
            moduleName: "Reddit Explore",
            description:
              "Built-in Reddit Explore fallback is active because remote module execution was blocked by the current page CSP.",
          },
        });
      },
    };

    builtInSiteModules.set("reddit-feed", redditFeedFallback);
    builtInSiteModules.set("reddit-new", redditFeedFallback);
    builtInSiteModules.set("reddit-explore", redditExploreFallback);
  }

  async function ensureProviderCatalogLoaded() {
    const cached = storageGet(PROVIDER_MANIFEST_CACHE_KEY, null);
    const now = Date.now();

    if (cached && cached.expiresAt > now && cached.data) {
      const manifest = normalizeProviderManifest(cached.data);
      if (manifest.providers.length === 0) {
        const fallbackManifest = getDefaultProviderManifest();
        setProviderManifest(fallbackManifest);
        return fallbackManifest;
      }
      setProviderManifest(manifest);
      return manifest;
    }

    try {
      const manifest = normalizeProviderManifest(
        await requestJson({
          method: "GET",
          url: REMOTE_PROVIDER_MANIFEST_URL,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Cache-Control": "no-cache",
          },
        })
      );
      if (manifest.providers.length === 0) {
        const fallbackManifest = getDefaultProviderManifest();
        setProviderManifest(fallbackManifest);
        return fallbackManifest;
      }
      const ttlMs = Math.max(1, manifest.cacheTtlMinutes) * 60 * 1000;
      storageSet(PROVIDER_MANIFEST_CACHE_KEY, {
        fetchedAt: now,
        expiresAt: now + ttlMs,
        data: manifest,
      });
      setProviderManifest(manifest);
      return manifest;
    } catch (error) {
      if (cached && cached.data) {
        console.warn(
          "[modular-web-translator] provider manifest fetch failed, using cached manifest",
          error
        );
        const manifest = normalizeProviderManifest(cached.data);
        if (manifest.providers.length === 0) {
          const fallbackManifest = getDefaultProviderManifest();
          setProviderManifest(fallbackManifest);
          return fallbackManifest;
        }
        setProviderManifest(manifest);
        return manifest;
      }

      const fallbackManifest = getDefaultProviderManifest();
      setProviderManifest(fallbackManifest);
      console.warn(
        "[modular-web-translator] provider manifest fetch failed, using fallback manifest",
        error
      );
      return fallbackManifest;
    }
  }

  function getProviderCacheKey(providerId) {
    return `${PROVIDER_CACHE_KEY_PREFIX}${providerId}`;
  }

  async function loadProviderSource(entry, manifest) {
    const cacheKey = getProviderCacheKey(entry.id);
    const cached = storageGet(cacheKey, null);
    const now = Date.now();
    const ttlMs = Math.max(1, manifest.moduleCacheTtlMinutes || 30) * 60 * 1000;

    if (
      cached &&
      cached.version === entry.version &&
      cached.scriptUrl === entry.scriptUrl &&
      cached.expiresAt > now &&
      cached.code
    ) {
      return cached.code;
    }

    try {
      const code = await requestText({
        method: "GET",
        url: entry.scriptUrl,
        headers: {
          Accept: "text/plain, application/javascript, */*",
          "Cache-Control": "no-cache",
        },
      });
      storageSet(cacheKey, {
        version: entry.version,
        scriptUrl: entry.scriptUrl,
        code,
        fetchedAt: now,
        expiresAt: now + ttlMs,
      });
      return code;
    } catch (error) {
      if (cached && cached.code) {
        console.warn(
          `[modular-web-translator] provider fetch failed for ${entry.id}, using cached provider`,
          error
        );
        return cached.code;
      }

      throw error;
    }
  }

  function registerTranslationProvider(providerDefinition) {
    if (!providerDefinition || typeof providerDefinition !== "object") {
      throw new Error("Provider definition must be an object.");
    }
    if (!providerDefinition.id || typeof providerDefinition.translateText !== "function") {
      throw new Error("Provider definition must include id and translateText(text, settings, runtime).");
    }

    const catalogEntry = getProviderCatalogEntry(providerDefinition.id);
    state.providerRegistry.set(
      providerDefinition.id,
      Object.assign({}, catalogEntry || {}, providerDefinition)
    );
  }

  let remoteCodeExecutionCheck = null;

  function getRemoteCodeExecutionCheck() {
    if (remoteCodeExecutionCheck) {
      return remoteCodeExecutionCheck;
    }

    try {
      const evaluator = new Function("return true;");
      remoteCodeExecutionCheck = {
        supported: Boolean(evaluator()),
        error: null,
      };
    } catch (error) {
      remoteCodeExecutionCheck = {
        supported: false,
        error,
      };
    }

    return remoteCodeExecutionCheck;
  }

  async function loadRemoteProvider(entry, manifest) {
    const code = await loadProviderSource(entry, manifest);
    const executor = new Function(
      `${code}\n//# sourceURL=${entry.scriptUrl.replace(/[\r\n]/g, "")}`
    );
    executor.call(globalThis);

    const registered = state.providerRegistry.get(entry.id);
    if (!registered) {
      throw new Error(`Remote provider ${entry.id} did not register itself.`);
    }

    return registered;
  }

  async function ensureProviderLoaded(providerId) {
    if (state.providerRegistry.has(providerId)) {
      return state.providerRegistry.get(providerId);
    }

    if (state.providerLoadTasks.has(providerId)) {
      return state.providerLoadTasks.get(providerId);
    }

    const entry = getProviderCatalogEntry(providerId);
    if (!entry) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (compareVersions(SCRIPT_VERSION, entry.minRuntimeVersion) < 0) {
      throw new Error(
        `Provider ${providerId} requires runtime ${entry.minRuntimeVersion}, current runtime is ${SCRIPT_VERSION}`
      );
    }

    const remoteCodeCheck = getRemoteCodeExecutionCheck();
    const fallbackProvider = builtInProviders.get(providerId);
    if (!remoteCodeCheck.supported && fallbackProvider) {
      state.providerRegistry.set(providerId, fallbackProvider);
      return fallbackProvider;
    }

    const task = loadRemoteProvider(entry, state.providerManifest).finally(() => {
      state.providerLoadTasks.delete(providerId);
    });
    state.providerLoadTasks.set(providerId, task);
    try {
      return await task;
    } catch (error) {
      if (fallbackProvider) {
        console.warn(
          `[modular-web-translator] remote provider ${providerId} blocked, falling back to built-in provider`,
          error
        );
        state.providerRegistry.set(providerId, fallbackProvider);
        return fallbackProvider;
      }

      throw error;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function getProviderRequestPolicy(providerId) {
    return PROVIDER_REQUEST_POLICY[providerId] || PROVIDER_REQUEST_POLICY.default;
  }

  function getProviderRequestState(providerId) {
    if (!state.providerRequestState.has(providerId)) {
      state.providerRequestState.set(providerId, {
        lastStartedAt: 0,
        blockedUntil: 0,
      });
    }

    return state.providerRequestState.get(providerId);
  }

  async function waitForProviderRequestWindow(providerId) {
    const policy = getProviderRequestPolicy(providerId);
    const providerState = getProviderRequestState(providerId);
    const now = Date.now();
    const nextAvailableAt = Math.max(
      providerState.blockedUntil,
      providerState.lastStartedAt + policy.minIntervalMs
    );
    const waitMs = Math.max(0, nextAvailableAt - now);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    providerState.lastStartedAt = Date.now();
  }

  function noteProviderRequestResult(providerId, error) {
    const providerState = getProviderRequestState(providerId);
    if (!error) {
      if (providerState.blockedUntil < Date.now()) {
        providerState.blockedUntil = 0;
      }
      return;
    }

    const message = formatError(error).toLowerCase();
    const shouldBackoff =
      message.includes("http 429") ||
      message.includes("allowed translations") ||
      message.includes("too many requests") ||
      message.includes("quota") ||
      message.includes("sogou error 10") ||
      message.includes("failed to initialize a sogou session") ||
      message.includes("request timed out");

    if (!shouldBackoff) {
      return;
    }

    const policy = getProviderRequestPolicy(providerId);
    providerState.blockedUntil = Math.max(
      providerState.blockedUntil,
      Date.now() + policy.failureBackoffMs
    );
  }

  function isProviderLimitError(error) {
    const message = formatError(error).toLowerCase();
    return (
      message.includes("http 429") ||
      message.includes("allowed translations") ||
      message.includes("too many requests") ||
      message.includes("quota") ||
      message.includes("sogou error 10")
    );
  }

  function blockProviderTemporarily(providerId, minimumBackoffMs) {
    const providerState = getProviderRequestState(providerId);
    const policy = getProviderRequestPolicy(providerId);
    const backoffMs = Math.max(Number(minimumBackoffMs) || 0, policy.failureBackoffMs);

    providerState.blockedUntil = Math.max(
      providerState.blockedUntil,
      Date.now() + backoffMs
    );
  }

  function getAutoBalancedProviderOrder(targetLanguage) {
    const now = Date.now();

    return getConcreteProviderCatalogEntries()
      .filter(
        (provider) => provider.languageMap && provider.languageMap[targetLanguage]
      )
      .sort((left, right) => {
        const leftState = getProviderRequestState(left.id);
        const rightState = getProviderRequestState(right.id);
        const leftBlockedFor = Math.max(0, leftState.blockedUntil - now);
        const rightBlockedFor = Math.max(0, rightState.blockedUntil - now);

        if (leftBlockedFor !== rightBlockedFor) {
          return leftBlockedFor - rightBlockedFor;
        }
        if (leftState.lastStartedAt !== rightState.lastStartedAt) {
          return leftState.lastStartedAt - rightState.lastStartedAt;
        }

        return left.id.localeCompare(right.id);
      })
      .map((provider) => provider.id);
  }

  function getProviderAttemptOrder(primaryProviderId, targetLanguage) {
    if (isVirtualProviderId(primaryProviderId)) {
      return getAutoBalancedProviderOrder(targetLanguage);
    }

    const primary = [primaryProviderId];
    const fallbacks = getAutoBalancedProviderOrder(targetLanguage).filter(
      (providerId) => providerId !== primaryProviderId
    );

    return primary.concat(fallbacks);
  }

  function promoteProviderChoice(nextProviderId, reason) {
    const normalized = normalizeSettings(
      Object.assign({}, state.settings, {
        provider: nextProviderId,
      })
    );

    if (normalized.provider === state.settings.provider) {
      return;
    }

    state.settings = normalized;
    state.uiNotice = `Auto-switched to ${getProviderLabel(nextProviderId)} after ${reason}.`;
    writeSettings(normalized);
    syncSettingsUi();
  }

  function createProviderRuntime(providerId) {
    return {
      providerId,
      request,
      requestText,
      requestJson,
      buildFormBody,
      parseResponseCookies,
      mergeCookieHeaders,
      parseGoogleTranslation,
      compareVersions,
      md5,
      getLanguageCode(languageId) {
        return mapLanguageCode(languageId, providerId);
      },
    };
  }

  function translateText(text) {
    const settingsSnapshot = Object.assign({}, state.settings);
    const providerId = settingsSnapshot.provider;
    const debugId = ++state.translationDebugCounter;

    const cacheKey = JSON.stringify({
      provider: providerId,
      targetLanguage: settingsSnapshot.targetLanguage,
      sourceLanguage: settingsSnapshot.sourceLanguage,
      text,
    });

    if (!state.translationCache.has(cacheKey)) {
      const task = enqueueRequest(async () => {
        const providerAttemptOrder = getProviderAttemptOrder(
          providerId,
          settingsSnapshot.targetLanguage
        );
        let lastError = null;

        log(`tx#${debugId} start`, {
          provider: providerId,
          targetLanguage: settingsSnapshot.targetLanguage,
          sourceLanguage: settingsSnapshot.sourceLanguage,
          text: previewText(text),
        });
        log(`tx#${debugId} provider order`, providerAttemptOrder);

        for (const candidateProviderId of providerAttemptOrder) {
          const candidateSettings = Object.assign({}, settingsSnapshot, {
            provider: candidateProviderId,
          });

          try {
            log(`tx#${debugId} trying provider`, candidateProviderId);
            const provider = await ensureProviderLoaded(candidateProviderId);
            await waitForProviderRequestWindow(candidateProviderId);
            const result = await provider.translateText(
              text,
              candidateSettings,
              createProviderRuntime(candidateProviderId)
            );
            noteProviderRequestResult(candidateProviderId, null);

            if (
              candidateProviderId !== providerId &&
              !isVirtualProviderId(providerId)
            ) {
              promoteProviderChoice(candidateProviderId, formatError(lastError || "rate limit"));
            }

            log(`tx#${debugId} success`, {
              provider: candidateProviderId,
              detectedSourceLanguage: result.detectedSourceLanguage || candidateSettings.sourceLanguage,
              text: previewText(result.text),
            });
            return Object.assign({}, result, {
              providerId: candidateProviderId,
            });
          } catch (error) {
            noteProviderRequestResult(candidateProviderId, error);
            lastError = error;
            console.warn(
              "[modular-web-translator]",
              `tx#${debugId} provider failed`,
              candidateProviderId,
              formatError(error)
            );

            if (isVirtualProviderId(providerId)) {
              if (!isProviderLimitError(error)) {
                blockProviderTemporarily(candidateProviderId, 60000);
              }
              continue;
            }

            if (!isProviderLimitError(error)) {
              throw error;
            }
          }
        }

        console.error(
          "[modular-web-translator]",
          `tx#${debugId} all providers failed`,
          formatError(lastError || "All providers failed.")
        );
        throw lastError || new Error("All providers failed.");
      })
        .catch((error) => {
          state.translationCache.delete(cacheKey);
          throw error;
        });
      state.translationCache.set(cacheKey, task);
    }

    return state.translationCache.get(cacheKey);
  }

  function enqueueRequest(task) {
    return new Promise((resolve, reject) => {
      state.queue.push({
        task,
        resolve,
        reject,
      });
      pumpQueue();
    });
  }

  function pumpQueue() {
    while (state.activeRequests < QUEUE_CONCURRENCY && state.queue.length > 0) {
      const item = state.queue.shift();
      state.activeRequests += 1;

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          state.activeRequests -= 1;
          pumpQueue();
        });
    }
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
    const rightParts = String(right || "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const leftValue = leftParts[index] || 0;
      const rightValue = rightParts[index] || 0;
      if (leftValue > rightValue) {
        return 1;
      }
      if (leftValue < rightValue) {
        return -1;
      }
    }

    return 0;
  }

  function normalizeManifest(rawManifest) {
    const manifest = rawManifest && typeof rawManifest === "object" ? rawManifest : {};
    const modules = Array.isArray(manifest.modules) ? manifest.modules : [];

    return {
      schemaVersion: Number(manifest.schemaVersion) || 1,
      version: String(manifest.version || "1.0.0"),
      cacheTtlMinutes:
        Number(manifest.cacheTtlMinutes) || DEFAULT_MANIFEST_TTL_MS / 60 / 1000,
      moduleCacheTtlMinutes:
        Number(manifest.moduleCacheTtlMinutes) || DEFAULT_MODULE_TTL_MS / 60 / 1000,
      modules: modules
        .filter((entry) => entry && typeof entry === "object" && entry.id && entry.scriptUrl)
        .map((entry) => ({
          id: String(entry.id),
          name: String(entry.name || entry.id),
          version: String(entry.version || "1.0.0"),
          scriptUrl: String(entry.scriptUrl),
          minRuntimeVersion: String(entry.minRuntimeVersion || "1.0.0"),
          matchRules: Array.isArray(entry.matchRules) ? entry.matchRules : [],
        })),
    };
  }

  async function loadManifest() {
    const cached = storageGet(MANIFEST_CACHE_KEY, null);
    const now = Date.now();

    if (cached && cached.expiresAt > now && cached.data) {
      return normalizeManifest(cached.data);
    }

    try {
      const manifest = normalizeManifest(
        await requestJson({
          method: "GET",
          url: REMOTE_MANIFEST_URL,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Cache-Control": "no-cache",
          },
        })
      );
      const ttlMs = Math.max(1, manifest.cacheTtlMinutes) * 60 * 1000;
      storageSet(MANIFEST_CACHE_KEY, {
        fetchedAt: now,
        expiresAt: now + ttlMs,
        data: manifest,
      });
      return manifest;
    } catch (error) {
      if (cached && cached.data) {
        console.warn(
          "[modular-web-translator] manifest fetch failed, using cached manifest",
          error
        );
        return normalizeManifest(cached.data);
      }

      throw error;
    }
  }

  function moduleMatchesUrl(entry, urlObject) {
    if (!Array.isArray(entry.matchRules) || entry.matchRules.length === 0) {
      return false;
    }

    return entry.matchRules.some((rule) => {
      if (!rule || typeof rule !== "object") {
        return false;
      }
      if (rule.protocol && rule.protocol !== urlObject.protocol.replace(":", "")) {
        return false;
      }
      if (rule.hostname && rule.hostname !== urlObject.hostname) {
        return false;
      }
      if (rule.hostnameEndsWith && !urlObject.hostname.endsWith(rule.hostnameEndsWith)) {
        return false;
      }
      if (rule.pathnameEquals && urlObject.pathname !== rule.pathnameEquals) {
        return false;
      }
      if (rule.pathnameStartsWith && !urlObject.pathname.startsWith(rule.pathnameStartsWith)) {
        return false;
      }
      if (rule.pathnameRegex) {
        try {
          if (!(new RegExp(rule.pathnameRegex).test(urlObject.pathname))) {
            return false;
          }
        } catch (error) {
          console.warn(
            `[modular-web-translator] invalid pathnameRegex in module rule for ${entry.id}`,
            error
          );
          return false;
        }
      }
      if (rule.searchContains && !urlObject.search.includes(rule.searchContains)) {
        return false;
      }

      return true;
    });
  }

  function getModuleCacheKey(moduleId) {
    return `${MODULE_CACHE_KEY_PREFIX}${moduleId}`;
  }

  async function loadModuleSource(entry, manifest) {
    const cacheKey = getModuleCacheKey(entry.id);
    const cached = storageGet(cacheKey, null);
    const now = Date.now();
    const ttlMs = Math.max(1, manifest.moduleCacheTtlMinutes || 30) * 60 * 1000;

    if (
      cached &&
      cached.version === entry.version &&
      cached.scriptUrl === entry.scriptUrl &&
      cached.expiresAt > now &&
      cached.code
    ) {
      return cached.code;
    }

    try {
      const code = await requestText({
        method: "GET",
        url: entry.scriptUrl,
        headers: {
          Accept: "text/plain, application/javascript, */*",
          "Cache-Control": "no-cache",
        },
      });
      storageSet(cacheKey, {
        version: entry.version,
        scriptUrl: entry.scriptUrl,
        code,
        fetchedAt: now,
        expiresAt: now + ttlMs,
      });
      return code;
    } catch (error) {
      if (cached && cached.code) {
        console.warn(
          `[modular-web-translator] module fetch failed for ${entry.id}, using cached module`,
          error
        );
        return cached.code;
      }

      throw error;
    }
  }

  function registerSiteModule(moduleDefinition) {
    if (!moduleDefinition || typeof moduleDefinition !== "object") {
      throw new Error("Module definition must be an object.");
    }
    if (!moduleDefinition.id || typeof moduleDefinition.mount !== "function") {
      throw new Error("Module definition must include id and mount(runtime).");
    }

    state.moduleRegistry.set(moduleDefinition.id, moduleDefinition);
  }

  function ensureGlobalRegistry() {
    const existing = globalThis[MODULE_REGISTRY_NAME];
    const registry = existing && typeof existing === "object" ? existing : {};
    registry.version = SCRIPT_VERSION;
    registry.registerSiteModule = registerSiteModule;
    registry.registerTranslationProvider = registerTranslationProvider;
    globalThis[MODULE_REGISTRY_NAME] = registry;
  }

  async function loadRemoteModule(entry, manifest) {
    const code = await loadModuleSource(entry, manifest);
    const executor = new Function(
      `${code}\n//# sourceURL=${entry.scriptUrl.replace(/[\r\n]/g, "")}`
    );
    executor.call(globalThis);

    const registered = state.moduleRegistry.get(entry.id);
    if (!registered) {
      throw new Error(`Remote module ${entry.id} did not register itself.`);
    }

    return registered;
  }

  function createRuntime() {
    return {
      version: SCRIPT_VERSION,
      log,
      request,
      requestText,
      requestJson,
      translateText,
      getSettings() {
        return Object.assign({}, state.settings);
      },
      applySettings,
      onSettingsChanged,
      getLanguageLabel,
      getProviderLabel,
      ensureProviderLoaded,
      getCurrentProviderLabel() {
        return getProviderLabel(state.settings.provider);
      },
      getCurrentLanguageLabel() {
        return getLanguageLabel(state.settings.targetLanguage);
      },
      ui: {
        ensureSettingsUi,
        createSection,
        attachSectionAfter,
        removeSection,
        setSectionMeta,
        setSectionLoading,
        setSectionSuccess,
        setSectionError,
      },
      providers: {
        getCatalogEntries: getProviderCatalogEntries,
        getCatalogEntry: getProviderCatalogEntry,
        getLanguageCode(providerId, languageId) {
          return mapLanguageCode(languageId, providerId);
        },
      },
      utils: {
        uniqueNodes,
        normalizeInlineText,
        normalizeMultilineText,
        getFirstText,
        debounce,
        formatError,
      },
    };
  }

  async function mountDirectFallbackModules(runtime) {
    let mountedAny = false;
    const fallbackModules = Array.from(new Set(builtInSiteModules.values()));

    for (const fallbackModule of fallbackModules) {
      try {
        const result = await Promise.resolve(fallbackModule.mount(runtime));
        if (typeof result !== "undefined") {
          mountedAny = true;
        }
      } catch (error) {
        console.error(
          `[modular-web-translator] failed to mount direct fallback module ${fallbackModule.id}`,
          error
        );
      }
    }

    return mountedAny;
  }

  function waitForDocumentBody() {
    if (document.body) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      window.addEventListener(
        "DOMContentLoaded",
        () => {
          resolve();
        },
        { once: true }
      );
    });
  }

  async function boot() {
    await waitForDocumentBody();
    ensureGlobalRegistry();
    registerBuiltInFallbacks();
    log("boot start", {
      version: SCRIPT_VERSION,
      href: location.href,
    });

    await ensureProviderCatalogLoaded();
    log(
      "provider catalog ready",
      getConcreteProviderCatalogEntries().map((provider) => provider.id)
    );
    const normalizedSettings = normalizeSettings(state.settings);
    const settingsChanged =
      JSON.stringify(normalizedSettings) !== JSON.stringify(state.settings);
    state.settings = normalizedSettings;
    if (settingsChanged) {
      writeSettings(normalizedSettings);
    }
    if (!isVirtualProviderId(state.settings.provider)) {
      try {
        await ensureProviderLoaded(state.settings.provider);
      } catch (error) {
        console.warn(
          `[modular-web-translator] failed to preload provider ${state.settings.provider}`,
          error
        );
      }
    }

    let manifest;
    try {
      manifest = await loadManifest();
    } catch (error) {
      console.error("[modular-web-translator] failed to load manifest", error);
      ensureStyles();
      await mountDirectFallbackModules(createRuntime());
      return;
    }

    const matchedModules = manifest.modules.filter((entry) => moduleMatchesUrl(entry, window.location));
    log(
      "matched modules",
      matchedModules.map((entry) => entry.id)
    );
    if (matchedModules.length === 0) {
      log("No remote site module matched current page.", location.href);
      ensureStyles();
      await mountDirectFallbackModules(createRuntime());
      return;
    }

    ensureStyles();
    const runtime = createRuntime();
    const remoteCodeCheck = getRemoteCodeExecutionCheck();

    for (const entry of matchedModules) {
      if (compareVersions(SCRIPT_VERSION, entry.minRuntimeVersion) < 0) {
        console.warn(
          `[modular-web-translator] module ${entry.id} requires runtime ${entry.minRuntimeVersion}, current runtime is ${SCRIPT_VERSION}`
        );
        continue;
      }

      const fallbackModule = builtInSiteModules.get(entry.id);
      if (!remoteCodeCheck.supported && fallbackModule) {
        await Promise.resolve(fallbackModule.mount(runtime, entry));
        continue;
      }

      try {
        const moduleDefinition = await loadRemoteModule(entry, manifest);
        await Promise.resolve(moduleDefinition.mount(runtime, entry));
        log("Mounted remote module", entry.id, entry.version);
      } catch (error) {
        if (fallbackModule) {
          console.warn(
            `[modular-web-translator] remote module ${entry.id} blocked, falling back to built-in module`,
            error
          );
          await Promise.resolve(fallbackModule.mount(runtime, entry));
          continue;
        }

        console.error(`[modular-web-translator] failed to mount module ${entry.id}`, error);
      }
    }
  }

  function md5(input) {
    const text = unescape(encodeURIComponent(String(input)));
    const words = convertToWordArray(text);

    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    const S11 = 7;
    const S12 = 12;
    const S13 = 17;
    const S14 = 22;
    const S21 = 5;
    const S22 = 9;
    const S23 = 14;
    const S24 = 20;
    const S31 = 4;
    const S32 = 11;
    const S33 = 16;
    const S34 = 23;
    const S41 = 6;
    const S42 = 10;
    const S43 = 15;
    const S44 = 21;

    for (let index = 0; index < words.length; index += 16) {
      const aa = a;
      const bb = b;
      const cc = c;
      const dd = d;

      a = FF(a, b, c, d, words[index + 0], S11, 0xd76aa478);
      d = FF(d, a, b, c, words[index + 1], S12, 0xe8c7b756);
      c = FF(c, d, a, b, words[index + 2], S13, 0x242070db);
      b = FF(b, c, d, a, words[index + 3], S14, 0xc1bdceee);
      a = FF(a, b, c, d, words[index + 4], S11, 0xf57c0faf);
      d = FF(d, a, b, c, words[index + 5], S12, 0x4787c62a);
      c = FF(c, d, a, b, words[index + 6], S13, 0xa8304613);
      b = FF(b, c, d, a, words[index + 7], S14, 0xfd469501);
      a = FF(a, b, c, d, words[index + 8], S11, 0x698098d8);
      d = FF(d, a, b, c, words[index + 9], S12, 0x8b44f7af);
      c = FF(c, d, a, b, words[index + 10], S13, 0xffff5bb1);
      b = FF(b, c, d, a, words[index + 11], S14, 0x895cd7be);
      a = FF(a, b, c, d, words[index + 12], S11, 0x6b901122);
      d = FF(d, a, b, c, words[index + 13], S12, 0xfd987193);
      c = FF(c, d, a, b, words[index + 14], S13, 0xa679438e);
      b = FF(b, c, d, a, words[index + 15], S14, 0x49b40821);

      a = GG(a, b, c, d, words[index + 1], S21, 0xf61e2562);
      d = GG(d, a, b, c, words[index + 6], S22, 0xc040b340);
      c = GG(c, d, a, b, words[index + 11], S23, 0x265e5a51);
      b = GG(b, c, d, a, words[index + 0], S24, 0xe9b6c7aa);
      a = GG(a, b, c, d, words[index + 5], S21, 0xd62f105d);
      d = GG(d, a, b, c, words[index + 10], S22, 0x02441453);
      c = GG(c, d, a, b, words[index + 15], S23, 0xd8e1c681);
      b = GG(b, c, d, a, words[index + 4], S24, 0xe7d3fbc8);
      a = GG(a, b, c, d, words[index + 9], S21, 0x21e1cde6);
      d = GG(d, a, b, c, words[index + 14], S22, 0xc33707d6);
      c = GG(c, d, a, b, words[index + 3], S23, 0xf4d50d87);
      b = GG(b, c, d, a, words[index + 8], S24, 0x455a14ed);
      a = GG(a, b, c, d, words[index + 13], S21, 0xa9e3e905);
      d = GG(d, a, b, c, words[index + 2], S22, 0xfcefa3f8);
      c = GG(c, d, a, b, words[index + 7], S23, 0x676f02d9);
      b = GG(b, c, d, a, words[index + 12], S24, 0x8d2a4c8a);

      a = HH(a, b, c, d, words[index + 5], S31, 0xfffa3942);
      d = HH(d, a, b, c, words[index + 8], S32, 0x8771f681);
      c = HH(c, d, a, b, words[index + 11], S33, 0x6d9d6122);
      b = HH(b, c, d, a, words[index + 14], S34, 0xfde5380c);
      a = HH(a, b, c, d, words[index + 1], S31, 0xa4beea44);
      d = HH(d, a, b, c, words[index + 4], S32, 0x4bdecfa9);
      c = HH(c, d, a, b, words[index + 7], S33, 0xf6bb4b60);
      b = HH(b, c, d, a, words[index + 10], S34, 0xbebfbc70);
      a = HH(a, b, c, d, words[index + 13], S31, 0x289b7ec6);
      d = HH(d, a, b, c, words[index + 0], S32, 0xeaa127fa);
      c = HH(c, d, a, b, words[index + 3], S33, 0xd4ef3085);
      b = HH(b, c, d, a, words[index + 6], S34, 0x04881d05);
      a = HH(a, b, c, d, words[index + 9], S31, 0xd9d4d039);
      d = HH(d, a, b, c, words[index + 12], S32, 0xe6db99e5);
      c = HH(c, d, a, b, words[index + 15], S33, 0x1fa27cf8);
      b = HH(b, c, d, a, words[index + 2], S34, 0xc4ac5665);

      a = II(a, b, c, d, words[index + 0], S41, 0xf4292244);
      d = II(d, a, b, c, words[index + 7], S42, 0x432aff97);
      c = II(c, d, a, b, words[index + 14], S43, 0xab9423a7);
      b = II(b, c, d, a, words[index + 5], S44, 0xfc93a039);
      a = II(a, b, c, d, words[index + 12], S41, 0x655b59c3);
      d = II(d, a, b, c, words[index + 3], S42, 0x8f0ccc92);
      c = II(c, d, a, b, words[index + 10], S43, 0xffeff47d);
      b = II(b, c, d, a, words[index + 1], S44, 0x85845dd1);
      a = II(a, b, c, d, words[index + 8], S41, 0x6fa87e4f);
      d = II(d, a, b, c, words[index + 15], S42, 0xfe2ce6e0);
      c = II(c, d, a, b, words[index + 6], S43, 0xa3014314);
      b = II(b, c, d, a, words[index + 13], S44, 0x4e0811a1);
      a = II(a, b, c, d, words[index + 4], S41, 0xf7537e82);
      d = II(d, a, b, c, words[index + 11], S42, 0xbd3af235);
      c = II(c, d, a, b, words[index + 2], S43, 0x2ad7d2bb);
      b = II(b, c, d, a, words[index + 9], S44, 0xeb86d391);

      a = addUnsigned(a, aa);
      b = addUnsigned(b, bb);
      c = addUnsigned(c, cc);
      d = addUnsigned(d, dd);
    }

    return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
  }

  function F(x, y, z) {
    return (x & y) | (~x & z);
  }

  function G(x, y, z) {
    return (x & z) | (y & ~z);
  }

  function H(x, y, z) {
    return x ^ y ^ z;
  }

  function I(x, y, z) {
    return y ^ (x | ~z);
  }

  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function rotateLeft(value, shift) {
    return (value << shift) | (value >>> (32 - shift));
  }

  function addUnsigned(left, right) {
    const left4 = left & 0x40000000;
    const right4 = right & 0x40000000;
    const left8 = left & 0x80000000;
    const right8 = right & 0x80000000;
    const result = (left & 0x3fffffff) + (right & 0x3fffffff);

    if (left4 & right4) {
      return result ^ 0x80000000 ^ left8 ^ right8;
    }

    if (left4 | right4) {
      if (result & 0x40000000) {
        return result ^ 0xc0000000 ^ left8 ^ right8;
      }
      return result ^ 0x40000000 ^ left8 ^ right8;
    }

    return result ^ left8 ^ right8;
  }

  function convertToWordArray(text) {
    const length = text.length;
    const wordCount = (((length + 8) - ((length + 8) % 64)) / 64 + 1) * 16;
    const words = new Array(wordCount - 1);
    let byteIndex = 0;
    let wordIndex = 0;

    while (byteIndex < length) {
      wordIndex = (byteIndex - (byteIndex % 4)) / 4;
      words[wordIndex] = words[wordIndex] || 0;
      words[wordIndex] |= text.charCodeAt(byteIndex) << ((byteIndex % 4) * 8);
      byteIndex += 1;
    }

    wordIndex = (byteIndex - (byteIndex % 4)) / 4;
    words[wordIndex] = words[wordIndex] || 0;
    words[wordIndex] |= 0x80 << ((byteIndex % 4) * 8);
    words[wordCount - 2] = length << 3;
    words[wordCount - 1] = length >>> 29;
    return words;
  }

  function wordToHex(value) {
    let output = "";
    for (let count = 0; count <= 3; count += 1) {
      output += (`0${((value >>> (count * 8)) & 255).toString(16)}`).slice(-2);
    }
    return output;
  }

  boot().catch((error) => {
    console.error("[modular-web-translator] boot failed", error);
  });
})();
