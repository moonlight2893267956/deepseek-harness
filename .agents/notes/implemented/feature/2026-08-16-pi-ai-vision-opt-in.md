# Agent Note: pi-ai vision opt-in wiring

Status: implemented

English | [中文](2026-08-16-pi-ai-vision-opt-in.zh.md)

## Problem

After the per-model vision opt-in landed on the deepseek adapter, sending an image to a text-only pi-ai model (`qwen3.7-max`) still failed with `pi-ai model "qwen3.7-max" does not support image input` — raised by the pi-ai adapter's own stream path, not by host admission. The host had already admitted the request (the `imageStrippingPreStepConfigured` helper saw the composed vision pre-step in `replace` mode), so the images were reaching the model unchanged: the vision pre-step had never actually stripped them.

Three distinct gaps produced this:

1. **The pi-ai adapter did not carry the `vision` field at all.** `PiAiModelProfile` had no `vision` key, so a `vision: 'on'` entry in `settings.yaml` was silently dropped by the config schema. Even the inference path would have worked only if the runtime returned the model's true modalities — but a hand-declared text-only model's `vision: 'on'` intent was simply lost.
2. **`LlmRuntime.listModels` dropped `vision`.** `resolveModelInfoFor` (fixed in the selectModel note) passed `vision` through, but the `listModels` reconstruction in `packages/llm/llm/src/index.ts` rebuilt each entry with only `provider/id/name/description/inputModalities`, silently discarding `vision`. The deepseek adapter and the pi-ai adapter both produced the field, but discovery consumers saw it gone.
3. **The deepseek schema and resolve step dropped `vision` too.** `catalogModel` (schemastery) did not declare `vision`, and `resolveModels` rebuilt each model entry with only `id/name/description/contextWindow/maxTokens`, so even a model entry that configured `vision` lost it before the adapter ever saw it. (The deepseek `modelInfo()`/`resolveModel()` already passed it through; the leak was upstream of the adapter.)

## Decision

Mirror the deepseek adapter's vision opt-in across both remaining surfaces, keeping `LlmModelInfo.vision` / `LlmResolvedModelInfo.vision` the one seam field every provider feeds:

- `packages/llm/llm-pi-ai/src/catalog.ts`: `PiAiModelProfile` gains `vision?: VisionModelMode`; `RouteCatalog` gains a parallel `visionByModel: ReadonlyMap<string, VisionModelMode | undefined>` collected during materialization, mirroring `configuredMaxTokens` (the pi-ai `Model` type cannot carry harness-only fields, so they are lifted out).
- `packages/llm/llm-pi-ai/src/config.ts`: the model-fields schema declares `vision: z.union([z.const('on'), z.const('off')])`; `ResolvePiAiProviderProfile` carries `visionByModel`; resolution spreads it from `catalog.visionByModel`.
- `packages/llm/llm-pi-ai/src/adapter.ts`: `resolveModel` and `listModels` read `profile.visionByModel.get(model.id)` and emit `vision` on the seam info when the model declared one.
- `packages/llm/llm/src/index.ts`: `listModels` reconstruction now copies `model.vision` into the emitted `LlmModelInfo`, closing the discovery leak.
- `packages/llm/llm-deepseek/src/index.ts`: `catalogModel` declares `vision`; `resolveModels` passes `model.vision` through in its rebuilt entries.

`undefined` stays the inference default on both adapters: multimodal reads natively (no preprocessing), text-only preprocesses. `'on'`/`'off'` are explicit overrides, exactly as the vision plugin's `resolveVisionMode` expects.

## Surface changes

| Surface | Change |
| --- | --- |
| `packages/llm/llm-pi-ai/src/catalog.ts` | `PiAiModelProfile.vision`; `RouteCatalog.visionByModel`; materialization collects it. |
| `packages/llm/llm-pi-ai/src/config.ts` | Model-fields schema declares `vision`; `ResolvePiAiProviderProfile.visionByModel`; resolution spreads it. |
| `packages/llm/llm-pi-ai/src/adapter.ts` | `resolveModel` / `listModels` emit `vision` from `visionByModel`. |
| `packages/llm/llm/src/index.ts` | `listModels` copies `model.vision` into emitted `LlmModelInfo`. |
| `packages/llm/llm-deepseek/src/index.ts` | `catalogModel` declares `vision`; `resolveModels` passes it through. |
| `packages/llm/llm-pi-ai/tests/catalog.spec.ts` | New case: model `vision` opt-in reaches `resolveModelInfo` and `listModels`; absent stays absent. |
| `packages/llm/llm-deepseek/tests/adapter.spec.ts` | New case: `vision` opt-in reaches both the list and resolve seams; absent stays absent. |

## Testing

- `llm-pi-ai/tests/catalog.spec.ts`: 211 package tests pass, including the new vision-passthrough case.
- `llm-deepseek/tests/adapter.spec.ts`: 152 package tests pass, including the new vision-passthrough case.
- `llm/llm/tests`: 623 pass — the `listModels` reconstruction change is covered by the new pi-ai/deepseek cases and regresses nothing.
- `vision/vision/tests`: 21 pass — `resolveVisionMode` behavior is unchanged.
- `host/apiproxy/tests/api-proxy-models.spec.ts`: 18 pass.
- `tsc -b` on all five touched packages: 0 errors.

## Consequences

- A hand-declared pi-ai text-only model with `vision: 'on'` now forces the vision pre-step, which strips images into text before the model sees them, so a text-only endpoint never receives an image block it refuses.
- Model discovery (`listModels`) and exact-route resolution (`resolveModelInfo`) agree on the per-model `vision` flag on both adapters; the vision plugin reads the same flag through `agent.options.provider/model` + `resolveModelInfo`, so select, prompt admission, and the pre-step all see one value.
- The pi-ai route's `visionByModel` is collected like `configuredMaxTokens` — a harness-only fact lifted out of the pi-ai `Model` type — so a future harness field can follow the same pattern without touching pi-ai's catalog type.
- DeepSeek's `resolveModels` (the explicit resolve step for catalog entries) now preserves `vision`, matching its schema; the earlier leak meant even a correctly-schematized entry could be dropped before the adapter.
