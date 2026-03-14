(function () {
  "use strict";

  const TRANSLATION_RETRY_COOLDOWN_MS = 15000;

  const POST_ROOT_SELECTORS = [
    "shreddit-post[view-context='CommentsPage']",
    "shreddit-post[permalink*='/comments/'][post-title]",
    "shreddit-post[content-href*='/comments/'][post-title]",
  ];

  const POST_TITLE_SELECTORS = [
    "h1",
    "a[id^='post-title-']",
    "[slot='title']",
    "a[data-testid='post-title']",
    "h2",
    "h3",
    "faceplate-screen-reader-content",
  ];

  const POST_BODY_SELECTORS = [
    "shreddit-post-text-body",
    "[slot='text-body']",
    "[data-post-click-location='text-body']",
    "div[data-click-id='text']",
    "div.md",
    "[data-testid='post-content']",
  ];

  const COMMENT_ROOT_SELECTORS = [
    "shreddit-comment[thingid]",
    "shreddit-comment",
    "[data-testid='comment']",
    "[thingid^='t1_']",
  ];

const COMMENT_BODY_SELECTORS = [
    ":scope > [slot='comment']",
    ":scope > [id$='-comment-rtjson-content']",
    ":scope > div.md[slot='comment']",
    ":scope > div.md",
    "[slot='comment']",
    "[id$='-comment-rtjson-content']",
    "div.md[slot='comment']",
  ];

  function normalizePathname(pathname) {
    const normalized = String(pathname || "/").trim() || "/";
    if (normalized === "/") {
      return normalized;
    }
    return normalized.replace(/\/+$/, "");
  }

  function stripCommentLeaf(pathname) {
    return normalizePathname(pathname).replace(/\/comment\/[^/]+$/i, "");
  }

  function isSameCommentThread(candidatePathname, currentPathname) {
    return stripCommentLeaf(candidatePathname) === stripCommentLeaf(currentPathname);
  }

  function isRedditPostDetailPage(url) {
    if (url.hostname !== "www.reddit.com") {
      return false;
    }

    return /^\/(?:r\/[^/]+\/)?comments\/[^/]+(?:\/[^/]+){0,2}\/?$/.test(url.pathname || "/");
  }

  function resolveUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, location.origin).toString();
    } catch (error) {
      return String(value);
    }
  }

  function getPostUrl(postNode) {
    return (
      resolveUrl(postNode.getAttribute("permalink")) ||
      resolveUrl(postNode.getAttribute("content-href")) ||
      resolveUrl(
        postNode.querySelector("a[href*='/comments/']")?.getAttribute("href")
      ) ||
      ""
    );
  }

  function getCommentUrl(commentNode) {
    return (
      resolveUrl(commentNode.getAttribute("permalink")) ||
      resolveUrl(commentNode.querySelector("a[href*='/comment/']")?.getAttribute("href")) ||
      ""
    );
  }

  function scorePostNode(postNode) {
    const currentPath = normalizePathname(location.pathname);
    const postUrl = getPostUrl(postNode);
    const postPath = postUrl ? normalizePathname(new URL(postUrl, location.origin).pathname) : "";
    let score = 0;

    if (postNode.hasAttribute("data-expected-lcp")) {
      score += 4;
    }
    if (postNode.getAttribute("view-context") === "CommentsPage") {
      score += 3;
    }
    if (postPath && isSameCommentThread(postPath, currentPath)) {
      score += 8;
    }

    return score;
  }

  function getPrimaryPostNodes(root, runtime) {
    const postNodes = runtime.utils.uniqueNodes(
      POST_ROOT_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll(selector)))
    );

    if (postNodes.length === 0) {
      return [];
    }

    return postNodes
      .slice()
      .sort((left, right) => scorePostNode(right) - scorePostNode(left))
      .slice(0, 1);
  }

  function getCommentNodes(root, runtime) {
    const nodes = runtime.utils.uniqueNodes(
      COMMENT_ROOT_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll(selector)))
    );

    return nodes.filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      return Boolean(
        runtime.utils.getFirstText(
          node,
          COMMENT_BODY_SELECTORS,
          runtime.utils.normalizeMultilineText
        )
      );
    });
  }

  function getPostDetailNodes(root, runtime) {
    return runtime.utils.uniqueNodes([
      ...getPrimaryPostNodes(root, runtime),
      ...getCommentNodes(root, runtime),
    ]);
  }

  function extractPost(postNode, runtime) {
    const titleFromAttribute = runtime.utils.normalizeInlineText(
      postNode.getAttribute("post-title")
    );
    const titleNode =
      titleFromAttribute
        ? {
            text: titleFromAttribute,
            element:
              postNode.querySelector("h1") ||
              postNode.querySelector("a[id^='post-title-']") ||
              postNode.querySelector("[slot='title']") ||
              postNode.querySelector("a[data-testid='post-title']") ||
              postNode,
          }
        : runtime.utils.getFirstText(postNode, POST_TITLE_SELECTORS, runtime.utils.normalizeInlineText);

    const bodyNode = runtime.utils.getFirstText(
      postNode,
      POST_BODY_SELECTORS,
      runtime.utils.normalizeMultilineText
    );

    if (!titleNode && !bodyNode) {
      return null;
    }

    return {
      id:
        postNode.getAttribute("id") ||
        postNode.getAttribute("post-id") ||
        postNode.dataset.postId ||
        getPostUrl(postNode) ||
        "",
      url: getPostUrl(postNode),
      title: titleNode ? titleNode.text : "",
      body: bodyNode ? bodyNode.text : "",
      titleElement: titleNode ? titleNode.element : null,
      bodyElement: bodyNode ? bodyNode.element : null,
    };
  }

  function extractComment(commentNode, runtime) {
    const bodyNode = runtime.utils.getFirstText(
      commentNode,
      COMMENT_BODY_SELECTORS,
      runtime.utils.normalizeMultilineText
    );

    if (!bodyNode) {
      return null;
    }

    return {
      id:
        commentNode.getAttribute("thingid") ||
        commentNode.getAttribute("id") ||
        getCommentUrl(commentNode) ||
        "",
      url: getCommentUrl(commentNode),
      title: "",
      body: bodyNode.text,
      titleElement: null,
      bodyElement: bodyNode.element,
    };
  }

  function extractPostDetailNode(node, runtime) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }

    if (node.matches("shreddit-comment, [data-testid='comment'], [thingid^='t1_']")) {
      return extractComment(node, runtime);
    }

    return extractPost(node, runtime);
  }

  function getInsertAnchor(slot, sourceElement) {
    if (!sourceElement) {
      return null;
    }

    if (slot === "title") {
      return (
        sourceElement.closest("h1") ||
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

  function createContext(node, extracted) {
    return {
      node,
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
        if (!context.node.isConnected) {
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
      if (!context.node.isConnected) {
        return;
      }

      const extracted = extractPostDetailNode(context.node, runtime);
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
      let hadFailure = false;

      if (extracted.title && titleSection) {
        runtime.ui.setSectionLoading(titleSection, getMetaText("Title", runtime));
      }
      if (extracted.body && bodySection) {
        runtime.ui.setSectionLoading(bodySection, getMetaText("Body", runtime));
      }

      const jobs = [];

      if (extracted.title && titleSection) {
        jobs.push(
          runtime
            .translateText(extracted.title)
            .then((result) => {
              if (context.runId !== runId) {
                return;
              }

              runtime.ui.setSectionSuccess(
                titleSection,
                getMetaText("Title", runtime, result.providerId),
                result.text
              );
            })
            .catch((error) => {
              if (context.runId !== runId) {
                return;
              }

              hadFailure = true;
              if (titleSection.root.dataset.state !== "ready") {
                runtime.ui.setSectionError(titleSection, getMetaText("Title", runtime), error);
              }
            })
        );
      }

      if (extracted.body && bodySection) {
        jobs.push(
          runtime
            .translateText(extracted.body)
            .then((result) => {
              if (context.runId !== runId) {
                return;
              }

              runtime.ui.setSectionSuccess(
                bodySection,
                getMetaText("Body", runtime, result.providerId),
                result.text
              );
            })
            .catch((error) => {
              if (context.runId !== runId) {
                return;
              }

              hadFailure = true;
              if (bodySection.root.dataset.state !== "ready") {
                runtime.ui.setSectionError(bodySection, getMetaText("Body", runtime), error);
              }
            })
        );
      }

      Promise.allSettled(jobs).then(() => {
        if (context.runId !== runId) {
          return;
        }

        context.pendingSignature = "";
        if (hadFailure) {
          context.failedSignature = signature;
          context.retryNotBefore = Date.now() + TRANSLATION_RETRY_COOLDOWN_MS;
          return;
        }

        context.renderSignature = signature;
        context.failedSignature = "";
        context.retryNotBefore = 0;
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

    function scanNodes() {
      cleanupDetachedContexts();

      const nodes = getPostDetailNodes(document, runtime);
      for (const node of nodes) {
        const extracted = extractPostDetailNode(node, runtime);
        if (!extracted || (!extracted.title && !extracted.body)) {
          continue;
        }

        let context = contextByNode.get(node);
        if (!context) {
          context = createContext(node, extracted);
          contextByNode.set(node, context);
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

      scanTimer = setTimeout(scanNodes, 120);
    }

    function mount() {
      runtime.ui.ensureSettingsUi({
        title: "Modular Web Translator",
        moduleName: "Reddit Post Detail",
        description:
          "Supports Reddit post pages, including post titles, post bodies, and comment threads.",
      });

      scanNodes();
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
    id: "reddit-post-detail",
    name: "Reddit Post Detail",
    mount(runtime) {
      if (!document.body || !isRedditPostDetailPage(window.location)) {
        return;
      }

      const controller = createModuleController(runtime);
      controller.mount();
      return () => controller.unmount();
    },
  });
})();
