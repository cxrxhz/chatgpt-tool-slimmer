(() => {
  'use strict';

  if (globalThis.__CGPT_TOOL_SLIM_FETCH_INSTALLED__) return;
  globalThis.__CGPT_TOOL_SLIM_FETCH_INSTALLED__ = true;

  const core = globalThis.ChatGPTToolSlimCore;
  if (!core) return;

  const MIRROR_KEY = 'cgpt_tool_slim_settings_v1';
  const BRIDGE_SOURCE = 'chatgpt-tool-slimmer-bridge';
  const MAIN_SOURCE = 'chatgpt-tool-slimmer-main';
  let settings = { ...core.DEFAULTS };

  function loadMirroredSettings() {
    try {
      const raw = localStorage.getItem(MIRROR_KEY);
      if (raw) settings = core.normalizeSettings(JSON.parse(raw));
    } catch {}
  }

  function publishState(payload) {
    try {
      window.postMessage({
        source: MAIN_SOURCE,
        type: 'CGPT_TOOL_SLIM_STATE',
        payload
      }, '*');
    } catch {}
  }

  function requestInfo(resource, init) {
    try {
      const request = resource instanceof Request ? resource : null;
      return {
        url: request ? request.url : String(resource || ''),
        method: String(init?.method || request?.method || 'GET').toUpperCase()
      };
    } catch {
      return { url: String(resource || ''), method: String(init?.method || 'GET').toUpperCase() };
    }
  }

  function rebuildResponse(original, bodyText) {
    const headers = new Headers(original.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const replacement = new Response(bodyText, {
      status: original.status,
      statusText: original.statusText,
      headers
    });
    for (const key of ['url', 'redirected', 'type']) {
      try { Object.defineProperty(replacement, key, { value: original[key] }); } catch {}
    }
    return replacement;
  }

  loadMirroredSettings();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE) return;
    if (data.type === 'CGPT_TOOL_SLIM_SETTINGS') {
      settings = core.normalizeSettings(data.payload);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function toolSlimFetch(resource, init) {
    const info = requestInfo(resource, init);
    const shouldInspect = core.isConversationDetailRequest(info.url, info.method);
    const response = await originalFetch.apply(this, arguments);

    if (!shouldInspect || !settings.enabled) return response;

    try {
      const contentType = String(response.headers.get('content-type') || '');
      if (!response.ok || !/json/i.test(contentType)) return response;

      const text = await response.clone().text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload?.messages)) return response;

      const result = core.transformConversationPayload(payload, info.url, settings);
      publishState({
        historicalPage: result.stats.historicalPage,
        recentUserMessageIds: result.stats.recentUserMessageIds
      });

      if (!result.changed) return response;
      return rebuildResponse(response, JSON.stringify(result.payload));
    } catch (error) {
      // Fail open: ChatGPT receives the untouched original response.
      return response;
    }
  };
})();
