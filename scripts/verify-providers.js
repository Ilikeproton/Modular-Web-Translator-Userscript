const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROVIDERS_DIR = path.join(ROOT_DIR, "providers");
const MANIFEST_PATH = path.join(PROVIDERS_DIR, "manifest.json");
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";
const TEST_ALL = process.argv.includes("--all");
const TEST_TEXT = "Hello world.";
const TEST_LANGUAGE = "zh-CN";
const EXTRA_LANGUAGE_MAPS = {
  "qq-web": {
    "zh-CN": "zh",
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
  "yandex-web": {
    "zh-CN": "zh",
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
  "deepl-web": {
    "zh-CN": "ZH",
    en: "EN",
    ja: "JA",
    ko: "KO",
    fr: "FR",
    de: "DE",
    es: "ES",
    ru: "RU",
    vi: "VI",
    th: "TH",
  },
  "baidu-web": {
    "zh-CN": "zh",
    en: "en",
    ja: "jp",
    ko: "kor",
    fr: "fra",
    de: "de",
    es: "spa",
    ru: "ru",
    vi: "vie",
    th: "th",
  },
};

function execCurl(args) {
  const attempts = [
    args,
    [args[0], "--socks5-hostname", "127.0.0.1:1902", ...args.slice(1)],
    [args[0], "--socks5-hostname", "127.0.0.1:10601", ...args.slice(1)],
  ];
  let lastResult = null;

  for (const attempt of attempts) {
    const result = spawnSync(CURL_BIN, attempt, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    lastResult = result;
    if (result.status === 0) {
      return result;
    }
  }

  throw new Error((lastResult && (lastResult.stderr || lastResult.stdout)) || "curl failed");
}

function request(options) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = Object.assign({ "User-Agent": DEFAULT_UA }, options.headers || {});
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--compressed",
    "--ssl-no-revoke",
    "-X",
    method,
    "-D",
    "-",
    "-o",
    "-",
    "-w",
    "\n__MWT_STATUS__:%{http_code}",
    options.url,
  ];

  if (options.timeout) {
    args.push("--max-time", String(Math.ceil(options.timeout / 1000)));
  }
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (options.cookie) {
    args.push("-H", `Cookie: ${options.cookie}`);
  }
  if (typeof options.data !== "undefined") {
    args.push("--data-raw", String(options.data));
  }

  const result = execCurl(args);
  const marker = "\n__MWT_STATUS__:";
  const markerIndex = result.stdout.lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error("Unable to parse curl response.");
  }

  const payload = result.stdout.slice(0, markerIndex);
  const status = Number.parseInt(result.stdout.slice(markerIndex + marker.length).trim(), 10) || 0;
  let responseHeaders = "";
  let responseText = payload;
  const crlfSplitIndex = payload.lastIndexOf("\r\n\r\n");
  if (crlfSplitIndex !== -1) {
    responseHeaders = payload.slice(0, crlfSplitIndex);
    responseText = payload.slice(crlfSplitIndex + 4);
  } else {
    const lfSplitIndex = payload.lastIndexOf("\n\n");
    if (lfSplitIndex !== -1) {
      responseHeaders = payload.slice(0, lfSplitIndex);
      responseText = payload.slice(lfSplitIndex + 2);
    }
  }

  if (status >= 400) {
    const error = new Error(`HTTP ${status}`);
    error.status = status;
    error.responseHeaders = responseHeaders;
    error.responseText = responseText;
    throw error;
  }

  return {
    status,
    responseHeaders,
    responseText,
  };
}

async function requestText(options) {
  const response = await request(options);
  return response.responseText || "";
}

async function requestJson(options) {
  const response = await request(options);
  return JSON.parse(response.responseText || "null");
}

function buildFormBody(payload) {
  return Object.entries(payload)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value == null ? "" : String(value))}`
    )
    .join("&");
}

function parseResponseCookies(headersText) {
  return String(headersText || "")
    .split(/\r?\n/)
    .filter((line) => /^set-cookie:/i.test(line))
    .map((line) => line.replace(/^set-cookie:\s*/i, "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...values) {
  const jar = new Map();
  for (const value of values) {
    for (const part of String(value || "").split(";")) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      jar.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
    }
  }

  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function parseGoogleTranslation(response) {
  if (!Array.isArray(response) || !Array.isArray(response[0])) {
    return "";
  }

  return response[0]
    .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
    .join("")
    .trim();
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

function md5(input) {
  return crypto.createHash("md5").update(String(input), "utf8").digest("hex");
}

function loadRegisteredProviders() {
  const registeredProviders = new Map();
  const providerFiles = fs
    .readdirSync(PROVIDERS_DIR)
    .filter((fileName) => fileName.endsWith(".provider.js"))
    .sort();

  for (const fileName of providerFiles) {
    const code = fs.readFileSync(path.join(PROVIDERS_DIR, fileName), "utf8");
    const context = {
      globalThis: {},
      console,
      setTimeout,
      clearTimeout,
    };
    context.globalThis = context;
    context.globalThis.ModularWebTranslator = {
      registerTranslationProvider(providerDefinition) {
        registeredProviders.set(providerDefinition.id, providerDefinition);
      },
    };
    vm.runInNewContext(code, context, { filename: fileName });
  }

  return registeredProviders;
}

function getProvidersToTest(manifest, registeredProviders) {
  if (!TEST_ALL) {
    return manifest.providers.map((entry) => ({
      id: entry.id,
      languageMap: entry.languageMap || {},
    }));
  }

  return Array.from(registeredProviders.keys())
    .sort()
    .map((id) => ({
      id,
      languageMap:
        (manifest.providers.find((entry) => entry.id === id) || {}).languageMap ||
        EXTRA_LANGUAGE_MAPS[id] ||
        {},
    }));
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const registeredProviders = loadRegisteredProviders();
  const providersToTest = getProvidersToTest(manifest, registeredProviders);
  let hasFailures = false;

  for (const entry of providersToTest) {
    const provider = registeredProviders.get(entry.id);
    const runtime = {
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
        if (!entry.languageMap[languageId]) {
          throw new Error(`Unsupported target language: ${languageId}`);
        }
        return entry.languageMap[languageId];
      },
    };
    const startedAt = Date.now();

    try {
      const result = await provider.translateText(
        TEST_TEXT,
        {
          provider: entry.id,
          sourceLanguage: "auto",
          targetLanguage: TEST_LANGUAGE,
        },
        runtime
      );
      console.log(
        `OK   ${entry.id.padEnd(14)} ${String(Date.now() - startedAt).padStart(5)}ms  ${
          result.text
        }`
      );
    } catch (error) {
      hasFailures = true;
      console.log(
        `FAIL ${entry.id.padEnd(14)} ${String(Date.now() - startedAt).padStart(5)}ms  ${
          error.message || String(error)
        }`
      );
    }
  }

  process.exitCode = hasFailures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
