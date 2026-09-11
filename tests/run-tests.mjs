import assert from 'node:assert/strict';

await import('../core.js');
const core = globalThis.ChatGPTToolSlimCore;
assert(core, 'core should install on globalThis');

function user(id, turn) {
  return {
    id,
    author: { role: 'user', name: null },
    content: { content_type: 'text', parts: [`user ${id}`] },
    metadata: { working_turn_id: turn },
    recipient: 'all'
  };
}

function call(id, turn, recipient = 'web.run') {
  return {
    id,
    author: { role: 'assistant', name: null },
    content: { content_type: 'code', text: '{"q":"x"}' },
    metadata: { working_turn_id: turn, inline_cot_expandable_content: 'X'.repeat(4000) },
    recipient,
    end_turn: false
  };
}

function tool(id, turn, name = 'web.run', parentId = null) {
  return {
    id,
    author: { role: 'tool', name },
    content: { content_type: 'text', parts: ['Y'.repeat(6000)] },
    metadata: {
      working_turn_id: turn,
      ...(parentId ? { parent_id: parentId } : {}),
      search_result_groups: [{ text: 'Z'.repeat(5000) }]
    },
    recipient: 'all'
  };
}

{
  const parallel = [
    user('up', 'tp'),
    call('cp1', 'tp', 'web.run'),
    call('cp2', 'tp', 'api_tool.call_tool'),
    tool('rp1', 'tp', 'web.run', 'cp1'),
    tool('rp2', 'tp', 'api_tool', 'cp2'),
    tool('rp2b', 'tp', 'api_tool', 'rp2'),
    answer('ap', 'tp')
  ];
  const groups = core.buildToolCardGroups(parallel);
  assert.equal(groups.groups.length, 2, 'parallel invocations should stay as two logical cards');
  assert.deepEqual(groups.groups[0].indexes, [1, 3]);
  assert.deepEqual(groups.groups[1].indexes, [2, 4, 5]);
}

function answer(id, turn) {
  return {
    id,
    author: { role: 'assistant', name: null },
    content: { content_type: 'text', parts: [`answer ${id}`] },
    metadata: { working_turn_id: turn },
    recipient: 'all',
    end_turn: true
  };
}

function thoughts(id, turn) {
  return {
    id,
    author: { role: 'assistant', name: null },
    content: { content_type: 'thoughts', thoughts: ['thinking'] },
    metadata: { working_turn_id: turn, inline_cot_expandable_content: 'R'.repeat(3000) },
    recipient: 'all'
  };
}

const initialUrl = 'https://chatgpt.com/backend-api/conversations/abc?include_has_versions=true&num_turns=10';
const historyUrl = `${initialUrl}&cursor=older-123`;

assert.equal(core.isConversationDetailRequest(initialUrl), true);
assert.equal(core.isConversationDetailRequest('https://chatgpt.com/backend-api/conversations?offset=0&limit=28'), false);
assert.equal(core.isConversationDetailRequest('https://chatgpt.com/backend-api/conversation/abc'), false);
assert.equal(core.isHistoricalPageRequest(initialUrl), false);
assert.equal(core.isHistoricalPageRequest(historyUrl), true);
assert.equal(core.normalizeSettings({}).maxVisibleToolCards, 20);
assert.equal(core.normalizeSettings({}).enabled, true);
assert.equal(core.normalizeSettings({}).realtimeEnabled, true);
assert.equal(core.normalizeSettings({ mode: 'off' }).enabled, false, 'v0.x Off migrates to the master switch');
assert.equal(core.normalizeSettings({ mode: 'observe' }).enabled, false, 'v0.x Observe migrates fail-safe to disabled');
assert.equal(core.normalizeSettings({ realtimeEnabled: false }).realtimeEnabled, false);

const pageInfo = {
  start_cursor: 'keep-this-start',
  end_cursor: 'keep-this-end',
  has_previous_page: true,
  has_next_page: false
};

const payload = {
  conversation_id: 'abc',
  messages: [
    user('u1', 't1'), call('c1', 't1'), tool('r1', 't1'), thoughts('th1', 't1'), answer('a1', 't1'),
    user('u2', 't2'), call('c2', 't2'), tool('r2', 't2'), answer('a2', 't2'),
    user('u3', 't3'), call('c3', 't3'), tool('r3', 't3'), answer('a3', 't3')
  ],
  page_info: pageInfo,
  current_node: 'a3'
};

