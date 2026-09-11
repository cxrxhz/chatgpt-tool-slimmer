(() => {
  'use strict';

  if (globalThis.ChatGPTToolSlimCore) return;

  const DEFAULTS = Object.freeze({
    enabled: true,
    realtimeEnabled: true,
    mode: 'safe',
    protectRecentTurns: 2,
    maxVisibleToolCards: 20,
    hideOldReasoning: false
  });

  const PAGINATION_KEYS = Object.freeze([
    'cursor',
    'before',
    'after',
    'starting_after',
    'ending_before',
    'page'
  ]);

  // These fields are not needed to preserve message identity / turn linkage, but
  // can be very large in tool-heavy ChatGPT conversations.
  const HEAVY_METADATA_KEYS = Object.freeze(new Set([
    'search_result_groups',
    'inline_cot_expandable_content',
    'content_references',
    'citations',
    'safe_urls',
    'story_events',
    'tool_icons',
    'connector_tool_payload',
    'chatgpt_sdk',
    'reasoning_titles',
    'reasoning_title_content_transition',
    'debug_sonic_thread_id',
    'image_results',
    'image_gen_metadata',
    'image_gen_title',
    'image_gen_caption'
  ]));

  function normalizeSettings(value) {
    const src = value && typeof value === 'object' ? value : {};
    const legacyMode = String(src.mode || '');
    const enabled = typeof src.enabled === 'boolean'
      ? src.enabled
      : !['off', 'observe'].includes(legacyMode);
    const mode = legacyMode === 'compact' ? 'compact' : DEFAULTS.mode;
    const protectRecentTurns = Math.max(
      0,
      Math.min(10, Number.isFinite(Number(src.protectRecentTurns)) ? Math.floor(Number(src.protectRecentTurns)) : DEFAULTS.protectRecentTurns)
    );
    const maxVisibleToolCards = Math.max(
      1,
      Math.min(200, Number.isFinite(Number(src.maxVisibleToolCards)) ? Math.floor(Number(src.maxVisibleToolCards)) : DEFAULTS.maxVisibleToolCards)
    );
    return {
      enabled,
      realtimeEnabled: src.realtimeEnabled !== false,
      mode,
      protectRecentTurns,
      maxVisibleToolCards,
      hideOldReasoning: src.hideOldReasoning === true
    };
  }

  function parseUrl(input) {
    try {
      return new URL(String(input || ''), 'https://chatgpt.com/');
    } catch {
      return null;
    }
  }

  function isConversationDetailRequest(inputUrl, method = 'GET') {
    if (String(method || 'GET').toUpperCase() !== 'GET') return false;
    const url = parseUrl(inputUrl);
    if (!url) return false;
    // Current (2026-09) web route. Intentionally NOT the conversation list and
    // NOT the singular POST /backend-api/conversation send/stream route.
    return /^\/backend-api\/conversations\/[^/]+$/i.test(url.pathname);
  }

  function isHistoricalPageRequest(inputUrl) {
    const url = parseUrl(inputUrl);
    if (!url) return false;
    return PAGINATION_KEYS.some((key) => url.searchParams.has(key));
  }

  function metadataOf(message) {
    return message && typeof message.metadata === 'object' && message.metadata
      ? message.metadata
      : {};
  }

  function authorOf(message) {
    return message && typeof message.author === 'object' && message.author
      ? message.author
      : {};
  }

  function contentOf(message) {
    return message && typeof message.content === 'object' && message.content
      ? message.content
      : {};
  }

  function turnKey(message) {
    const md = metadataOf(message);
    const value = md.working_turn_id || md.turn_exchange_id || md.turn_id || null;
    return value == null ? null : String(value);
  }

  function roleOf(message) {
    return String(authorOf(message).role || '').toLowerCase();
  }

  function recipientOf(message) {
    return String(message?.recipient || '').trim();
  }

  function contentTypeOf(message) {
    return String(contentOf(message).content_type || '').toLowerCase();
  }

  function isToolInvocationMessage(message) {
    const role = roleOf(message);
    const recipient = recipientOf(message);
    return role === 'assistant' && recipient && recipient !== 'all' && recipient !== 'none';
  }

  function isToolUiMessage(message) {
    const role = roleOf(message);
    const authorName = String(authorOf(message).name || '');
    const recipient = recipientOf(message);
    const md = metadataOf(message);
    const contentType = contentTypeOf(message);

    if (role === 'tool') return true;
    if (authorName.startsWith('ui://')) return true;

    // Current ChatGPT represents tool invocations as assistant/code messages
    // whose recipient is the tool (web.run, api_tool.*, python, etc.).
    if (isToolInvocationMessage(message)) return true;

    if (md.connector_tool_payload != null) return true;

    // Defensive coverage for tool result content types seen in exports / older
    // variants. Role=tool already catches the current 2026 web-search shape.
    if ([
      'execution_output',
      'computer_output',
      'tether_browsing_display',
      'tether_quote'
    ].includes(contentType) && role !== 'user') return true;

    return false;
  }

  function isReasoningUiMessage(message) {
    if (roleOf(message) !== 'assistant') return false;
    const contentType = contentTypeOf(message);
    return contentType === 'thoughts' || contentType === 'reasoning_recap';
  }

  function buildToolCardGroups(messages) {
    const groups = [];
    const messageToGroup = new Map();
    const messageIdToGroup = new Map();
    const activeByTurn = new Map();

    function createGroup(message, index, keyHint) {
      const key = keyHint || `tool-card-${groups.length}-${String(message?.id || index)}`;
      const group = {
        key,
        turnKey: turnKey(message),
        indexes: [index]
      };
      groups.push(group);
      messageToGroup.set(index, group);
      if (message?.id) messageIdToGroup.set(String(message.id), group);
      if (group.turnKey) activeByTurn.set(group.turnKey, group);
      return group;
    }

    function attachToGroup(group, message, index) {
      group.indexes.push(index);
      messageToGroup.set(index, group);
      if (message?.id) messageIdToGroup.set(String(message.id), group);
    }

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (!isToolUiMessage(message)) continue;

      const role = roleOf(message);
      const recipient = recipientOf(message);
      const key = turnKey(message);
      const isInvocation = isToolInvocationMessage(message);

      if (isInvocation) {
        createGroup(message, i, `call:${String(message?.id || `${key || 'turn'}:${i}`)}`);
        continue;
      }

      // Current ChatGPT usually emits one assistant -> tool invocation followed
      // by one or more role=tool result messages carrying the same working turn.
      // Treat that sequence as one visible tool card rather than counting every
      // protocol message as a separate card.
      const parentId = metadataOf(message).parent_id;
      const byParent = parentId ? messageIdToGroup.get(String(parentId)) : null;
      const active = byParent || (key ? activeByTurn.get(key) : null);
      if (active) {
        attachToGroup(active, message, i);
      } else {
        createGroup(message, i, `orphan:${String(message?.id || `${key || 'turn'}:${i}`)}`);
      }
    }

    return { groups, messageToGroup };
  }

  function isBudgetedToolGroup(group, messages) {
    return group.indexes.some((index) => {
      const message = messages[index];
      return isToolUiMessage(message) && !isToolInvocationMessage(message);
    });
  }

  function jsonByteLength(value) {
    try {
      const text = JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      return text.length;
    } catch {
      return 0;
    }
  }

  function computeProtection(messages, protectRecentTurns, historicalPage) {
    if (historicalPage || protectRecentTurns <= 0) {
      return { protectAll: false, protectedKeys: new Set(), cutoffIndex: messages.length + 1 };
    }

    const userIndexes = [];
    const keyedUsers = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (roleOf(messages[i]) !== 'user') continue;
      userIndexes.push(i);
      const key = turnKey(messages[i]);
      if (key) keyedUsers.push({ index: i, key });
    }

    // A non-pagination response with no visible user turn can be an unusual
    // fragment/bootstrap shape. Fail open rather than hide something important.
    if (userIndexes.length === 0) {
      return { protectAll: true, protectedKeys: new Set(), cutoffIndex: 0 };
    }

    const firstProtectedUser = userIndexes[Math.max(0, userIndexes.length - protectRecentTurns)];
    const protectedKeys = new Set(
      keyedUsers.slice(Math.max(0, keyedUsers.length - protectRecentTurns)).map((item) => item.key)
    );

    return {
      protectAll: false,
      protectedKeys,
      cutoffIndex: firstProtectedUser
    };
  }

  function isProtected(message, index, protection) {
    if (protection.protectAll) return true;
    const key = turnKey(message);
    if (key && protection.protectedKeys.has(key)) return true;
    // Fallback for message variants that do not carry a turn key.
    return index >= protection.cutoffIndex;
  }

  function markVisuallyHidden(message) {
    const clone = { ...message };
    clone.metadata = { ...metadataOf(message), is_visually_hidden_from_conversation: true };
    return clone;
  }

  function compactHiddenMessage(message) {
    const clone = markVisuallyHidden(message);
    const md = { ...clone.metadata };
    for (const key of HEAVY_METADATA_KEYS) delete md[key];
    clone.metadata = md;

    // Keep the message object, id, author, recipient, status and linkage metadata,
    // but remove the payload that normally feeds the heavy card/widget renderer.
    clone.content = { content_type: 'text', parts: [''] };
    return clone;
  }

  function transformConversationPayload(payload, requestUrl, rawSettings) {
    const settings = normalizeSettings(rawSettings);
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    const historicalPage = isHistoricalPageRequest(requestUrl);

    const stats = {
      enabled: settings.enabled,
      mode: settings.mode,
      historicalPage,
      messageCount: messages ? messages.length : 0,
      toolUiSeen: 0,
      reasoningUiSeen: 0,
      candidates: 0,
      modified: 0,
      toolCardsSeen: 0,
      toolCardsKept: 0,
      toolCardsTrimmed: 0,
      estimatedBytesRemoved: 0,
      pageInfoPreserved: true,
      protectRecentTurns: settings.protectRecentTurns,
      maxVisibleToolCards: settings.maxVisibleToolCards,
      recentUserMessageIds: []
    };

    if (!messages || !settings.enabled) {
      return { payload, changed: false, stats };
    }

    if (!historicalPage) {
      stats.recentUserMessageIds = messages
        .filter((message) => roleOf(message) === 'user' && message?.id)
        .map((message) => String(message.id))
        .slice(-10);
    }

    const protection = computeProtection(messages, settings.protectRecentTurns, historicalPage);
    const toolGroups = buildToolCardGroups(messages);
    const budgetToolGroups = toolGroups.groups.filter((group) => isBudgetedToolGroup(group, messages));
    stats.toolCardsSeen = budgetToolGroups.length;

    const groupsProtectedByTurn = budgetToolGroups.filter((group) =>
      group.indexes.some((index) => isProtected(messages[index], index, protection))
    );
    const keptToolGroups = new Set(
      groupsProtectedByTurn
        .slice(Math.max(0, groupsProtectedByTurn.length - settings.maxVisibleToolCards))
        .map((group) => group.key)
    );
    stats.toolCardsKept = keptToolGroups.size;
    stats.toolCardsTrimmed = Math.max(0, budgetToolGroups.length - keptToolGroups.size);

    const outMessages = messages.slice();
    let changed = false;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      const isTool = isToolUiMessage(message);
      const isReasoning = settings.hideOldReasoning && isReasoningUiMessage(message);
      if (isTool) stats.toolUiSeen += 1;
      if (isReasoning) stats.reasoningUiSeen += 1;
      if (!isTool && !isReasoning) continue;

      if (isTool) {
        const group = toolGroups.messageToGroup.get(i);
        if (group && keptToolGroups.has(group.key)) continue;

        // Tool-invocation messages are also the source for ChatGPT's agent/task
        // progress timeline (the completed/running step rows shown above the
        // heavy tool cards). Keep those messages intact even when their logical
        // card is outside the visible-card budget. The paired role=tool / app
        // result messages below are still hidden/compacted, so the expensive UI
        // is removed without sacrificing live progress observability.
        if (isToolInvocationMessage(message)) continue;
      } else if (isProtected(message, i, protection)) {
        continue;
      }

      stats.candidates += 1;

      const beforeBytes = settings.mode === 'compact' ? jsonByteLength(message) : 0;
      const replacement = settings.mode === 'compact'
        ? compactHiddenMessage(message)
        : markVisuallyHidden(message);
      const afterBytes = settings.mode === 'compact' ? jsonByteLength(replacement) : 0;

      outMessages[i] = replacement;
      changed = true;
      stats.modified += 1;
      if (beforeBytes > afterBytes) stats.estimatedBytesRemoved += beforeBytes - afterBytes;
    }

    if (!changed) return { payload, changed: false, stats };

    const out = { ...payload, messages: outMessages };
    // We never assign to page_info. This explicit check is kept as a regression
    // signal in diagnostics and tests.
    stats.pageInfoPreserved = JSON.stringify(payload.page_info) === JSON.stringify(out.page_info);
    return { payload: out, changed: true, stats };
  }

  globalThis.ChatGPTToolSlimCore = Object.freeze({
    DEFAULTS,
    HEAVY_METADATA_KEYS,
    normalizeSettings,
    isConversationDetailRequest,
    isHistoricalPageRequest,
    turnKey,
    isToolInvocationMessage,
    isToolUiMessage,
    isReasoningUiMessage,
    buildToolCardGroups,
    isBudgetedToolGroup,
    transformConversationPayload
  });
})();
