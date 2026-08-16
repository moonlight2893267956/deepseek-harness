# Agent Note: Per-model vision opt-in

Status: implemented

English | [中文](2026-08-16-vision-model-opt-in.zh.md)

## Problem

The vision pre-step gated only on the deployment-wide `enabled` master switch and ignored the selected model's `inputModalities`. Every agent with vision enabled was dragged through the vision sub-call, so a model that honestly declared `['text','image']` (it reads images natively) was still force-fed a vision-transcribed text block instead of seeing the image itself. That wastes a vision sub-call and, worse, discards the model's native multimodal capability.

## Decision

Add a three-valued `vision` flag on the model configuration entry, surfaced through the adapter-agnostic model metadata so every provider shares it:

- `VisionModelMode = 'on' | 'off'` lives in `@deepseek-ai/dsh-llm/src/types.ts`; `undefined` is the implicit "unset" state.
- `LlmModelInfo.vision?` and `LlmResolvedModelInfo.vision?` carry it; `DeepSeekCatalogModel.vision?` is the per-model config knob the catalog author sets.
- `resolveVisionMode(info, vision, isMultimodal)` (new `packages/vision/vision/src/resolve-vision-mode.ts`) is the pure decision function:

  | `vision` | model modality | intervene | bypass |
  | --- | --- | --- | --- |
  | `undefined` | multimodal | no | no |
  | `undefined` | text-only | yes | yes |
  | `'on'` | any | yes | `!isMultimodal` |
  | `'off'` | any | no | no |

- The vision `agent/pre-step` now reads `agent.options.{provider,model}`, calls `ctx.llm.resolveModelInfo(...)`, and consults `resolveVisionMode` before any image work. It sets `agent.imageAdmissionBypass` only when intervening on a text-only model (was previously set unconditionally on every agent when `enabled && mode === 'replace'` via an `agent/created` effect).

## Why three-valued, not boolean

`undefined` preserves the "infer from modality" default that fixes the multimodal problem without configuration; `'on'`/`'off'` are explicit overrides. A boolean would lock the multimodal default and force every catalog entry to pick a side.

## Surface changes

| Surface | Responsibility |
| --- | --- |
| `packages/llm/llm/src/types.ts` | `VisionModelMode`; `vision?` on `LlmModelInfo` / `LlmResolvedModelInfo`. |
| `packages/llm/llm-deepseek/src/adapter.ts` | `DeepSeekCatalogModel.vision?`; `modelInfo()` passes it through (`resolveModel` inherits via `modelInfo`). |
| `packages/vision/vision/src/resolve-vision-mode.ts` | New `resolveVisionMode` pure decision. |
| `packages/vision/vision/src/index.ts` | `agent/pre-step` consults `resolveVisionMode`; per-request `imageAdmissionBypass` (text-only intervene only); drops the unconditional `agent/created` effect. |

## Testing

- `packages/vision/vision/tests/vision.spec.ts` adds a `resolveVisionMode` table covering all four rows above (unit, no provider).
- Existing `vision.spec.ts` continues to pass; the host image-admission bypass semantics are unchanged and unaffected by `vision` (host only reads the flag vision sets).

## Consequences

- Multimodal models no longer incur a redundant vision sub-call by default; they read images natively.
- A text-only model keeps the prior behavior (preprocess + bypass) unless its catalog entry sets `vision: 'off'`.
- OCR (`@deepseek-ai/dsh-ocr`) is untouched; it has its own injection path and does not read this flag.
- `imageAdmissionBypass` is now set per message only when vision actually strips images from a text-only model, so the host's text-only rejection is bypassed exactly when needed and never for a model that natively reads images.
