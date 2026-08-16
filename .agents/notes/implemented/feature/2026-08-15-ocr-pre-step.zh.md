# Agent Note: 图片 OCR 预处理插件

Status: implemented

[English](2026-08-15-ocr-pre-step.md) | 中文

## 问题

用户消息可能携带 image 块，但纯文本模型（如 DeepSeek，其适配器对任意 image 抛出类型化 `UNSUPPORTED_CONTENT`）无法消费，而多模态模型又会在像素上浪费 token——这些 token 本可由视觉模型先总结成文本。仓库需要一种方式：用配置好的视觉模型识别图片，并在真实模型看到之前把文本折叠进对话。

拦截点受两条文档化不变量约束：

- `llm/stream` 请求**深度冻结**（改写会抛错），其 JSDoc 写明监听器"read it, never rewrite it"。该处的监听器无法改写 `messages`。
- `AGENTS.md` 强制 **"Model-visible ⟺ logged"**：任何到达模型请求的内容必须能从会话日志重建；新的模型可见输入需要一个会话事件。在 `llm/stream` 注入 OCR 文本永远不会进入日志，会破坏重放、压缩与强制的 keyless 快照。

`agent/request` 只返回路由配置、不含 `messages`，因此也无法改写内容。

## 决策

新增 `@deepseek-ai/dsh-ocr` 独立插件，注册 `agent/pre-step` 瀑布监听器——这是唯一能在消息**写入会话日志之前**改写进入步骤消息的接缝。监听器返回 `{ kind: 'enter', messages }` 把 OCR 文本折叠进进入的 `UserMessage`，随后该消息作为真正的 `user/message` 事件追加：既对模型可见、又落库。

OCR 引擎复用已注册的 `LlmRuntime`：`stream({ provider: ocrProvider, model: ocrModel, system: ocrPrompt, messages: [imageUserMessage] })`。image 块原样转发，适配器从附件引用解析字节。由于 OCR 子调用经 `LlmRuntime.stream` 而非 `agent/pre-step` 派发，无需防递归保护。

进入的消息用 `createUserMessage`（深度冻结）重建：replace 模式把 image 块替换为 `text` 块；append 模式保留 image 并在其后插入携带识别文本的 `text` 块。注入文本的 `source.kind` 为 `'plugin'`（`plugin: 'dsh-ocr'`、`form: 'notice'`），以区分 OCR 产出与原始 user 图片。

每个随部署变化的选项都是校验过的 `Config` 字段（`ocrProvider`、`ocrModel`、`ocrPrompt`、`mode`、`enabled`、`onFailure`）；缺失必填项在加载时 loud fail。`onFailure` 决定识别失败行为：`pass` 保留原图、`throw` 中止步骤、`skip` 丢弃该图（仅 replace 模式）。

### 与计划记录的接缝变更

计划记录提出 `llm/stream` prepend 监听器。该点错误：会在冻结请求上抛错并注入未落库内容。本变更改用 `agent/pre-step`，彻底删除了计划中那套 `AsyncLocalStorage` 防递归机制，并使 OCR 成为一次性的、落库的、可重放步骤。

## 表面变更

| Surface | Responsibility |
| --- | --- |
| `packages/ocr/ocr` | `@deepseek-ai/dsh-ocr`：`OcrService`（Service Definition）+ `agent/pre-step` 监听器。 |
| `packages/llm/llm` | 未改动；OCR 复用 `LlmRuntime.stream`、`createUserMessage`、`deepFreeze`、`ImageBlock`。 |
| `packages/attachment/attachment` | 未改动；OCR 复用 image 块携带的附件引用。 |
| `packages/core/agent` | 未改动；`agent/pre-step` 已支持 `enter` 决策（`goal-round-driver` 先例）。 |

未修改任何现有代码路径；仅新增插件与配置。

## 测试

- `packages/ocr/ocr/tests/ocr.spec.ts` 覆盖 `collectImages`、`replace`、`append`、无图直通、多图、以及 `onFailure`（`pass`/`skip`/`throw`）与 `enabled` 开关，使用 fake `LlmRuntime` 与冻结 `UserMessage` fixtures——无真实 provider、无递归。
- keyless 组装应用快照应放在可运行 `cordis.yml` bundle + 真实 OCR 能力 provider 中；本包不附带该 bundle，因为需要凭据化的视觉模型。

## 后果

- OCR 在消息提交时运行一次并永久落库；修改 `ocrPrompt` 或 `ocrModel` 不会修订历史会话。
- `skip` 仅在 replace 模式移除图片；append 模式保留失败图片（无文本可追加）。
- `replace` 模式是让纯文本模型消费含图消息的唯一路径——在真实请求前移除图片。
- provider 特定的多图批处理、区域选择、语言提示未暴露；它们应作为 OCR 引擎的 `Config` 扩展。
