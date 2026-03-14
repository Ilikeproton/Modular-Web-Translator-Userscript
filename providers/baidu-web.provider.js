(function () {
  "use strict";

  globalThis.ModularWebTranslator.registerTranslationProvider({
    id: "baidu-web",
    label: "Baidu Fanyi",
    async translateText(text, settings, runtime) {
      const targetLanguage = runtime.getLanguageCode(settings.targetLanguage);
      const sourceLanguage = settings.sourceLanguage || "auto";

      const response = await runtime.requestJson({
        method: "POST",
        url: "https://fanyi.baidu.com/transapi",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://fanyi.baidu.com",
          Referer: "https://fanyi.baidu.com/",
        },
        data: runtime.buildFormBody({
          from: sourceLanguage,
          to: targetLanguage,
          query: text,
          source: "txt",
        }),
        timeout: 15000,
      });

      const translated = Array.isArray(response.data)
        ? response.data
            .map((item) => (item && typeof item.dst === "string" ? item.dst : ""))
            .join("")
            .trim()
        : "";

      if (!translated) {
        throw new Error(
          response && response.errmsg
            ? `Baidu error: ${response.errmsg}`
            : "Baidu returned an empty result."
        );
      }

      return {
        text: translated,
        detectedSourceLanguage:
          response && typeof response.from === "string" ? response.from : sourceLanguage,
      };
    },
  });
})();
