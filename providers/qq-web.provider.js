(function () {
  "use strict";

  const QQ_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
  let qqBootstrap = null;
  let qqBootstrapExpiresAt = 0;

  async function ensureQqBootstrap(runtime, forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && qqBootstrap && qqBootstrapExpiresAt > now) {
      return qqBootstrap;
    }

    const pageResponse = await runtime.request({
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

    const initialCookie = runtime.parseResponseCookies(pageResponse.responseHeaders);
    const authResponse = await runtime.request({
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
    const mergedCookie = runtime.mergeCookieHeaders(
      initialCookie,
      runtime.parseResponseCookies(authResponse.responseHeaders)
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

  async function translateWithQq(text, settings, runtime, retried) {
    const bootstrap = await ensureQqBootstrap(runtime, retried);
    const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
    const sourceLanguage = settings.sourceLanguage || "auto";
    const response = await runtime.requestJson({
      method: "POST",
      url: "https://fanyi.qq.com/api/translate",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        Origin: "https://fanyi.qq.com",
        Referer: "https://fanyi.qq.com/",
      },
      cookie: bootstrap.cookie,
      data: runtime.buildFormBody({
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
      return translateWithQq(text, settings, runtime, true);
    }

    throw new Error(
      response && response.message
        ? `QQ Fanyi error: ${response.message}`
        : "QQ Fanyi returned an empty result."
    );
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "qq-web",
    label: "QQ Fanyi",
    async translateText(text, settings, runtime) {
      return translateWithQq(text, settings, runtime, false);
    },
  });
})();
