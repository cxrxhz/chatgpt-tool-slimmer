# ChatGPT Tool Slimmer

中文说明 · [English](README.md)

一个面向 Chrome / Edge 的轻量 MV3 扩展，用于降低 ChatGPT 长对话中历史工具 UI 的负担，同时**不接管 ChatGPT 自己的历史分页和加载逻辑**。

ChatGPT Tool Slimmer 主要处理工具密集型对话中容易变重的部分：旧工具结果 UI、connector / App iframe 以及相关渲染 payload。普通对话文本和用于观察任务状态的 agent / task 执行进度会保留。

> **非官方项目。** 本扩展与 OpenAI 无隶属或官方认可关系。ChatGPT Web 内部实现可能随时变化，前端更新后可能需要兼容性修复。

## 主要特点

- 保留 ChatGPT 原生历史加载与分页。
- 只处理历史重工具 / connector UI，不折叠整条普通消息。
- 可设置完整保留最近多少个用户轮次。
- 可设置最多保留多少张逻辑工具卡，默认 `20`。
- 轮次限制和工具卡数量限制同时生效，取更严格的一项。
- 可选低开销实时处理，用于新生成或重新挂载的工具卡。
- 明确保留任务 / agent 的“正在执行 / 已完成”进度时间线。
- 提供兼容优先的 Safe 模式和更强 payload 精简的 Compact 模式。
- 提供插件总开关和实时处理开关。
- 无遥测；插件自身不调用外部服务。

## 为什么做这个插件

当 ChatGPT 长对话包含大量工具、connector、MCP 风格 App 或富工具结果时，网页通常会比纯文本对话重很多。一轮用户请求就可能产生几十张工具 UI。

普通 DOM 裁剪扩展容易与 ChatGPT 自带的虚拟化 / 分页渲染冲突；如果采用“向上找父容器再隐藏”的激进方式，还可能误把整轮 assistant 内容一起隐藏。因此 Tool Slimmer 采用更窄、更保守的策略：

1. ChatGPT 的原生历史分页完全交给 ChatGPT 自己；
2. 只处理历史工具相关 UI / payload；
3. 实时隐藏只使用保守的工具卡边界；
4. 保留观察长任务时很有用的轻量执行进度行。

## 工作原理

Tool Slimmer 有两个彼此独立的处理层。

### 加载层

当 ChatGPT 加载类似下面的 conversation detail 数据时：

```text
/backend-api/conversations/<conversation-id>
```

扩展在 React 挂载重工具 UI 之前处理超出范围的旧工具结果记录。它**不会**修改 `page_info`、cursor、`has_previous_page`、`has_next_page` 等分页状态。

### 实时层

开启后，低开销 MutationObserver 用于处理一种新版 ChatGPT 常见情况：历史内容已经提前预取到前端状态里，向上滚时只是重新 mount，并没有再次发送历史请求。实时层也会在当前一轮持续产生更多工具卡时重新应用工具卡数量限制。

实时模式没有周期性的全页轮询。多个 DOM 变化会合并处理，并进行最低扫描间隔限制。

目前实时识别只处理有明确“重工具结果”证据的 UI，例如：

- `ui://` / `web-sandbox.oaiusercontent.com` connector / App iframe；
- 独立的工具结果 / “已调用工具”摘要块。

`cot-v5-tool-icon-pile` **不会单独作为隐藏依据**，因为当前 ChatGPT 也会在任务 / agent 执行进度时间线中复用这个组件。

## 保留策略

两个限制取交集：

```text
工具卡可见
  = 位于最近 N 个用户轮次内
  AND 属于这些轮次中的最新 M 张逻辑工具卡
```

默认：最近用户轮次 `2`，最多可见逻辑工具卡 `20`。

扩展会尽量把一次工具调用以及后续的一组结果记录归为 **1 张逻辑工具卡**，而不是把协议层每一条 message 都单独计数。只有进度描述、没有可隐藏工具结果的调用行**不会占用工具卡额度**。

## 两种处理模式

### Safe / 兼容模式

优先兼容性。旧工具的**结果 / UI message** 会通过 ChatGPT 可识别的可见性 metadata 隐藏，但不进一步清空原始 payload。

