# Agent Note: selectModel image admission tracks configured pre-steps

Status: implemented

English | [中文](2026-08-16-selectmodel-image-admission.zh.md)

## Problem

After the per-model vision opt-in landed, `LlmResolvedModelInfo.vision` reached the vision pre-step but the host's `selectModel` admission still rejected a text-only selection whenever the session already contained image content. Repro: a session that had received an image under a multimodal model, then the user switches to a `vision: 'on'` text-only model. `selectModel` returned `model-unavailable` and the switch never happened, even though the vision pre-step would have folded the images into text on the next prompt and `agent.imageAdmissionBypass` would have been set as a side effect. The user could not pick a model that would obviously work.

The root cause: `selectModel` consulted only `agent.imageAdmissionBypass`, the effect the vision pre-step writes *after* its next run, and ignored the configured pre-step entirely. The `prompt` admission path correctly folded OCR `enabled && mode === 'replace'` into its check, but it never consulted the vision service — the two paths had drifted on what "strips images before the model sees them" meant.

A second, latent bug surfaced while fixing the first: `LlmRuntime.resolveModelInfoFor` built `LlmResolvedModelInfo` from the adapter's `resolveModel(...)` result and dropped the `vision` field, so even a vision-aware `selectModel` would have seen `info.vision === undefined`. The deepseek adapter and the catalog model entry were correct; the runtime was the silent dropper.

## Decision

Make image admission in both paths consult the same configured pre-step state, and plug the field all the way through:

- New local helper `imageStrippingPreStepConfigured(ctx, modelInfo)` in `packages/host/apiproxy/src/api-proxy.ts`. It returns `true` when an OCR pre-step is `enabled && mode === 'replace'`, or a vision pre-step is `enabled && mode === 'replace'` and `resolveVisionMode(modelInfo.vision, isMultimodal).bypass` is `true` for the target model. Both `selectModel` and `prompt` admission use it; the runtime effect `agent.imageAdmissionBypass` is OR-aggregated at each call site so future writers cannot drift the static check from the runtime signal.
- `LlmRuntime.resolveModelInfoFor` now passes `resolved.vision` through into `LlmResolvedModelInfo`, matching the other capability fields (modality, context, max tokens, reasoning). The deepseek adapter's `modelInfo()` and `resolveModel()` were already correct; the runtime was the leak.
- `apiproxy` gained `@deepseek-ai/dsh-vision` as a runtime dep (and `import { resolveVisionMode }`) plus a `vision` `tsconfig` reference and a type-only side-effect import so `ctx.get('vision')` resolves. The vision service is optional, so the field is read with `ctx.get` and tolerates an absent service.

The helper is the single source of truth for "would a configured pre-step strip this image before the model sees it?" — `selectModel` and `prompt` cannot disagree on what they admit.

## Scope correction: history images are not strippable

A follow-up bug (pi-ai 400 on `qwen3.7-max` after switching from a multimodal model) proved the helper's scope had to be narrower than "all images". A pre-step runs only on messages that **enter** a step — `agent/pre-step` receives the claimed inbox messages, and its `enter` decision is appended to the session. Images already persisted in the session's derived history (e.g. sent while a multimodal model was active, so vision's per-model inference correctly declined to preprocess) are frozen at their own entry and **cannot be revisited** by a pre-step. The vision README states this contract: "Vision runs once at message submission and is logged permanently; it is not re-run on later steps."

Admission therefore distinguishes two image populations:

- **Entering images** (`pendingImage` in `selectModel`, `hasImage` in `prompt`): a configured replace pre-step strips them before the model call, so a text-only target admits them.
- **History images** (`messagesHaveImage(session.deriveMessages())`): persisted at their own entry, not reachable by any pre-step, and compaction is the sanctioned way to clear them (`2026-07-29-atomic-web-image-admission.md`: "Compaction can make a text-only target valid once no pending or derived image remains"). A text-only target refuses whenever a history image remains, even with vision/OCR replace composed.

Both `selectModel` and `prompt` admission enforce this: `textOnly && (historyHasImage || !stripsEntering)` refuses. The error message names compaction as the fix, so the refusal is actionable rather than a dead end.

## Why a helper, not inline logic at each call site

Two inline copies of the same OCR + vision check would re-create the drift that produced the bug. A local helper (one file, two call sites, two short lines per call site) keeps the lockstep mechanically cheap.

## Surface changes

| Surface | Change |
| --- | --- |
| `packages/host/apiproxy/src/api-proxy.ts` | `imageStrippingPreStepConfigured(ctx, modelInfo)`. `selectModel` and `prompt` admission call it for **entering** images only, and refuse a text-only target while a history image remains. New `vision` side-effect import + `resolveVisionMode` value import. |
| `packages/host/apiproxy/package.json` | `dependencies: @deepseek-ai/dsh-vision: workspace:^`. |
| `packages/host/apiproxy/tsconfig.json` | `references: { path: '../../vision/vision' }`. |
| `packages/llm/llm/src/index.ts` | `resolveModelInfoFor` copies `resolved.vision` into the `LlmResolvedModelInfo` it builds; `listModels` copies `model.vision` into the `LlmModelInfo` it emits. |
| `packages/host/apiproxy/tests/api-proxy-models.spec.ts` | Renamed the refuse case to spell out the no-pre-step precondition. Cases: vision replace admits entering-only images, vision replace refuses history images, OCR replace refuses history images, vision append still refuses, vision `'off'` on the target model still refuses. New `registerVisionOffTextOnly` helper. |

## Testing

- `api-proxy-models.spec.ts` (apiproxy): 20 / 20 pass. The new entering/history distinction is locked by the split cases.
- `vision/vision/tests`: 21 / 21 pass. The `LlmResolvedModelInfo.vision` passthrough does not change vision's per-model decision.
- `llm/llm/tests`: 623 pass. The passthrough is covered by the new apiproxy cases; llm's own tests confirm no regression in the LlmAdapter contract.
- `llm/llm-deepseek/tests`: 152 pass; `llm/llm-pi-ai/tests`: 211 pass. Both adapters carry the `vision` field through `resolveModel`/`listModels`.
- oxlint clean on all changed files.

## Consequences

- A user can switch to a `vision: 'on'` text-only model and send **new** images; admission sees the configured vision pre-step and accepts, and the pre-step strips them on the next prompt.
- A session whose **history** already contains images (sent under a multimodal model) refuses a text-only switch, because no pre-step can revisit those persisted blocks. The refusal message points at compaction or an image-capable model. This matches the atomic-web-image-admission design.
- The two admission paths share their static strip decision and their history-image policy; future pre-step authors only need to extend `imageStrippingPreStepConfigured` to be honored at both switch-time and prompt-time.
- `LlmResolvedModelInfo.vision` is now reliably visible to any host that resolves model info, not just the vision pre-step.
- The pre-step is no longer load-bearing for the user to be able to *pick* a model: admission consults the configuration directly, so the model-selection UI no longer depends on a prior prompt having run.