{
  const result = core.transformConversationPayload(payload, initialUrl, {
    mode: 'safe', protectRecentTurns: 2, hideOldReasoning: false
  });
  assert.equal(result.changed, true);
  assert.equal(result.stats.modified, 1, 'only the old t1 tool result should be hidden');
  assert.equal(result.stats.toolCardsSeen, 3, 'call + result pairs should count as logical cards');
  assert.equal(result.stats.toolCardsKept, 2);
  assert.deepEqual(result.stats.recentUserMessageIds, ['u1', 'u2', 'u3'], 'initial page should expose tail user ids to the realtime tracker');
  assert.equal(result.payload.messages[1].metadata.is_visually_hidden_from_conversation, undefined, 'tool invocation stays visible for the task-progress timeline');
  assert.equal(result.payload.messages[1].metadata.inline_cot_expandable_content.length, 4000, 'progress metadata stays intact');
  assert.equal(result.payload.messages[2].metadata.is_visually_hidden_from_conversation, true);
  assert.equal(result.payload.messages[3].metadata.is_visually_hidden_from_conversation, undefined, 'reasoning stays when option is off');
  assert.equal(result.payload.messages[6].metadata.is_visually_hidden_from_conversation, undefined, 'recent t2 remains intact');
  assert.deepEqual(result.payload.page_info, pageInfo, 'pagination metadata must be byte-semantically untouched');
}

{
  const result = core.transformConversationPayload(payload, initialUrl, {
    mode: 'compact', protectRecentTurns: 2, hideOldReasoning: true
  });
  assert.equal(result.stats.modified, 2, 'old t1 result + thoughts should be compacted while the invocation/progress stays intact');
  assert(result.stats.estimatedBytesRemoved > 10000, 'compact mode should remove meaningful payload');
  assert.equal(result.payload.messages[1].content.content_type, 'code', 'tool invocation content is preserved');
  assert.equal('inline_cot_expandable_content' in result.payload.messages[1].metadata, true, 'task-progress metadata is preserved');
  assert.equal('search_result_groups' in result.payload.messages[2].metadata, false);
  assert.equal(result.payload.messages[4].content.parts[0], 'answer a1', 'final answer must remain untouched');
  assert.deepEqual(result.payload.page_info, pageInfo);
}

{
  const result = core.transformConversationPayload(payload, historyUrl, {
    mode: 'safe', protectRecentTurns: 2, hideOldReasoning: false
  });
  assert.equal(result.stats.historicalPage, true);
  assert.equal(result.stats.modified, 3, 'cursor pages hide tool results but preserve invocation/progress messages');
  assert.equal(result.stats.toolCardsKept, 0, 'cursor pages are always outside the recent-turn window');
  assert.equal(result.payload.messages[1].metadata.is_visually_hidden_from_conversation, undefined, 'historical invocation/progress remains visible');
  assert.equal(result.payload.messages[2].metadata.is_visually_hidden_from_conversation, true, 'historical tool result is hidden');
  assert.deepEqual(result.stats.recentUserMessageIds, [], 'historical pages must not replace the real tail tracker');
  assert.equal(result.payload.messages[12].content.parts[0], 'answer a3', 'assistant final answer remains visible on historical pages');
  assert.deepEqual(result.payload.page_info, pageInfo);
}