`assistant → tool` 的调用消息本身保持可见，因此任务执行进度描述不会一起消失。只有同一逻辑组内存在真正可隐藏的工具结果 / connector / App UI 时，该组才会占用逻辑工具卡额度。

### Compact / 精简模式

在同样隐藏策略的基础上，进一步删除旧工具**结果** message 中较大的渲染 metadata 和结果内容，从而减少浏览器解析和保留历史工具 payload 的负担。

message ID、author、recipient、状态及必要链路字段仍然保留。首次适配新的 ChatGPT 前端版本时建议先用 Safe 模式验证。

## 设置说明

### 插件总开关

关闭后，加载层和实时层都停止处理。由实时层隐藏的 DOM 卡片会立即恢复；已经在加载阶段处理过的数据需要刷新页面才能完整恢复。

### 实时处理

默认开启。

- **开启：** 处理当前对话中新生成的工具卡，以及 ChatGPT 预取后才重新 mount 的历史工具卡。
- **关闭：** 不创建 MutationObserver，也不进行实时扫描；只在刷新页面或 ChatGPT 实际请求 conversation / history 数据时处理。

从 v1.0.2 开始，实时 DOM 处理使用尾随防抖合并连续变化，不再在长工具流期间约每秒反复进行整页扫描。被隐藏的 connector / App sandbox iframe 也会导航到 `about:blank`，以便释放远程浏览上下文；如果该卡片之后重新进入可见范围，会恢复原始 URL。

### 隐藏旧 reasoning

可选。开启后，超出最近轮次保护范围的 `thoughts` / `reasoning_recap` UI 也会隐藏。

## 安装

### 从 GitHub Releases 安装

1. 从 **Releases** 下载最新版 ZIP。
2. 解压 ZIP。
3. Edge 打开 `edge://extensions/`，Chrome 打开 `chrome://extensions/`。
4. 开启“开发人员模式”。
5. 选择“加载解压缩的扩展”，指向包含 `manifest.json` 的目录。

### 从源码安装

克隆仓库后，直接把仓库根目录作为“加载解压缩的扩展”目录即可，不需要构建。

## v1.0.2 已验证行为

- ChatGPT 原生向上加载历史仍可正常使用。
- 历史工具卡同时受最近轮次和卡片数量限制。
- 当前一轮执行过程中，工具卡超过数量预算后可实时淘汰更旧的卡片。
- 开始下一轮后，上一轮会重新按当前限制处理。
- 对 ChatGPT 已预取、滚动时仅重新 mount 的旧历史工具卡，开启实时模式后仍可补充处理。
- connector / App iframe 只隐藏单张工具 UI 容器，不向上误伤整轮 assistant。
- 超出可见额度的 connector / App iframe 会释放其浏览上下文；若之后重新进入可见范围，可以恢复原始 iframe URL。
- 实时 mutation 处理会合并连续变化，减少长时间工具执行期间的重复整页扫描。
- 任务 / agent 执行进度时间线保持可见。

## 隐私

Tool Slimmer 不发送遥测，也不调用插件自己的外部服务。设置仅通过 `chrome.storage.local` 保存在本地浏览器中。

为了实现功能，扩展会在本地观察和转换 ChatGPT 页面数据，但这些处理发生在你的浏览器里。

## 兼容性与恢复

ChatGPT Web 的内部 DOM 和 conversation API 并不是公开稳定的扩展 API。若 ChatGPT 前端更新后出现异常：

1. 先关闭 Tool Slimmer 总开关；
2. 刷新 ChatGPT 页面；
3. 如果仍异常，在浏览器扩展管理页面临时禁用扩展；
4. 在 GitHub 提交 Issue，附上浏览器版本、Tool Slimmer 设置以及受影响 UI 的截图。

请**不要在 Issue 中上传完整私人 conversation response**。

## 开发与测试

```bash
node tests/run-tests.mjs
node --check core.js
node --check dom-core.js
node --check main-world.js
node --check bridge.js
node --check popup.js
```

回归测试包含：工具卡数量限制正常生效，同时普通 assistant 内容和任务执行进度行不得被隐藏。

## License

[MIT](LICENSE)
