(function () {
  "use strict";

  const TRANSLATION_RETRY_COOLDOWN_MS = 15000;

  const POST_SELECTORS = [
    "shreddit-post",
    "article[data-testid='post-container']",
    "[data-testid='post-container']",
  ];

  const TITLE_SELECTORS = [
    "a[id^='post-title-']",
    "[slot='title']",
    "a[data-testid='post-title']",
    "h3",
    "faceplate-screen-reader-content",
  ];

  const BODY_SELECTORS = [
    "shreddit-post-text-body",
    "[slot='text-body']",
    "[data-post-click-location='text-body']",
    "div[data-click-id='text']",
    "div.md",
    "[data-testid='post-content']",
  ];

  const EXCLUDED_FEED_PREFIXES = [
    "/explore",
    "/settings",
    "/message",
    "/topics",
    "/media",
    "/notifications",
    "/login",
    "/register",
    "/premium",
    "/submit",
    "/chat",
  ];

  function isRedditFeedPage(url) {
    if (url.hostname !== "www.reddit.com") {
      return false;
    }

    const pathname = url.pathname || "/";
    if (EXCLUDED_FEED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return false;
    }

    return (
      pathname === "/" ||
      pathname === "/new" ||
      pathname === "/new/" ||
      pathname.startsWith("/new/") ||
      pathname === "/r/popular" ||
      pathname === "/r/popular/" ||
      /^\/r\/[^/]+\/?$/.test(pathname) ||
      /^\/r\/[^/]+\/(hot|new|top|rising|controversial)\/?$/.test(pathname)
    );
  }

  function getPostNodes(root, runtime) {
    const nodes = [];
    for (const selector of POST_SELECTORS) {
      nodes.push(...root.querySelectorAll(selector));
    }
    return runtime.utils.uniqueNodes(nodes);
  }

  function getPostId(postNode) {
    return (
      postNode.getAttribute("id") ||
      postNode.getAttribute("post-id") ||
      postNode.dataset.postId ||
      ""
    );
  }

  function getPostUrl(postNode) {
    const permalink = postNode.getAttribute("permalink");
    if (permalink) {
      try {
        return new URL(permalink, location.origin).toString();
      } catch (error) {
        return permalink;
      }
    }

    const link =
      postNode.querySelector("a[href*='/comments/']") ||
      postNode.querySelector("a[id^='post-title-']") ||
      postNode.querySelector("a[data-testid='post-title']") ||
      postNode.querySelector("a[href]");

    if (!link) {
      return "";
    }

    try {
      return new URL(link.getAttribute("href"), location.origin).toString();
    } catch (error) {
      return link.getAttribute("href") || "";
    }
  }

  function extractRedditPost(postNode, runtime) {
    const titleFromAttribute = runtime.utils.normalizeInlineText(
      postNode.getAttribute("post-title")
    );
    const titleNode =
      titleFromAttribute
        ? {
            text: titleFromAttribute,
            element:
              postNode.querySelector("a[id^='post-title-']") ||
              postNode.querySelector("[slot='title']") ||
              postNode.querySelector("a[data-testid='post-title']") ||
              postNode,
          }
        : runtime.utils.getFirstText(postNode, TITLE_SELECTORS, runtime.utils.normalizeInlineText);

    const bodyNode = runtime.utils.getFirstText(
      postNode,
      BODY_SELECTORS,
      runtime.utils.normalizeMultilineText
    );

    if (!titleNode && !bodyNode) {
      return null;
    }

    return {
      id: getPostId(postNode),
      url: getPostUrl(postNode),
      title: titleNode ? titleNode.text : "",
      body: bodyNode ? bodyNode.text : "",
      titleElement: titleNode ? titleNode.element : null,
      bodyElement: bodyNode ? bodyNode.element : null,
    };
  }

  function getInsertAnchor(slot, sourceElement) {
    if (!sourceElement) {
      return null;
    }

    if (slot === "title") {
      return (
        sourceElement.closest("a[id^='post-title-']") ||
        sourceElement.closest("a[data-testid='post-title']") ||
        sourceElement.closest("a[href*='/comments/']") ||
        sourceElement
      );
    }

    return sourceElement;
  }

  function getMetaText(slotLabel, runtime, providerId) {
    const providerLabel = providerId
      ? runtime.getProviderLabel(providerId)
      : runtime.getCurrentProviderLabel();
    return `${slotLabel} | ${providerLabel} | ${runtime.getCurrentLanguageLabel()}`;
  }

  function createContext(postNode, extracted) {
    return {
      postNode,
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
    let lastSettings = runtime.getSettings();

    function cleanupDetachedContexts() {
      for (const context of Array.from(contexts)) {
        if (!context.postNode.isConnected) {
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
      if (!sourceElement) {
        if (context.sections[slot]) {
          runtime.ui.removeSection(context.sections[slot]);
        }
        context.sections[slot] = null;
        return null;
      }

      const anchor = getInsertAnchor(slot, sourceElement);
      if (!anchor || !anchor.parentElement) {
        return null;
      }

      const slotLabel = slot === "title" ? "Title" : "Body";
      let section = context.sections[slot];
      if (!section) {
        section = runtime.ui.createSection(slotLabel);
        context.sections[slot] = section;
      }

      runtime.ui.attachSectionAfter(section, anchor);
      runtime.ui.setSectionMeta(section, getMetaText(slotLabel, runtime));
      return section;
    }

    function getContextTranslationSignature(context) {
      const settings = runtime.getSettings();
      return JSON.stringify({
        targetLanguage: settings.targetLanguage,
        title: context.extracted.title,
        body: context.extracted.body,
      });
    }

    function translateContext(context) {
      if (!context.postNode.isConnected) {
        return;
      }

      const extracted = extractRedditPost(context.postNode, runtime);
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

      if (extracted.title && titleSection) {
        runtime.ui.setSectionLoading(titleSection, getMetaText("Title", runtime));
      }

      if (extracted.body && bodySection) {
        runtime.ui.setSectionLoading(bodySection, getMetaText("Body", runtime));
      }

      const jobs = [];

      if (extracted.title && titleSection) {
        jobs.push(
          runtime.translateText(extracted.title).then((result) => {
            if (context.runId !== runId) {
              return;
            }

            runtime.ui.setSectionSuccess(
              titleSection,
              getMetaText("Title", runtime, result.providerId),
              result.text
            );
          })
        );
      }

      if (extracted.body && bodySection) {
        jobs.push(
          runtime.translateText(extracted.body).then((result) => {
            if (context.runId !== runId) {
              return;
            }

            runtime.ui.setSectionSuccess(
              bodySection,
              getMetaText("Body", runtime, result.providerId),
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
          if (extracted.title && titleSection) {
            runtime.ui.setSectionError(
              titleSection,
              getMetaText("Title", runtime),
              error
            );
          }
          if (extracted.body && bodySection) {
            runtime.ui.setSectionError(bodySection, getMetaText("Body", runtime), error);
          }
        });
    }

    function refreshAllContexts(reason) {
      cleanupDetachedContexts();
      for (const context of contexts) {
        if (reason === "provider") {
          if (!context.renderSignature || context.failedSignature) {
            context.pendingSignature = "";
            context.failedSignature = "";
            context.retryNotBefore = 0;
            translateContext(context);
          }
          continue;
        }

        context.renderSignature = "";
        context.pendingSignature = "";
        context.failedSignature = "";
        context.retryNotBefore = 0;
        translateContext(context);
      }
    }

    function scanPosts() {
      cleanupDetachedContexts();

      const posts = getPostNodes(document, runtime);
      for (const postNode of posts) {
        const extracted = extractRedditPost(postNode, runtime);
        if (!extracted || (!extracted.title && !extracted.body)) {
          continue;
        }

        let context = contextByNode.get(postNode);
        if (!context) {
          context = createContext(postNode, extracted);
          contextByNode.set(postNode, context);
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

      scanTimer = setTimeout(scanPosts, 120);
    }

    function mount() {
      runtime.ui.ensureSettingsUi({
        title: "Modular Web Translator",
        moduleName: "Reddit Feed",
        description:
          "Supports Reddit home, /new, /r/popular, and subreddit feed pages.",
      });

      scanPosts();
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      unsubscribe = runtime.onSettingsChanged((nextSettings) => {
        const reason =
          nextSettings.targetLanguage !== lastSettings.targetLanguage ? "language" : "provider";
        lastSettings = nextSettings;
        refreshAllContexts(reason);
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
    id: "reddit-feed",
    name: "Reddit Feed",
    mount(runtime) {
      if (!document.body || !isRedditFeedPage(window.location)) {
        return;
      }

      const controller = createModuleController(runtime);
      controller.mount();
      return () => controller.unmount();
    },
  });
})();
