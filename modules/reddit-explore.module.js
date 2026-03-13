(function () {
  "use strict";

  const TRANSLATION_RETRY_COOLDOWN_MS = 15000;

  const CARD_CONTAINER_SELECTOR = [
    "[data-testid='community-card']",
    "faceplate-card",
    "article",
    "section",
    "li",
    "div[data-testid]",
    "div[class*='card']",
    "div[class*='Card']",
  ].join(", ");

  const TITLE_SELECTORS = [
    "a[href^='/r/']",
    "h2",
    "h3",
    "[data-testid='card-title']",
  ];

  const BODY_SELECTORS = [
    "p",
    "[data-testid='description']",
    "[slot='description']",
    "span",
  ];

  function isRedditExplorePage(url) {
    return url.hostname === "www.reddit.com" && url.pathname.startsWith("/explore");
  }

  function getCardNodes(root, runtime) {
    const communityLinks = Array.from(root.querySelectorAll("a[href^='/r/']"));
    const cards = communityLinks
      .map(
        (link) =>
          link.closest(CARD_CONTAINER_SELECTOR) ||
          link.closest("article, section, li") ||
          link.parentElement
      )
      .filter(Boolean);

    return runtime.utils.uniqueNodes(cards).filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      if (node.closest("header, nav")) {
        return false;
      }
      if (node.querySelector("shreddit-post, [data-testid='post-container']")) {
        return false;
      }
      return Boolean(node.querySelector("a[href^='/r/']"));
    });
  }

  function pickFirstMeaningful(root, selectors, normalizer, minLength) {
    for (const selector of selectors) {
      const candidates = root.querySelectorAll(selector);
      for (const element of candidates) {
        const text = normalizer(element.textContent);
        if (!text || text.length < minLength) {
          continue;
        }
        return {
          text,
          element,
        };
      }
    }
    return null;
  }

  function extractExploreCard(cardNode, runtime) {
    const titleNode = pickFirstMeaningful(
      cardNode,
      TITLE_SELECTORS,
      runtime.utils.normalizeInlineText,
      2
    );

    const bodyNode = pickFirstMeaningful(
      cardNode,
      BODY_SELECTORS,
      runtime.utils.normalizeInlineText,
      20
    );

    if (!titleNode && !bodyNode) {
      return null;
    }

    return {
      id:
        cardNode.getAttribute("id") ||
        cardNode.dataset.testid ||
        (titleNode ? titleNode.text : "") ||
        "",
      title: titleNode ? titleNode.text : "",
      body: bodyNode ? bodyNode.text : "",
      titleElement: titleNode ? titleNode.element : null,
      bodyElement: bodyNode ? bodyNode.element : null,
    };
  }

  function getMetaText(slotLabel, runtime) {
    return `${slotLabel} | ${runtime.getCurrentProviderLabel()} | ${runtime.getCurrentLanguageLabel()}`;
  }

  function createContext(cardNode, extracted) {
    return {
      cardNode,
      extracted,
      sections: {
        title: null,
        body: null,
      },
      runId: 0,
      pendingSignature: "",
      renderSignature: "",
      failedSignature: "",
      retryNotBefore: 0,
    };
  }

  function createModuleController(runtime) {
    const contexts = new Set();
    const contextByNode = new WeakMap();
    let scanTimer = null;
    let observer = null;
    let unsubscribe = null;

    function cleanupDetachedContexts() {
      for (const context of Array.from(contexts)) {
        if (!context.cardNode.isConnected) {
          if (context.sections.title) {
            runtime.ui.removeSection(context.sections.title);
          }
          if (context.sections.body) {
            runtime.ui.removeSection(context.sections.body);
          }
          contexts.delete(context);
        }
      }
    }

    function ensureSection(context, slot, sourceElement) {
      if (!sourceElement || !sourceElement.parentElement) {
        if (context.sections[slot]) {
          runtime.ui.removeSection(context.sections[slot]);
        }
        context.sections[slot] = null;
        return null;
      }

      const slotLabel = slot === "title" ? "Title" : "Body";
      let section = context.sections[slot];
      if (!section) {
        section = runtime.ui.createSection(slotLabel);
        context.sections[slot] = section;
      }

      runtime.ui.attachSectionAfter(section, sourceElement);
      runtime.ui.setSectionMeta(section, getMetaText(slotLabel, runtime));
      return section;
    }

    function getContextTranslationSignature(context) {
      const settings = runtime.getSettings();
      return JSON.stringify({
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
        title: context.extracted.title,
        body: context.extracted.body,
      });
    }

    function translateContext(context) {
      if (!context.cardNode.isConnected) {
        return;
      }

      const extracted = extractExploreCard(context.cardNode, runtime);
      if (!extracted) {
        return;
      }

      context.extracted = extracted;
      const titleSection = ensureSection(context, "title", extracted.titleElement);
      const bodySection = ensureSection(context, "body", extracted.bodyElement);
      const signature = getContextTranslationSignature(context);

      if (signature === context.renderSignature || signature === context.pendingSignature) {
        return;
      }
      if (signature === context.failedSignature && Date.now() < context.retryNotBefore) {
        return;
      }

      const runId = context.runId + 1;
      context.runId = runId;
      context.pendingSignature = signature;

      const jobs = [];

      if (extracted.title && titleSection) {
        runtime.ui.setSectionLoading(titleSection, getMetaText("Title", runtime));
        jobs.push(
          runtime.translateText(extracted.title).then((result) => {
            if (context.runId !== runId) {
              return;
            }
            runtime.ui.setSectionSuccess(
              titleSection,
              getMetaText("Title", runtime),
              result.text
            );
          })
        );
      }

      if (extracted.body && bodySection) {
        runtime.ui.setSectionLoading(bodySection, getMetaText("Body", runtime));
        jobs.push(
          runtime.translateText(extracted.body).then((result) => {
            if (context.runId !== runId) {
              return;
            }
            runtime.ui.setSectionSuccess(
              bodySection,
              getMetaText("Body", runtime),
              result.text
            );
          })
        );
      }

      Promise.all(jobs)
        .then(() => {
          if (context.runId !== runId) {
            return;
          }
          context.pendingSignature = "";
          context.renderSignature = signature;
          context.failedSignature = "";
          context.retryNotBefore = 0;
        })
        .catch((error) => {
          if (context.runId !== runId) {
            return;
          }
          context.pendingSignature = "";
          context.failedSignature = signature;
          context.retryNotBefore = Date.now() + TRANSLATION_RETRY_COOLDOWN_MS;
          if (titleSection) {
            runtime.ui.setSectionError(titleSection, getMetaText("Title", runtime), error);
          }
          if (bodySection) {
            runtime.ui.setSectionError(bodySection, getMetaText("Body", runtime), error);
          }
        });
    }

    function refreshAllContexts() {
      cleanupDetachedContexts();
      for (const context of contexts) {
        context.renderSignature = "";
        context.pendingSignature = "";
        context.failedSignature = "";
        context.retryNotBefore = 0;
        translateContext(context);
      }
    }

    function scanCards() {
      cleanupDetachedContexts();

      const cards = getCardNodes(document, runtime);
      for (const cardNode of cards) {
        const extracted = extractExploreCard(cardNode, runtime);
        if (!extracted || (!extracted.title && !extracted.body)) {
          continue;
        }

        let context = contextByNode.get(cardNode);
        if (!context) {
          context = createContext(cardNode, extracted);
          contextByNode.set(cardNode, context);
          contexts.add(context);
        }

        context.extracted = extracted;
        translateContext(context);
      }
    }

    function scheduleScan() {
      if (scanTimer) {
        clearTimeout(scanTimer);
      }
      scanTimer = setTimeout(scanCards, 160);
    }

    function mount() {
      runtime.ui.ensureSettingsUi({
        title: "Modular Web Translator",
        moduleName: "Reddit Explore",
        description:
          "Translates Reddit Explore community cards and recommendation descriptions.",
      });

      scanCards();
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      unsubscribe = runtime.onSettingsChanged(() => {
        refreshAllContexts();
      });
    }

    function unmount() {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }

    return {
      mount,
      unmount,
    };
  }

  globalThis.ModularWebTranslator.registerSiteModule({
    id: "reddit-explore",
    name: "Reddit Explore",
    mount(runtime) {
      if (!document.body || !isRedditExplorePage(window.location)) {
        return;
      }

      const controller = createModuleController(runtime);
      controller.mount();
      return () => controller.unmount();
    },
  });
})();
