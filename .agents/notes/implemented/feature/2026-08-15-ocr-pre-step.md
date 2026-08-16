# Agent Note: Image OCR pre-step plugin

Status: implemented

English | [中文](2026-08-15-ocr-pre-step.zh.md)

## Problem

A user message may carry image blocks, but a text-only model (e.g. DeepSeek, whose adapter throws typed `UNSUPPORTED_CONTENT` on any image) cannot consume them, and multimodal models waste tokens on pixels that a vision model could summarize as text. The harness needs a way to recognize images with a configured vision model and fold the text into the conversation before the real model sees it.

The interception point is constrained by two documented invariants:

- `llm/stream` requests arrive **deep-frozen** (mutation throws), and its JSDoc states listeners "read it, never rewrite it". A listener there cannot rewrite `messages`.
- `AGENTS.md` enforces **"Model-visible ⟺ logged"**: anything reaching a model request must be reconstructable from the session log; a new model-visible input requires a session event. Injecting OCR text at `llm/stream` would never reach the log, breaking replay, compaction, and the mandatory keyless snapshots.

`agent/request` returns only the routing config and carries no `messages`, so it cannot rewrite content either.

## Decision

Add `@deepseek-ai/dsh-ocr`, an independent plugin that registers an `agent/pre-step` waterfall listener — the only seam that rewrites the messages entering a step **before** they are written to the session log. Returning `{ kind: 'enter', messages }` from the listener folds the OCR text into the entered `UserMessage`, which is then appended as a real `user/message` event: model-visible and logged.

The OCR engine is the registered `LlmRuntime`, reused via `stream({ provider: ocrProvider, model: ocrModel, system: ocrPrompt, messages: [imageUserMessage] })`. The image block is forwarded unchanged; the adapter resolves bytes from the attachment reference. Because the OCR sub-call is dispatched through `LlmRuntime.stream` and not through `agent/pre-step`, no recursion guard is needed.

The entered message is rebuilt with `createUserMessage` (deep-frozen). In `replace` mode the image block is swapped for a `text` block; in `append` mode the image is kept and a recognized-text `text` block is inserted right after it. The injected text carries `source.kind: 'plugin'` (`plugin: 'dsh-ocr'`, `form: 'notice'`), distinguishing OCR output from the original user image.

Every deployment-varying choice is a validated `Config` field (`ocrProvider`, `ocrModel`, `ocrPrompt`, `mode`, `enabled`, `onFailure`); missing required fields fail loud at load. `onFailure` decides recognition-failure behavior: `pass` keeps the image, `throw` aborts the step, `skip` drops it (replace mode only).

### Seam change from the recorded plan

The plan on record proposed a `llm/stream` prepend listener. That point is wrong: it would throw on the frozen request and inject unlogged content. This change adopts `agent/pre-step` instead, which removes the plan's `AsyncLocalStorage` recursion-guard machinery entirely and makes OCR a one-time, logged, replayable step.

## Surface changes

| Surface | Responsibility |
| --- | --- |
| `packages/ocr/ocr` | `@deepseek-ai/dsh-ocr`: `OcrService` (Service Definition) + `agent/pre-step` listener. |
| `packages/llm/llm` | Unchanged; OCR reuses `LlmRuntime.stream`, `createUserMessage`, `deepFreeze`, `ImageBlock`. |
| `packages/attachment/attachment` | Unchanged; OCR reuses the attachment reference carried by the image block. |
| `packages/core/agent` | Unchanged; `agent/pre-step` already supported `enter` decisions (`goal-round-driver` precedent). |

No existing code path is modified; only a new plugin and config are added.

## Testing

- `packages/ocr/ocr/tests/ocr.spec.ts` covers `collectImages`, `replace`, `append`, image-free pass-through, multiple images, and `onFailure` (`pass`/`skip`/`throw`) plus the `enabled` gate, with a fake `LlmRuntime` and frozen `UserMessage` fixtures — no real provider, no recursion.
- A keyless assembled-app snapshot belongs in a runnable `cordis.yml` bundle with a real OCR-capable provider; this package does not ship that bundle because it requires a credentialed vision model.

## Consequences

- OCR runs once at message submission and is permanent in the log; changing `ocrPrompt` or `ocrModel` does not revise past sessions.
- `skip` only removes the image in `replace` mode; `append` mode keeps a failed image (no text to add).
- `replace` mode is the only path that lets a text-only model consume an image-bearing message, by removing the image before the real request.
- Provider-specific multi-image batching, region selection, and language hints are not exposed; they would be OCR-engine `Config` additions.
