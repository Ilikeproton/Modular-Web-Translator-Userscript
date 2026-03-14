(function () {
  "use strict";

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

  function buildYoudaoSignedFields(fields, pointParam, secretKey, runtime) {
    const signatureInput = pointParam
      .map((field) => {
        if (field === "key") {
          return `key=${secretKey}`;
        }
        return `${field}=${fields[field] == null ? "" : String(fields[field])}`;
      })
      .join("&");

    return Object.assign({}, fields, {
      sign: runtime.md5(signatureInput),
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
        detectedSourceLanguage = payload.translateDirection.split("2")[0] || detectedSourceLanguage;
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

  async function fetchYoudaoJson(runtime, options) {
    const response = await runtime.request(options);
    return {
      response,
      payload: JSON.parse(response.responseText || "{}"),
    };
  }

  async function ensureYoudaoBootstrap(runtime, forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && youdaoBootstrap && youdaoBootstrapExpiresAt > now) {
      return youdaoBootstrap;
    }

    const pageResponse = await runtime.request({
      method: "GET",
      url: "https://fanyi.youdao.com/",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
    });

    const initialCookie = runtime.parseResponseCookies(pageResponse.responseHeaders);
    const yduuid = runtime.md5(`${Date.now()}-${Math.random()}`);
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
      YOUDAO_BOOTSTRAP_SIGN_KEY,
      runtime
    );

    const { response, payload } = await fetchYoudaoJson(runtime, {
      method: "GET",
      url: `https://luna-ai.youdao.com/translate_llm/secret?${runtime.buildFormBody(
        secretFields
      )}`,
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      cookie: initialCookie,
      timeout: 15000,
    });

    const mergedCookie = runtime.mergeCookieHeaders(
      initialCookie,
      runtime.parseResponseCookies(response.responseHeaders)
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

  async function warmYoudaoConversation(runtime, bootstrap) {
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
      bootstrap.secretKey,
      runtime
    );

    await runtime.request({
      method: "GET",
      url: `https://luna-ai.youdao.com/translate_llm/v3/uuid/generate?${runtime.buildFormBody(
        signedFields
      )}`,
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      cookie: bootstrap.cookie,
      timeout: 15000,
    });
  }

  async function translateWithYoudao(text, settings, runtime, retried) {
    try {
      const bootstrap = await ensureYoudaoBootstrap(runtime, retried);
      const requestedTargetLanguage = runtime.getLanguageCode(settings.targetLanguage);
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
        bootstrap.secretKey,
        runtime
      );
      const directionMultipart = buildMultipartBody(directionFields);
      const directionPayload = await runtime.requestJson({
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
        await warmYoudaoConversation(runtime, bootstrap);
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
        bootstrap.secretKey,
        runtime
      );
      const chatMultipart = buildMultipartBody(chatFields);
      const chatResponse = await runtime.request({
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
        return translateWithYoudao(text, settings, runtime, true);
      }
      throw error;
    }
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "youdao-web",
    label: "Youdao Web",
    async translateText(text, settings, runtime) {
      return translateWithYoudao(text, settings, runtime, false);
    },
  });
})();
