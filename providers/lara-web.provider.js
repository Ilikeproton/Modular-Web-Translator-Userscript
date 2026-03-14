(function () {
  "use strict";

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

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "lara-web",
    label: "Lara Web",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";

      const response = await runtime.requestJson({
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
})();
