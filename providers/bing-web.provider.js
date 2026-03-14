(function () {
  "use strict";

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

  async function ensureBingBootstrap(runtime, forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && bingBootstrap && bingBootstrapExpiresAt > now) {
      return bingBootstrap;
    }

    const response = await runtime.request({
      method: "GET",
      url: "https://www.bing.com/translator",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
    });

    bingBootstrap = Object.assign(parseBingBootstrap(response.responseText || ""), {
      cookie: runtime.parseResponseCookies(response.responseHeaders),
    });
    bingBootstrapExpiresAt = now + BING_BOOTSTRAP_TTL_MS;
    return bingBootstrap;
  }

  async function translateWithBing(text, settings, runtime, retried) {
    const bootstrap = await ensureBingBootstrap(runtime, retried);
    const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
    const sourceLanguage =
      settings.sourceLanguage && settings.sourceLanguage !== "auto"
        ? settings.sourceLanguage
        : "auto-detect";

    const response = await runtime.requestJson({
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
      data: runtime.buildFormBody({
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
      return translateWithBing(text, settings, runtime, true);
    }

    throw new Error(errorMessage || "Bing returned an empty result.");
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "bing-web",
    label: "Bing Web",
    async translateText(text, settings, runtime) {
      return translateWithBing(text, settings, runtime, false);
    },
  });
})();
