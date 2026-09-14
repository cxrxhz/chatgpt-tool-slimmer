# Changelog / 更新日志

## v1.0.2 - 2026-09-14

### English

- Fix the main memory-retention issue in real-time mode: old hidden connector / App sandbox iframes are now navigated to `about:blank` so their remote browsing contexts can be released instead of remaining alive behind `display:none`.
- Preserve the original iframe URL and restore it when a hidden card becomes visible again, without removing React-owned iframe elements from the DOM.
- Reduce real-time full-document scan pressure by replacing the old ~800 ms throttle with a 1.5 s trailing debounce and a 5 s maximum wait.
- Keep task / agent progress rows excluded from tool-card hiding and budget counting.
- Extend the browser DOM regression harness to verify iframe unload and reversible restore behavior.
- Real-page validation on a long ChatGPT conversation unloaded 219 of 221 mounted tool iframes while keeping the two protected frames live. In that test session, aggregate Edge memory dropped by roughly 2.58 GiB Working Set and 3.47 GiB Private Bytes after the old test tab was replaced by the fixed one; this is an environment-specific observation, not a guaranteed per-tab saving.

### 中文

- 修复实时模式下最主要的内存驻留问题：旧的 connector / App sandbox iframe 被隐藏后会导航到 `about:blank`，从而释放其远程浏览上下文，而不再只是 `display:none` 后继续常驻内存。
- 保存 iframe 原始 URL；若旧卡片之后重新进入保留范围，会恢复原 URL，同时不删除 React 管理的 iframe DOM 节点。
- 降低实时全页扫描压力：把原来的约 800 ms 节流改为 1.5 s 尾随防抖，并设置 5 s 最长等待上限。
- 继续保证任务 / agent 进度行不会被当作工具卡隐藏，也不会占用工具卡额度。
- 扩展真实浏览器 DOM 回归测试，新增 iframe 卸载和可逆恢复验证。
- 在一个真实 ChatGPT 长对话测试中，221 个已挂载工具 iframe 中有 219 个被成功卸载，只保留 2 个受保护 iframe。该测试会话中，用修复版标签页替换旧测试标签页后，Edge 汇总 Working Set 约下降 2.58 GiB、Private Bytes 约下降 3.47 GiB；这是特定测试环境的观测值，不代表每个标签页都能固定节省相同内存。

## v1.0.1 - 2026-09-11

### English

- Fix tool-card budget counting so task / agent progress-only invocation rows do not consume the visible-card limit.
- Keep the existing invocation + result grouping, so a real heavy tool result still counts as one logical card.

### 中文

- 修复工具卡额度计数：仅用于展示任务 / agent 进度、没有重工具结果的调用行不再占用“最多保留工具卡数量”。
- 保留原有“调用 + 工具结果”分组，因此真正的重工具结果仍按 1 张逻辑工具卡计数。

## v1.0.0 - 2026-09-10

### English

- First stable release.
- Preserve ChatGPT native conversation pagination and upward history loading.
- Limit visible historical tool UI by recent user turns and logical tool-card count.
- Add optional real-time handling for newly generated and remounted tool cards.
- Add Safe and Compact processing modes.
- Preserve task / agent progress timelines while trimming heavy historical tool results.
- Add master enable switch and independent real-time switch.
- No telemetry or extension-owned external service.

### 中文

- 首个稳定版本。
- 保留 ChatGPT 原生会话分页与向上历史加载。
- 历史工具 UI 同时支持“最近用户轮次”和“逻辑工具卡数量”限制。
- 支持可选实时处理，用于新生成或重新挂载的工具卡。
- 提供 Safe / Compact 两种处理模式。
- 精简历史重工具结果的同时保留任务 / agent 执行进度时间线。
- 增加插件总开关和独立实时处理开关。
- 无遥测，不依赖插件自有外部服务。