{
  const manyCards = {
    messages: [
      user('u1', 't1'), call('c1a', 't1'), tool('r1a', 't1'), answer('a1', 't1'),
      user('u2', 't2'), call('c2a', 't2'), tool('r2a', 't2'), call('c2b', 't2'), tool('r2b', 't2'), answer('a2', 't2'),
      user('u3', 't3'), call('c3a', 't3'), tool('r3a', 't3'), call('c3b', 't3'), tool('r3b', 't3'), answer('a3', 't3')
    ],
    page_info: pageInfo,
    current_node: 'a3'
  };
  const result = core.transformConversationPayload(manyCards, initialUrl, {
    mode: 'safe', protectRecentTurns: 2, maxVisibleToolCards: 2, hideOldReasoning: false
  });
  assert.equal(result.stats.toolCardsSeen, 5);
  assert.equal(result.stats.toolCardsKept, 2, 'card limit and recent-turn limit use the stricter intersection');
  assert.equal(result.stats.toolCardsTrimmed, 3);
  assert.equal(result.stats.modified, 3, 'three trimmed logical cards hide only their result messages');
  assert.equal(result.payload.messages[5].metadata.is_visually_hidden_from_conversation, undefined, 'older invocation remains visible as progress');
  assert.equal(result.payload.messages[6].metadata.is_visually_hidden_from_conversation, true, 'older tool result inside protected turns is trimmed by card budget');
  assert.equal(result.payload.messages[7].metadata.is_visually_hidden_from_conversation, undefined, 'second invocation remains visible as progress');
  assert.equal(result.payload.messages[8].metadata.is_visually_hidden_from_conversation, true, 'its paired result is trimmed');
  assert.equal(result.payload.messages[11].metadata.is_visually_hidden_from_conversation, undefined, 'newest two logical cards remain visible');
  assert.equal(result.payload.messages[13].metadata.is_visually_hidden_from_conversation, undefined, 'newest two logical cards remain visible');
}

{
  const multiResult = {
    messages: [
      user('u', 't'),
      call('c', 't'),
      tool('r1', 't'),
      tool('r2', 't'),
      answer('a', 't')
    ],
    page_info: pageInfo
  };
  const groups = core.buildToolCardGroups(multiResult.messages);
  assert.equal(groups.groups.length, 1, 'one invocation plus multiple tool result records is one logical card');
  assert.deepEqual(groups.groups[0].indexes, [1, 2, 3]);
}

{
  const progressDoesNotConsumeBudget = {
    messages: [
      user('u-progress', 't-progress'),
      call('c-heavy', 't-progress'),
      tool('r-heavy', 't-progress'),
      call('progress-1', 't-progress', 'api_tool.read_resource'),
      call('progress-2', 't-progress', 'python'),
      answer('a-progress', 't-progress')
    ],
    page_info: pageInfo,
    current_node: 'a-progress'
  };
  const groups = core.buildToolCardGroups(progressDoesNotConsumeBudget.messages);
  assert.equal(groups.groups.length, 3, 'progress invocations remain separate logical groups for pairing/state');
  assert.equal(core.isBudgetedToolGroup(groups.groups[0], progressDoesNotConsumeBudget.messages), true);
  assert.equal(core.isBudgetedToolGroup(groups.groups[1], progressDoesNotConsumeBudget.messages), false);
  assert.equal(core.isBudgetedToolGroup(groups.groups[2], progressDoesNotConsumeBudget.messages), false);

  const result = core.transformConversationPayload(progressDoesNotConsumeBudget, initialUrl, {
    mode: 'safe', protectRecentTurns: 1, maxVisibleToolCards: 1, hideOldReasoning: false
  });
  assert.equal(result.stats.toolCardsSeen, 1, 'progress-only invocation rows must not consume the visible tool-card budget');
  assert.equal(result.stats.toolCardsKept, 1);
  assert.equal(result.stats.toolCardsTrimmed, 0);
  assert.equal(result.payload.messages[3].metadata.is_visually_hidden_from_conversation, undefined, 'progress row stays visible');
  assert.equal(result.payload.messages[4].metadata.is_visually_hidden_from_conversation, undefined, 'progress row stays visible');
}

{
  const fragment = {
    messages: [call('c-only', 't-x'), tool('r-only', 't-x')],
    page_info: { has_previous_page: false }
  };
  const result = core.transformConversationPayload(fragment, initialUrl, {
    mode: 'compact', protectRecentTurns: 2, hideOldReasoning: true
  });
  assert.equal(result.changed, false, 'non-pagination fragment without a user turn must fail open');
}

{
  const result = core.transformConversationPayload(payload, initialUrl, {
    enabled: false, mode: 'safe', protectRecentTurns: 2, hideOldReasoning: true
  });
  assert.equal(result.changed, false);
  assert.equal(result.stats.candidates, 0);
  assert.equal(result.stats.modified, 0);
}

console.log('All Tool Slimmer core tests passed.');
