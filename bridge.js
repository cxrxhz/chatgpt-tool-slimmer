(() => {
  'use strict';

  const STORAGE_KEY = 'toolSlimSettings';
  const MIRROR_KEY = 'cgpt_tool_slim_settings_v1';
  const BRIDGE_SOURCE = 'chatgpt-tool-slimmer-bridge';
  const MAIN_SOURCE = 'chatgpt-tool-slimmer-main';
  const DEFAULTS = {
    enabled: true,
    realtimeEnabled: true,
    mode: 'safe',
    protectRecentTurns: 2,
    maxVisibleToolCards: 20,
    hideOldReasoning: false
  };

  const dom = globalThis.ChatGPTToolSlimDom;
  let currentSettings = { ...DEFAULTS };
  let domObserver = null;
  let domSweepPending = false;
  let domSweepTimer = null;
  let lastDomSweepAt = 0;
  const DOM_SWEEP_MIN_INTERVAL_MS = 800;
  let trackedConversation = '';
  let recentUserIds = [];
  let assistantIdsByUser = new Map();

  function normalize(value) {
    const src = value && typeof value === 'object' ? value : {};
    const legacyMode = String(src.mode || '');
    return {
      enabled: typeof src.enabled === 'boolean'
        ? src.enabled
        : !['off', 'observe'].includes(legacyMode),
      realtimeEnabled: src.realtimeEnabled !== false,
      mode: legacyMode === 'compact' ? 'compact' : DEFAULTS.mode,
      protectRecentTurns: Math.max(0, Math.min(10, Math.floor(Number(src.protectRecentTurns ?? DEFAULTS.protectRecentTurns)))),
      maxVisibleToolCards: Math.max(1, Math.min(200, Math.floor(Number(src.maxVisibleToolCards ?? DEFAULTS.maxVisibleToolCards)))),
      hideOldReasoning: src.hideOldReasoning === true
    };
  }

  function conversationKey() {
    const match = location.pathname.match(/^\/c\/([^/?#]+)/);
    return match ? match[1] : location.pathname;
  }

  function resetTrackerForNavigation() {
    const key = conversationKey();
    if (key === trackedConversation) return;
    trackedConversation = key;
    recentUserIds = [];
    assistantIdsByUser = new Map();
  }

  function userSectionId(section) {
    return section.querySelector('[data-message-id]')?.getAttribute('data-message-id')
      || section.getAttribute('data-turn-id')
      || null;
  }

  function seedRecentUsersFromResponse(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    recentUserIds = ids.map(String).filter(Boolean).slice(-10);
  }

  function refreshRecentUsersFromDom() {
    resetTrackerForNavigation();
    const mountedIds = Array.from(document.querySelectorAll('section[data-turn="user"]'))
      .map(userSectionId)
      .filter(Boolean);
    if (mountedIds.length > 0) {
      if (recentUserIds.length === 0) {
        recentUserIds = mountedIds.slice(-10);
      } else {
        // Only extend the tracker with users that appear AFTER the newest known
        // real tail user. Unknown users mounted before it are historical pages and
        // must never become "recent" just because the user scrolled upward.
        let anchorIndex = -1;
        for (let i = recentUserIds.length - 1; i >= 0 && anchorIndex < 0; i -= 1) {
          anchorIndex = mountedIds.indexOf(recentUserIds[i]);
        }
        if (anchorIndex >= 0) {
          for (const id of mountedIds.slice(anchorIndex + 1)) {
            if (!recentUserIds.includes(id)) recentUserIds.push(id);
          }
          if (recentUserIds.length > 10) recentUserIds = recentUserIds.slice(-10);
        }
      }
    }

    // Remember assistant turn containers that belong to the tracked recent
    // user turns. These IDs let us classify a tool card even if the matching
    // user section is later virtualized out of the DOM.
    let currentUserId = null;
    for (const section of document.querySelectorAll('section[data-turn]')) {
      if (section.getAttribute('data-turn') === 'user') {
        currentUserId = userSectionId(section);
        continue;
      }
      if (section.getAttribute('data-turn') !== 'assistant') continue;
      if (!currentUserId || !recentUserIds.includes(currentUserId)) continue;
      const assistantId = section.getAttribute('data-turn-id');
      if (!assistantId) continue;
      const ids = assistantIdsByUser.get(currentUserId) || [];
      if (!ids.includes(assistantId)) ids.push(assistantId);
      assistantIdsByUser.set(currentUserId, ids.slice(-3));
    }
    for (const userId of [...assistantIdsByUser.keys()]) {
      if (!recentUserIds.includes(userId)) assistantIdsByUser.delete(userId);
    }
  }

  function runDomSweep() {
    domSweepPending = false;
    domSweepTimer = null;
    if (!dom || !currentSettings.enabled || !currentSettings.realtimeEnabled) return;
    lastDomSweepAt = Date.now();
    refreshRecentUsersFromDom();
    const protectedUsers = currentSettings.protectRecentTurns > 0
      ? recentUserIds.slice(-currentSettings.protectRecentTurns)
      : [];
    const recentAssistantIds = protectedUsers.flatMap((userId) => assistantIdsByUser.get(userId) || []);
    dom.apply(document, currentSettings, { recentUserIds, recentAssistantIds });
  }

  function scheduleDomSweep() {
    if (!dom || domSweepPending || !currentSettings.enabled || !currentSettings.realtimeEnabled) return;
    domSweepPending = true;
    const earliest = lastDomSweepAt + DOM_SWEEP_MIN_INTERVAL_MS;
    const delay = Math.max(0, earliest - Date.now());
    domSweepTimer = setTimeout(() => {
      const invoke = () => runDomSweep();
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(invoke, { timeout: 500 });
      } else {
        invoke();
      }
    }, delay);
  }

  function nodeTouchesConversation(node) {
    if (!(node instanceof Element)) return false;
    const anchors = dom?.TOOL_ANCHOR_SELECTOR || '[data-testid="cot-v5-tool-icon-pile"]';
    if (node.matches?.(`section[data-turn], ${anchors}`)) return true;
    // Do not treat every element appended while an assistant is streaming as
    // relevant. Only a newly mounted turn or a subtree that actually contains
    // a tool-card marker should schedule a sweep.
    return Boolean(node.querySelector?.(`section[data-turn], ${anchors}`));
  }

  function startDomObserver() {
    if (!dom || domObserver || !document.documentElement || !currentSettings.enabled || !currentSettings.realtimeEnabled) return;
    domObserver = new MutationObserver((mutations) => {
      if (!currentSettings.enabled || !currentSettings.realtimeEnabled) return;
      let relevant = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (nodeTouchesConversation(node)) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (!relevant) return;
      scheduleDomSweep('conversation-mutation');
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
    scheduleDomSweep('observer-start');
  }

  function stopDomObserver({ restore = true } = {}) {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (domSweepTimer !== null) {
      clearTimeout(domSweepTimer);
      domSweepTimer = null;
    }
    domSweepPending = false;
    if (restore && dom && document.documentElement) dom.restoreAll(document);
  }

  function syncRealtimeMode() {
    if (!currentSettings.enabled || !currentSettings.realtimeEnabled) {
      stopDomObserver({ restore: true });
      return;
    }
    if (document.documentElement) {
      startDomObserver();
      scheduleDomSweep('settings-updated');
    }
  }

  function pushSettings(settings) {
    const clean = normalize(settings);
    currentSettings = clean;
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(clean)); } catch {}
    try {
      window.postMessage({
        source: BRIDGE_SOURCE,
        type: 'CGPT_TOOL_SLIM_SETTINGS',
        payload: clean
      }, '*');
    } catch {}
    syncRealtimeMode();
  }

  async function syncFromStorage() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const stored = data[STORAGE_KEY] || null;
      const settings = normalize(stored || DEFAULTS);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(settings)) {
        await chrome.storage.local.set({ [STORAGE_KEY]: settings });
      }
      pushSettings(settings);
    } catch {
      pushSettings(DEFAULTS);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    pushSettings(changes[STORAGE_KEY].newValue || DEFAULTS);
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_SOURCE || data.type !== 'CGPT_TOOL_SLIM_STATE') return;
    resetTrackerForNavigation();
    const lastResponse = data.payload;
    if (lastResponse && lastResponse.historicalPage === false) {
      seedRecentUsersFromResponse(lastResponse.recentUserMessageIds);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CGPT_TOOL_SLIM_SYNC') return false;
    syncFromStorage().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  });

  syncFromStorage().finally(() => {
    if (document.documentElement) syncRealtimeMode();
    else document.addEventListener('DOMContentLoaded', syncRealtimeMode, { once: true });
  });
})();
