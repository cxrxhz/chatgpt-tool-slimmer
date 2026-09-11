# Changelog / 更新日志

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
