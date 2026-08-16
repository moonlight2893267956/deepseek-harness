# Agent Note: 图片理解（识图）pre-step 插件

状态：已实现

[English](2026-08-16-vision-pre-step.md) | 中文

## 问题

上传图片（如卡通企鹅图）后，纯文本主模型答非所问。诊断确认 OCR pre-step 插件本身工作正常：原图像素完整送达 qwen 视觉模型，但该模型对**无文字图**返回了**文件名幻觉**（`微信图片_202...`），而图片文件里实际没有任何可读文字（tesseract 像素级 OCR 亦无可读文本）。

根因：插件定位为 **OCR（仅文字）**。无文字图超出该契约边界，视觉模型用看似合理、实为编造的文件名填补空缺，并作为 OCR 结果喂给主模型。修法不是配置或链路改动，而是**插件定位的重新界定**。

## 决策

新增 `@deepseek-ai/dsh-vision`，一个挂在 `agent/pre-step` 的独立插件，在用户运行时配置中**替代 OCR 插件**。视觉模型被要求**描述整张图片**：图中有文字则转写，无文字则描述画面，并明确**禁止编造图中不存在的文件名或说明文字**。这消除了产生文件名幻觉的无文字图盲区。

插件沿用 OCR 插件的结构（`Service Definition` + `agent/pre-step` waterfall 监听器）与同一视觉 `LlmRuntime` 引擎，配置字段改名到 `vision*` 命名空间（`visionProvider`、`visionModel`、`visionPrompt`、`visionProvenance`、`mode`、`enabled`、`onFailure`）。`visionPrompt` 默认为忠实描述指令；`visionProvenance` 默认为 `[Image understanding]\n`（replace 模式注入的标记）。`mode` 默认 `replace`，使纯文本主模型仍通过描述文本消费图片，与 OCR 插件原默认一致。

OCR 插件（`@deepseek-ai/dsh-ocr`）保留在仓库中，但运行时不再挂载；其 `ocr.ts` 里的临时 `ocr-debug.log` 诊断代码已移除。

## 改动面

| 面 | 职责 |
| --- | --- |
| `packages/vision/vision` | `@deepseek-ai/dsh-vision`：`VisionService`（Service Definition）+ `agent/pre-step` 监听器。 |
| `packages/ocr/ocr` | 保留，不挂载；`ocr.ts` 去除 debug 日志。 |
| `tsconfig.base.json` | `@deepseek-ai/dsh-*` 路径映射加入 `./packages/vision/*/src`。 |
| `tsconfig.host.json` | host 聚合 references 加入 `./packages/vision/vision`。 |
| `~/.dsh/cordis.patch.yml` | `ocr` 插入替换为 `vision` 插入（dashscope / qwen3.8-max / replace / pass）。 |

## 测试

- `packages/vision/vision/tests/vision.spec.ts` 覆盖 `collectImages`、`replace`、`append`、无图穿透、多图、 `onFailure`（`pass`/`skip`/`throw`）、`enabled` 开关、默认与自定义 `visionPrompt`、provider/model 路由，以及重建消息为全新冻结 `UserMessage`——使用假 `LlmRuntime` 与冻结 `UserMessage` 夹具，无需真实 provider。

## 影响

- 与 OCR pre-step 一致：提交时运行一次，永久入日志；改 prompt 或模型不修订历史会话。
- 文件名幻觉这一类问题由 prompt 契约约束，而非代码；遵守失败的视觉模型仍需改 prompt 或模型。
- 带真实视觉 provider 的 keyless 组装应用快照仍不在本包范围（需凭证化模型）。
