(() => {
  'use strict';

  if (globalThis.ChatGPTToolSlimDom) return;

  const HIDDEN_ATTR = 'data-cgpt-tool-slim-hidden';
  const UNLOADED_ATTR = 'data-cgpt-tool-slim-unloaded';
  const ORIGINAL_SRC_ATTR = 'data-cgpt-tool-slim-original-src';
  const STYLE_ID = 'cgpt-tool-slim-dom-style';
  const TURN_SELECTOR = 'section[data-turn][data-testid^="conversation-turn"]';
  const TOOL_IFRAME_SELECTOR = 'iframe[title^="ui://"], iframe[src*=".web-sandbox.oaiusercontent.com"]';
  const TOOL_SUMMARY_SELECTOR = 'span[class~="group/tool-message"], button[aria-label="打开工具调用列表"]';
  // Intentionally exclude [data-testid="cot-v5-tool-icon-pile"]. ChatGPT also
  // uses that component in the agent/task progress timeline, so treating it as
  // a tool-card anchor would hide completed/running progress rows.
  const TOOL_ANCHOR_SELECTOR = `${TOOL_IFRAME_SELECTOR}, ${TOOL_SUMMARY_SELECTOR}`;

  function normalizeSettings(value) {
    const src = value && typeof value === 'object' ? value : {};
    const legacyMode = String(src.mode || '');
    return {
      enabled: typeof src.enabled === 'boolean'
        ? src.enabled
        : !['off', 'observe'].includes(legacyMode),
      realtimeEnabled: src.realtimeEnabled !== false,
      mode: legacyMode === 'compact' ? 'compact' : 'safe',
      protectRecentTurns: Math.max(0, Math.min(10, Math.floor(Number(src.protectRecentTurns ?? 2)))),
      maxVisibleToolCards: Math.max(1, Math.min(200, Math.floor(Number(src.maxVisibleToolCards ?? 20))))
    };
  }

  function ensureStyle(doc = document) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-cgpt-tool-slim-dom-version', '1.0.2');
    style.textContent = `[${HIDDEN_ATTR}="1"]{display:none!important}`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function resolveSandboxToolCardTarget(anchor) {
    if (!(anchor instanceof Element)) return null;
    const section = anchor.closest('section[data-turn="assistant"]');
    if (!section) return null;

    // 2026-09 connector/App tool UI observed on the live ChatGPT page:
    //
    //   div.contents                 <- exactly one tool card/message
    //     span.group/tool-message    <- optional "已调用工具"
    //     div                        <- tool name / CSP status
    //     div > ... > iframe ui://   <- sandbox app
    //     div                        <- separator
    //
    // The NEXT ancestor above this div.contents is the assistant turn's
    // flex/grow message stream. Never climb past the nearest contents node.
    let node = anchor;
    for (let depth = 0; depth < 6 && node && node !== section; depth += 1, node = node.parentElement) {
      if (
        node instanceof HTMLDivElement &&
        node.classList.contains('contents') &&
        section.contains(node)
      ) {
        const hasSandbox = Boolean(node.querySelector(TOOL_IFRAME_SELECTOR));
        const hasSummary = Boolean(node.querySelector(TOOL_SUMMARY_SELECTOR));
        const hasToolHeader = Boolean(node.querySelector('button[aria-label*="CSP"], [role="button"] button'));
        if (hasSandbox || (hasSummary && hasToolHeader)) return node;
      }
    }

    // A standalone compact "已调用工具" chip can exist without an app iframe.
    // Hide only the chip itself; do not guess a larger wrapper.
    const summary = anchor.matches(TOOL_SUMMARY_SELECTOR)
      ? anchor.closest('span[class~="group/tool-message"]') || anchor
      : null;
    if (summary && section.contains(summary)) return summary;
    return null;
  }

  function resolveToolCardTarget(anchor) {
    if (!(anchor instanceof Element)) return null;
    if (anchor.matches(TOOL_IFRAME_SELECTOR) || anchor.matches(TOOL_SUMMARY_SELECTOR)) {
      return resolveSandboxToolCardTarget(anchor);
    }
    return null;
  }

  function collectCards(root = document) {
    const sections = Array.from(root.querySelectorAll(TURN_SELECTOR));
    const sectionIndex = new Map(sections.map((section, index) => [section, index]));
    const cards = [];
    const seenTargets = new Set();
    let rejected = 0;

    let currentUserId = null;
    const userIdBySection = new Map();
    for (const section of sections) {
      if (section.getAttribute('data-turn') === 'user') {
        currentUserId = section.querySelector('[data-message-id]')?.getAttribute('data-message-id')
          || section.getAttribute('data-turn-id')
          || null;
      }
      userIdBySection.set(section, currentUserId);
    }

    for (const anchor of root.querySelectorAll(TOOL_ANCHOR_SELECTOR)) {
      const section = anchor.closest('section[data-turn="assistant"]');
      const target = resolveToolCardTarget(anchor);
      if (!section || !target || !sectionIndex.has(section)) {
        rejected += 1;
        continue;
      }
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      cards.push({
        anchor,
        target,
        section,
        sectionIndex: sectionIndex.get(section),
        userTurnId: userIdBySection.get(section) || null,
        assistantTurnId: section.getAttribute('data-turn-id') || null
      });
    }

    return { sections, cards, rejected };
  }

  function iframeCandidates(target) {
    const frames = [];
    if (target instanceof HTMLIFrameElement) frames.push(target);
    for (const frame of target.querySelectorAll?.(TOOL_IFRAME_SELECTOR) || []) frames.push(frame);
    return frames;
  }

  function unloadToolFrames(target) {
    let unloaded = 0;
    for (const frame of iframeCandidates(target)) {
      if (frame.getAttribute(UNLOADED_ATTR) === '1') continue;

      // srcdoc can contain the whole app document. Keeping a second copy merely
      // to make realtime mode reversible defeats the memory-saving purpose, so
      // leave srcdoc-backed frames alone. ChatGPT connector/app sandboxes use a
      // normal src URL in the live UI we target here.
      if (frame.hasAttribute('srcdoc')) continue;
      const src = frame.getAttribute('src');
      if (!src || src === 'about:blank') continue;

      frame.setAttribute(ORIGINAL_SRC_ATTR, src);
      frame.setAttribute(UNLOADED_ATTR, '1');
      // Navigating the frame to about:blank destroys its remote browsing
      // context while keeping the React-owned iframe element in place.
      frame.setAttribute('src', 'about:blank');
      unloaded += 1;
    }
    return unloaded;
  }

  function restoreToolFrames(target) {
    let restored = 0;
    for (const frame of iframeCandidates(target)) {
      if (frame.getAttribute(UNLOADED_ATTR) !== '1') continue;
      const src = frame.getAttribute(ORIGINAL_SRC_ATTR);
      if (src) frame.setAttribute('src', src);
      frame.removeAttribute(ORIGINAL_SRC_ATTR);
      frame.removeAttribute(UNLOADED_ATTR);
      restored += 1;
    }
    return restored;
  }

  function restoreAll(root = document) {
    let restored = 0;
    for (const element of root.querySelectorAll(`[${HIDDEN_ATTR}="1"]`)) {
      restoreToolFrames(element);
      element.removeAttribute(HIDDEN_ATTR);
      restored += 1;
    }
    return restored;
  }

  function plan(root = document, rawSettings = {}, context = {}) {
    const settings = normalizeSettings(rawSettings);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { sections, cards, rejected } = collectCards(root);
    const userIndexes = [];
    for (let i = 0; i < sections.length; i += 1) {
      if (sections[i].getAttribute('data-turn') === 'user') userIndexes.push(i);
    }

    const contextRecentUserIds = Array.isArray(context?.recentUserIds)
      ? context.recentUserIds.map(String).filter(Boolean).slice(-10)
      : [];
    const contextRecentAssistantIds = Array.isArray(context?.recentAssistantIds)
      ? context.recentAssistantIds.map(String).filter(Boolean).slice(-10)
      : [];

    // A partial virtualized fragment with no mounted user turn is only
    // ambiguous when we also lack the tail identities captured earlier.
    if (userIndexes.length === 0 && contextRecentUserIds.length === 0 && contextRecentAssistantIds.length === 0) {
      return {
        settings,
        failOpen: true,
        sections,
        cards,
        rejected,
        keep: new Set(cards.map((card) => card.target)),
        hide: new Set(),
        cutoffIndex: 0,
        elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
      };
    }

    let cutoffIndex = Number.POSITIVE_INFINITY;
    const knownRecentUserIds = contextRecentUserIds;
    const recentUserSet = new Set(
      settings.protectRecentTurns > 0
        ? knownRecentUserIds.slice(-settings.protectRecentTurns)
        : []
    );
    const recentAssistantSet = new Set(contextRecentAssistantIds);

    let withinTurnWindow;
    if (recentUserSet.size > 0 || recentAssistantSet.size > 0) {
      // Preferred path: identities captured while the real conversation tail
      // was mounted. This survives scrolling far enough upward that ChatGPT
      // virtualizes the newest turns out of the DOM.
      withinTurnWindow = cards.filter((card) =>
        (card.userTurnId && recentUserSet.has(String(card.userTurnId)))
        || (card.assistantTurnId && recentAssistantSet.has(String(card.assistantTurnId)))
      );
    } else {
      if (settings.protectRecentTurns > 0) {
        cutoffIndex = userIndexes[Math.max(0, userIndexes.length - settings.protectRecentTurns)];
      }
      withinTurnWindow = cards.filter((card) =>
        settings.protectRecentTurns > 0 && card.sectionIndex >= cutoffIndex
      );
    }
    const keptByBudget = new Set(
      withinTurnWindow
        .slice(Math.max(0, withinTurnWindow.length - settings.maxVisibleToolCards))
        .map((card) => card.target)
    );
    const hide = new Set();
    const keep = new Set();
    for (const card of cards) {
      if (keptByBudget.has(card.target)) keep.add(card.target);
      else hide.add(card.target);
    }

    return {
      settings,
      failOpen: false,
      sections,
      cards,
      rejected,
      keep,
      hide,
      cutoffIndex,
      usedRecentUserIds: recentUserSet.size > 0,
      usedRecentAssistantIds: recentAssistantSet.size > 0,
      withinTurnWindow: withinTurnWindow.length,
      overflowByCount: Math.max(0, withinTurnWindow.length - settings.maxVisibleToolCards),
      elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
    };
  }

  function apply(root = document, rawSettings = {}, context = {}) {
    const settings = normalizeSettings(rawSettings);
    ensureStyle(root.ownerDocument || root);

    if (!settings.enabled || !settings.realtimeEnabled) {
      const restored = restoreAll(root);
      return {
        mode: settings.mode,
        restored,
        cardsSeen: 0,
        cardsHidden: 0,
        cardsKept: 0,
        overflowByCount: 0,
        rejected: 0,
        elapsedMs: 0,
        failOpen: false
      };
    }

    const result = plan(root, settings, context);
    if (result.failOpen) {
      return {
        mode: settings.mode,
        restored: 0,
        cardsSeen: result.cards.length,
        cardsHidden: 0,
        cardsKept: result.cards.length,
        overflowByCount: 0,
        rejected: result.rejected,
        elapsedMs: result.elapsedMs,
        failOpen: true
      };
    }

    let hiddenNow = 0;
    let restored = 0;
    let framesUnloaded = 0;
    let framesRestored = 0;
    for (const target of result.hide) {
      // Run even for targets already hidden: React may have recreated an iframe
      // inside a hidden wrapper since the previous sweep.
      framesUnloaded += unloadToolFrames(target);
      if (target.getAttribute(HIDDEN_ATTR) !== '1') {
        target.setAttribute(HIDDEN_ATTR, '1');
        hiddenNow += 1;
      }
    }
    for (const target of result.keep) {
      if (target.getAttribute(HIDDEN_ATTR) === '1') {
        framesRestored += restoreToolFrames(target);
        target.removeAttribute(HIDDEN_ATTR);
        restored += 1;
      }
    }

    return {
      mode: settings.mode,
      restored,
      hiddenNow,
      framesUnloaded,
      framesRestored,
      cardsSeen: result.cards.length,
      cardsHidden: result.hide.size,
      cardsKept: result.keep.size,
      withinTurnWindow: result.withinTurnWindow,
      overflowByCount: result.overflowByCount,
      rejected: result.rejected,
      elapsedMs: result.elapsedMs,
      failOpen: false
    };
  }

  globalThis.ChatGPTToolSlimDom = Object.freeze({
    HIDDEN_ATTR,
    UNLOADED_ATTR,
    ORIGINAL_SRC_ATTR,
    TURN_SELECTOR,
    TOOL_IFRAME_SELECTOR,
    TOOL_SUMMARY_SELECTOR,
    TOOL_ANCHOR_SELECTOR,
    normalizeSettings,
    resolveSandboxToolCardTarget,
    resolveToolCardTarget,
    collectCards,
    unloadToolFrames,
    restoreToolFrames,
    restoreAll,
    plan,
    apply
  });
})();
