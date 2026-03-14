(function () {
  "use strict";

  function createYandexRequestId() {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}-0-0`;
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "yandex-web",
    label: "Yandex Web",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";
      const lang =
        sourceLanguage === "auto"
          ? targetLanguage
          : `${sourceLanguage}-${targetLanguage}`;

      const response = await runtime.requestJson({
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
        data: runtime.buildFormBody({
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
})();
