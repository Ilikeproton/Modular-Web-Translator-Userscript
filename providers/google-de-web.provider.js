(function () {
  "use strict";

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "google-de-web",
    label: "Google DE Web",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";

      const response = await runtime.requestJson({
        method: "POST",
        url:
          "https://translate.google.de/translate_a/single?client=gtx&dt=t" +
          `&sl=${encodeURIComponent(sourceLanguage)}` +
          `&tl=${encodeURIComponent(targetLanguage)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://translate.google.de",
          Referer: "https://translate.google.de/",
        },
        data: runtime.buildFormBody({
          q: text,
        }),
        timeout: 15000,
      });

      const translated = runtime.parseGoogleTranslation(response);
      if (!translated) {
        throw new Error("Google DE returned an empty result.");
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
})();
