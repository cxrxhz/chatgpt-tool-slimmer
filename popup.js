(() => {
  'use strict';

  const SETTINGS_KEY = 'toolSlimSettings';
  const DEFAULTS = {
    enabled: true,
    realtimeEnabled: true,
    mode: 'safe',
    protectRecentTurns: 2,
    maxVisibleToolCards: 20,
    hideOldReasoning: false
  };

  const $ = (id) => document.getElementById(id);

  function normalize(value) {
    const src = value && typeof value === 'object' ? value : {};
    const legacyMode = String(src.mode || '');
    return {
      enabled: typeof src.enabled === 'boolean'
        ? src.enabled
        : !['off', 'observe'].includes(legacyMode),
      realtimeEnabled: src.realtimeEnabled !== false,
      mode: legacyMode === 'compact' ? 'compact' : 'safe',
      protectRecentTurns: Math.max(0, Math.min(10, Math.floor(Number(src.protectRecentTurns ?? DEFAULTS.protectRecentTurns)))),
      maxVisibleToolCards: Math.max(1, Math.min(200, Math.floor(Number(src.maxVisibleToolCards ?? DEFAULTS.maxVisibleToolCards)))),
      hideOldReasoning: src.hideOldReasoning === true
    };
  }

  function currentSettings() {
    return normalize({
      enabled: $('enabled').checked,
      realtimeEnabled: $('realtimeEnabled').checked,
      mode: $('mode').value,
      protectRecentTurns: $('protectRecentTurns').value,
      maxVisibleToolCards: $('maxVisibleToolCards').value,
      hideOldReasoning: $('hideOldReasoning').checked
    });
  }

  function renderState() {
    const enabled = $('enabled').checked;
    const realtime = $('realtimeEnabled').checked;
    $('settingsArea').classList.toggle('disabled', !enabled);
    $('statusDot').classList.toggle('off', !enabled);
    $('statusText').textContent = enabled
      ? (realtime ? '已启用 · 实时处理' : '已启用 · 仅加载时处理')
      : '插件已关闭';
    $('modeHint').textContent = !enabled
      ? '关闭后，刷新当前页面可以完整恢复由响应层隐藏的历史工具卡。'
      : (realtime
          ? '实时模式只在工具卡/对话节点变化时触发，不进行定时轮询。'
          : '实时处理已关闭：只在刷新页面或 ChatGPT 实际加载历史数据时处理工具卡。');
  }

  async function syncActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try { await chrome.tabs.sendMessage(tab.id, { type: 'CGPT_TOOL_SLIM_SYNC' }); } catch {}
  }

  async function persist() {
    const saveState = $('saveState');
    saveState.textContent = '正在保存…';
    saveState.classList.add('saving');
    const settings = currentSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    await syncActiveTab();
    saveState.textContent = '已保存';
    setTimeout(() => {
      saveState.textContent = '设置自动保存';
      saveState.classList.remove('saving');
    }, 900);
  }

  async function reloadCurrentTab() {
    await persist().catch(() => {});
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try { await chrome.tabs.reload(tab.id); } catch {}
    }
    window.close();
  }

  async function init() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = normalize(data[SETTINGS_KEY] || DEFAULTS);
    $('enabled').checked = settings.enabled;
    $('realtimeEnabled').checked = settings.realtimeEnabled;
    $('mode').value = settings.mode;
    $('protectRecentTurns').value = settings.protectRecentTurns;
    $('maxVisibleToolCards').value = settings.maxVisibleToolCards;
    $('hideOldReasoning').checked = settings.hideOldReasoning;
    renderState();
  }

  for (const id of ['enabled', 'realtimeEnabled', 'mode', 'protectRecentTurns', 'maxVisibleToolCards', 'hideOldReasoning']) {
    $(id).addEventListener('change', () => {
      renderState();
      persist().catch(() => {});
    });
  }
  $('reload').addEventListener('click', reloadCurrentTab);
  init().catch(() => {});
})();
