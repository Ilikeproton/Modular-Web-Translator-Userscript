(function () {
  "use strict";

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildGoogleBatchEnvelope(texts) {
    const batchId =
      `MWT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const packedText = texts
      .map(
        (text, index) =>
          `__${batchId}_BEGIN_${index}__\n${String(text || "")}\n__${batchId}_END_${index}__`
      )
      .join("\n");

    return {
      batchId,
      packedText,
    };
  }

  function parseGoogleBatchEnvelope(translatedText, batchId, expectedCount) {
    const results = new Array(expectedCount).fill("");
    const pattern = new RegExp(
      `__${escapeRegExp(batchId)}_BEGIN_(\\d+)__\\s*([\\s\\S]*?)\\s*__${escapeRegExp(
        batchId
      )}_END_\\1__`,
      "g"
    );

    let match = null;
    while ((match = pattern.exec(String(translatedText || "")))) {
      const index = Number.parseInt(match[1], 10);
      if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
        continue;
      }
      results[index] = String(match[2] || "").trim();
    }

    if (results.some((item) => !item)) {
      throw new Error("Failed to split Google DE batch translation.");
    }

    return results;
  }

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
    async translateTexts(texts, settings, runtime) {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      if (texts.length === 1) {
        return [await this.translateText(texts[0], settings, runtime)];
      }

      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";
      const envelope = buildGoogleBatchEnvelope(texts);

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
          q: envelope.packedText,
        }),
        timeout: 15000,
      });

      const translated = runtime.parseGoogleTranslation(response);
      const detectedSourceLanguage =
        Array.isArray(response) && typeof response[2] === "string"
          ? response[2]
          : sourceLanguage;
      const splitTexts = parseGoogleBatchEnvelope(translated, envelope.batchId, texts.length);

      return splitTexts.map((item) => ({
        text: item,
        detectedSourceLanguage,
      }));
    },
  });
})();
