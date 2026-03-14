(function () {
  "use strict";

  const SOGOU_BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
  let sogouBootstrap = null;
  let sogouBootstrapExpiresAt = 0;

  async function ensureSogouBootstrap(runtime, forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && sogouBootstrap && sogouBootstrapExpiresAt > now) {
      return sogouBootstrap;
    }

    const response = await runtime.request({
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
      cookie: runtime.parseResponseCookies(response.responseHeaders),
    };
    sogouBootstrapExpiresAt = now + SOGOU_BOOTSTRAP_TTL_MS;
    return sogouBootstrap;
  }

  async function translateWithSogou(text, settings, runtime, retried) {
    const bootstrap = await ensureSogouBootstrap(runtime, retried);
    const to = runtime.getLanguageCode(settings.targetLanguage);
    const from = settings.sourceLanguage || "auto";
    const signature = runtime.md5(`${from}${to}${text}${bootstrap.secretCode}`);

    const response = await runtime.requestJson({
      method: "POST",
      url: "https://fanyi.sogou.com/api/transpc/text/result",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        Origin: "https://fanyi.sogou.com",
        Referer: "https://fanyi.sogou.com/text",
        "X-Requested-With": "XMLHttpRequest",
      },
      data: runtime.buildFormBody({
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
      return translateWithSogou(text, settings, runtime, true);
    }

    throw new Error(
      errorCode
        ? `Sogou error ${errorCode}`
        : "Sogou returned an empty result."
    );
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "sogou-web",
    label: "Sogou Web",
    async translateText(text, settings, runtime) {
      return translateWithSogou(text, settings, runtime, false);
    },
  });
})();
