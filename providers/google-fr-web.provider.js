(function () {
  "use strict";

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "google-fr-web",
    label: "Google FR Web",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";

      const response = await runtime.requestJson({
        method: "POST",
        url:
          "https://translate.google.fr/translate_a/single?client=gtx&dt=t" +
          `&sl=${encodeURIComponent(sourceLanguage)}` +
          `&tl=${encodeURIComponent(targetLanguage)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://translate.google.fr",
          Referer: "https://translate.google.fr/",
        },
        data: runtime.buildFormBody({
          q: text,
        }),
        timeout: 15000,
      });

      const translated = runtime.parseGoogleTranslation(response);
      if (!translated) {
        throw new Error("Google FR returned an empty result.");
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
