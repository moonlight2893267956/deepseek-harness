# Agent Note: 按模型选择是否启用 vision 预处理

状态：已实现

[English](2026-08-16-vision-model-opt-in.md) | 中文

## 问题

vision 的 `agent/pre-step` 此前只受部署级 `enabled` 总开关约束，完全不看所选模型的 `inputModalities`。只要开了 vision，所有 agent 都被强制走 vision 子调用——于是明明诚实声明 `['text','image']`（原生看图）的多模态模型，也被强行喂入「另一个视觉模型转写出的文本块」，既浪费一次子调用，又丢掉了模型自身的多模态能力。

## 决策

在模型配置项加一个三态 `vision` 标志，透传到跨 adapter 共享的模型元数据类型，使所有 provider 都能用同一字段：

- `VisionModelMode = 'on' | 'off'` 定义在 `@deepseek-ai/dsh-llm/src/types.ts`；`undefined` 表示「未声明」。
- `LlmModelInfo.vision?` 与 `LlmResolvedModelInfo.vision?` 承载它；`DeepSeekCatalogModel.vision?` 是目录作者设置的每模型开关。
- `resolveVisionMode(info, vision, isMultimodal)`（新增 `packages/vision/vision/src/resolve-vision-mode.ts`）是纯决策函数：

  | `vision` | 模型模态 | 介入 | 设 bypass |
  | --- | --- | --- | --- |
  | `undefined` | 多模态 | 否 | 否 |
  | `undefined` | 纯文本 | 是 | 是 |
  | `'on'` | 任意 | 是 | `!isMultimodal` |
  | `'off'` | 任意 | 否 | 否 |

- vision 的 `agent/pre-step` 现在读取 `agent.options.{provider,model}`，调用 `ctx.llm.resolveModelInfo(...)`，并在任何图片处理前查 `resolveVisionMode`。它仅在「对纯文本模型介入」时设置 `agent.imageAdmissionBypass`（此前是 `enabled && mode === 'replace'` 时通过 `agent/created` 给每个 agent 无条件设置）。

## 为何用三态而非布尔

`undefined` 保留了「按模态推断」这一默认解药，无需配置即可修掉多模态问题；`'on'`/`'off'` 是显式覆盖。布尔会锁死多模态默认值，逼每个目录条目二选一。

## 涉及面

| 面 | 职责 |
| --- | --- |
| `packages/llm/llm/src/types.ts` | `VisionModelMode`；`LlmModelInfo`/`LlmResolvedModelInfo` 加 `vision?`。 |
| `packages/llm/llm-deepseek/src/adapter.ts` | `DeepSeekCatalogModel.vision?`；`modelInfo()` 透传（`resolveModel` 经 `modelInfo` 继承）。 |
| `packages/vision/vision/src/resolve-vision-mode.ts` | 新增 `resolveVisionMode` 纯决策。 |
| `packages/vision/vision/src/index.ts` | `agent/pre-step` 查 `resolveVisionMode`；按消息设 `imageAdmissionBypass`（仅纯文本介入时）；移除无条件 `agent/created` effect。 |

## 测试

- `packages/vision/vision/tests/vision.spec.ts` 新增 `resolveVisionMode` 表，覆盖上表四行（单测，无需 provider）。
- 既有 `vision.spec.ts` 全绿；宿主图片准入的 bypass 语义不受 `vision` 影响（宿主只读取 vision 设置的标志）。

## 影响

- 多模态模型默认不再被拖入冗余的 vision 子调用，原生看图。
- 纯文本模型保留原有行为（预处理 + bypass），除非其目录条目设 `vision: 'off'`。
- OCR（`@deepseek-ai/dsh-ocr`）不受影响，有独立注入路径，不读该标志。
- `imageAdmissionBypass` 现在仅在 vision 实际为纯文本模型剥离图片时按消息设置，恰好在需要处绕过宿主纯文本拒绝，且绝不为原生看图模型设置。
