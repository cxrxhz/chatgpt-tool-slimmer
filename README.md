# ChatGPT Tool Slimmer

[中文说明](README.zh-CN.md) · English

A lightweight Chrome / Edge MV3 extension for reducing heavy historical tool UI in long ChatGPT conversations **without taking over ChatGPT's native conversation pagination**.

ChatGPT Tool Slimmer focuses on the parts that tend to become expensive in tool-heavy chats: old tool-result UI, connector / App iframes, and related rendering payloads. Ordinary conversation text and task / agent progress remain visible.

> **Unofficial project.** This extension is not affiliated with or endorsed by OpenAI. ChatGPT Web internals can change without notice, so compatibility fixes may be needed after frontend updates.

## Highlights

- Preserves ChatGPT's native history loading and pagination.
- Hides heavy historical tool / connector UI instead of collapsing whole messages.
- Keeps the latest configurable number of user turns.
- Keeps at most a configurable number of logical tool cards (default: `20`).
- Applies both limits together; the stricter one wins.
- Optional low-overhead real-time processing for newly mounted or newly generated tool cards.
- Preserves task / agent progress timelines such as running / completed step rows.
- Safe mode for compatibility and Compact mode for stronger payload reduction.
- Global enable / disable switch.
- No telemetry and no external service used by the extension itself.

## Why this exists

Long ChatGPT conversations that contain many tools, connectors, MCP-style Apps, or rich tool results can become much heavier than text-only chats. A single user turn may generate dozens of tool UI blocks.

Generic DOM trimmers can conflict with ChatGPT's own virtualized / paginated conversation rendering, and aggressive ancestor-based hiding can accidentally remove an entire assistant turn. Tool Slimmer therefore follows a narrower approach:

1. leave ChatGPT's own conversation pagination intact;
2. process only tool-related historical UI / payloads;
3. use conservative DOM boundaries for real-time cleanup;
4. preserve lightweight task-progress rows used to observe long-running work.

## How it works

Tool Slimmer uses two independent layers.

### Load-time layer

For ChatGPT conversation-detail responses such as:

```text
/backend-api/conversations/<conversation-id>
```

the extension processes old tool-result records before React mounts the heavy UI. It does **not** rewrite pagination state such as `page_info`, cursor values, `has_previous_page`, or `has_next_page`.

### Real-time layer

When enabled, a low-overhead MutationObserver handles cases where ChatGPT has already prefetched older content and later remounts it without issuing another history request. It also reapplies the tool-card budget while the current conversation is generating more tool calls.

There is no periodic page-wide polling. DOM mutations are coalesced and scans are rate-limited.

The conservative real-time detector targets UI with clear heavy-tool evidence, including:

- `ui://` / `web-sandbox.oaiusercontent.com` connector / App iframes;
- standalone tool-result / "tools called" summary blocks.

`cot-v5-tool-icon-pile` is **not** treated as sufficient evidence by itself because current ChatGPT also reuses that component for task / agent progress timelines.

## Visibility policy

The two limits are combined:

```text
visible tool card
  = inside the latest N user turns
  AND among the newest M logical tool cards in those turns
```

Defaults: recent user turns `2`, maximum visible logical tool cards `20`.

One logical tool invocation plus its following result records is counted as one logical tool card where possible, instead of counting every protocol message separately.

## Modes

### Safe

Compatibility-first mode. Old tool **result / UI** messages are marked hidden using ChatGPT-compatible visibility metadata while their original payload is otherwise kept.

Assistant-to-tool invocation messages continue to participate in logical tool-card counting but are kept visible so task-progress descriptions are not lost.

### Compact

Applies the same hiding policy, then removes large rendering metadata and result content from old tool-result messages. Identity, author, recipient, status, and required linkage fields remain intact.

Compact mode can reduce historical tool payload retained by the client, but Safe mode is recommended first when testing a new ChatGPT frontend version.

## Settings

### Extension switch

Disables both load-time and real-time processing. DOM elements hidden by the real-time layer are restored immediately. Refresh the page to fully restore anything transformed at load time.

### Real-time processing

Enabled by default.

- **On:** handles newly generated tool cards and already-prefetched history that ChatGPT later remounts.
- **Off:** no MutationObserver is used. Processing only happens when the page is refreshed or ChatGPT actually requests conversation / history data.

### Hide old reasoning

Optional. When enabled, old `thoughts` / `reasoning_recap` UI outside the protected recent-turn range is hidden as well.

## Installation

### From GitHub Releases

1. Download the latest ZIP from **Releases**.
2. Extract it.
3. Open `edge://extensions/` in Microsoft Edge or `chrome://extensions/` in Chrome.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder that contains `manifest.json`.

### From source

Clone the repository and load the repository root as an unpacked extension. There is no build step.

## Verified behavior in v1.0.0

- Native upward history loading remains available.
- Old tool cards are limited by recent-turn scope and card count.
- During a long running turn, older cards can be removed from view as the budget is exceeded.
- Starting a new user turn causes the previous turn to be reevaluated against the configured limits.
- Prefetched history that is only remounted in the DOM can still be handled when real-time mode is enabled.
- Connector / App iframe hiding is bounded to the individual tool UI container rather than an entire assistant turn.
- Task / agent progress timelines remain visible.

## Privacy

Tool Slimmer does not send telemetry and does not call an external service of its own. Settings are stored locally through `chrome.storage.local`.

The extension necessarily runs on ChatGPT pages and observes / transforms ChatGPT page data locally in your browser to perform its function.

## Compatibility and recovery

ChatGPT Web's internal DOM and conversation APIs are not public stable extension APIs. If a ChatGPT frontend update causes unexpected behavior:

1. turn off Tool Slimmer using its master switch;
2. refresh the ChatGPT page;
3. if needed, disable the extension from the browser's extension-management page;
4. open a GitHub issue with your browser version, Tool Slimmer settings, and a screenshot of the affected UI.

Please **do not upload full private conversation responses** to bug reports.

## Development

```bash
node tests/run-tests.mjs
node --check core.js
node --check dom-core.js
node --check main-world.js
node --check bridge.js
node --check popup.js
```

The regression suite checks that tool-card limits work while ordinary assistant content and task-progress rows remain visible.

## License

[MIT](LICENSE)
