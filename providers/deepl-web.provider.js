(function () {
  "use strict";

  function buildDeepLTimestamp(text) {
    const letterCount = (String(text).match(/i/g) || []).length + 1;
    const now = Date.now();
    return now - (now % letterCount) + letterCount;
  }

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "deepl-web",
    label: "DeepL Web",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage =
        settings.sourceLanguage && settings.sourceLanguage !== "auto"
          ? settings.sourceLanguage.toUpperCase()
          : "AUTO";

      const response = await runtime.requestJson({
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
})();
