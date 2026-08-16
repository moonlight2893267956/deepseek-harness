# Agent Note：pi-ai vision 开关接线

状态：已实现

[English](2026-08-16-pi-ai-vision-opt-in.md) | 中文

## 问题

按模型 vision 开关落到 deepseek adapter 之后，向纯文本 pi-ai 模型（`qwen3.7-max`）发图仍报 `pi-ai model "qwen3.7-max" does not support image input`——该错误来自 pi-ai adapter 自己的 stream 路径，而非宿主准入。宿主已放行（`imageStrippingPreStepConfigured` 看到 replace 模式的 vision pre-step），说明图片原样到达了模型：vision pre-step 从未真正剥图。

三个独立缺口叠加导致：

1. **pi-ai adapter 完全没有 `vision` 字段。** `PiAiModelProfile` 没有 `vision` 键，`settings.yaml` 里 `vision: 'on'` 被配置 schema 静默丢弃。即使推断路径本可工作，手写纯文本模型的 `vision: 'on'` 意图也直接丢了。
2. **`LlmRuntime.listModels` 丢弃 `vision`。** `resolveModelInfoFor`（已在 selectModel note 修复）透传了 vision，但 `packages/llm/llm/src/index.ts` 的 `listModels` 重建条目时只保留 `provider/id/name/description/inputModalities`，静默丢掉 `vision`。deepseek 与 pi-ai adapter 都产出了该字段，但 discovery 消费者看到的是空。
3. **deepseek 的 schema 与 resolve 步骤也丢 `vision`。** `catalogModel`（schemastery）没声明 `vision`，`resolveModels` 重建条目时只保留 `id/name/description/contextWindow/maxTokens`——即使模型条目配置了 `vision`，在到达 adapter 前就丢了。（deepseek 的 `modelInfo()`/`resolveModel()` 本就透传；泄漏在 adapter 上游。）

## 决策

把 deepseek adapter 的 vision 开关镜像到其余两个界面，保持 `LlmModelInfo.vision` / `LlmResolvedModelInfo.vision` 作为每个 provider 共同喂入的唯一 seam 字段：

- `packages/llm/llm-pi-ai/src/catalog.ts`：`PiAiModelProfile` 增加 `vision?: VisionModelMode`；`RouteCatalog` 增加并行的 `visionByModel: ReadonlyMap<string, VisionModelMode | undefined>`，在 materialization 时收集，镜像 `configuredMaxTokens` 的做法（pi-ai 的 `Model` 类型无法承载 harness 专属字段，因此抬出）。
- `packages/llm/llm-pi-ai/src/config.ts`：模型字段 schema 声明 `vision: z.union([z.const('on'), z.const('off')])`；`ResolvePiAiProviderProfile` 携带 `visionByModel`；解析时从 `catalog.visionByModel` 展开。
- `packages/llm/llm-pi-ai/src/adapter.ts`：`resolveModel` 与 `listModels` 读 `profile.visionByModel.get(model.id)`，模型声明了就在 seam info 上产出 `vision`。
- `packages/llm/llm/src/index.ts`：`listModels` 重建时拷贝 `model.vision` 进产出的 `LlmModelInfo`，堵上 discovery 泄漏。
- `packages/llm/llm-deepseek/src/index.ts`：`catalogModel` 声明 `vision`；`resolveModels` 重建条目时透传 `model.vision`。

两个 adapter 上 `undefined` 都保持推断默认：多模态原生看图（不预处理）、纯文本预处理。`'on'`/`'off'` 是显式覆盖，与 vision 插件 `resolveVisionMode` 的期望一致。

## 影响面

| 文件 | 改动 |
| --- | --- |
| `packages/llm/llm-pi-ai/src/catalog.ts` | `PiAiModelProfile.vision`；`RouteCatalog.visionByModel`；materialization 收集。 |
| `packages/llm/llm-pi-ai/src/config.ts` | 模型字段 schema 声明 `vision`；`ResolvePiAiProviderProfile.visionByModel`；解析展开。 |
| `packages/llm/llm-pi-ai/src/adapter.ts` | `resolveModel` / `listModels` 从 `visionByModel` 产出 `vision`。 |
| `packages/llm/llm/src/index.ts` | `listModels` 把 `model.vision` 拷贝进产出的 `LlmModelInfo`。 |
| `packages/llm/llm-deepseek/src/index.ts` | `catalogModel` 声明 `vision`；`resolveModels` 透传。 |
| `packages/llm/llm-pi-ai/tests/catalog.spec.ts` | 新用例：模型 `vision` 开关到达 `resolveModelInfo` 与 `listModels`；未声明保持缺失。 |
| `packages/llm/llm-deepseek/tests/adapter.spec.ts` | 新用例：`vision` 开关同时到达 list 与 resolve 两个 seam；未声明保持缺失。 |

## 测试

- `llm-pi-ai/tests/catalog.spec.ts`：包内 211 测试全过，含新增 vision 透传用例。
- `llm-deepseek/tests/adapter.spec.ts`：包内 152 测试全过，含新增 vision 透传用例。
- `llm/llm/tests`：623 全过——`listModels` 重建改动由新 pi-ai/deepseek 用例覆盖，无回归。
- `vision/vision/tests`：21 全过——`resolveVisionMode` 行为未变。
- `host/apiproxy/tests/api-proxy-models.spec.ts`：18 全过。
- 五个改动包 `tsc -b`：0 错误。

## 后果

- 手写 pi-ai 纯文本模型配 `vision: 'on'` 后，vision pre-step 强制介入，图片在模型看到前被转为文本，纯文本 endpoint 不再收到它拒绝的图像块。
- 模型发现（`listModels`）与精确路由解析（`resolveModelInfo`）在两个 adapter 上对每个模型的 `vision` 标志一致；vision 插件通过 `agent.options.provider/model` + `resolveModelInfo` 读同一标志，select、prompt 准入、pre-step 三者看到同一个值。
- pi-ai 路由的 `visionByModel` 与 `configuredMaxTokens` 一样被收集——把 harness 专属事实从 pi-ai `Model` 类型抬出，未来 harness 新字段可沿用同一模式，无需改 pi-ai catalog 类型。
- DeepSeek 的 `resolveModels`（目录条目的显式 resolve 步骤）现在保留 `vision`，与 schema 一致；此前的泄漏意味着即使 schema 正确，条目也可能在到达 adapter 前被丢弃。
