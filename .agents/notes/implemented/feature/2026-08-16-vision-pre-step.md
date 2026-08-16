# Agent Note: Image understanding (vision) pre-step plugin

Status: implemented

English | [中文](2026-08-16-vision-pre-step.zh.md)

## Problem

Uploaded images (e.g. a cartoon penguin) were answered off-topic by the text-only model. Diagnosis confirmed the OCR pre-step plugin itself worked: the original image bytes reached the qwen vision model intact, but the model returned a **filename hallucination** (`微信图片_202...`) for an image that contained no real text. Pixel-level OCR (tesseract) found no readable text in the file either.

Root cause: the plugin was positioned as **OCR** (text-only). A text-free image is outside that contract, so the vision model filled the gap with a plausible-but-fabricated filename, and that fabricated text was fed to the real model. The fix is not a config or wiring change; it is a repositioning of the plugin.

## Decision

Add `@deepseek-ai/dsh-vision`, an independent plugin mounted on `agent/pre-step`, replacing the OCR plugin in the user's runtime config. The vision model is asked to **describe the whole picture**: transcribe visible text when present, otherwise describe what is shown — and explicitly **not invent a filename or caption** that is absent from the image. This removes the text-free-image blind spot that produced the hallucination.

The plugin reuses the OCR plugin's structure (`Service Definition` + `agent/pre-step` waterfall listener) and the same `LlmRuntime` vision engine, with config fields renamed to the `vision*` namespace (`visionProvider`, `visionModel`, `visionPrompt`, `visionProvenance`, `mode`, `enabled`, `onFailure`). `visionPrompt` defaults to a faithful-description instruction; `visionProvenance` defaults to `[Image understanding]\n` (the injected marker in `replace` mode). `mode` defaults to `replace` so a text-only model still consumes the image via the description, matching the OCR plugin's prior default.

The OCR plugin (`@deepseek-ai/dsh-ocr`) is kept in the tree but no longer mounted at runtime; its temporary `ocr-debug.log` diagnostic code was removed.

## Surface changes

| Surface | Responsibility |
| --- | --- |
| `packages/vision/vision` | `@deepseek-ai/dsh-vision`: `VisionService` (Service Definition) + `agent/pre-step` listener. |
| `packages/ocr/ocr` | Retained, unmounted; debug logging removed from `ocr.ts`. |
| `tsconfig.base.json` | Added `./packages/vision/*/src` to the `@deepseek-ai/dsh-*` path map. |
| `tsconfig.host.json` | Added `./packages/vision/vision` to the host aggregate references. |
| `~/.dsh/cordis.patch.yml` | Replaced the `ocr` insert with a `vision` insert (dashscope / qwen3.8-max / replace / pass). |

## Testing

- `packages/vision/vision/tests/vision.spec.ts` covers `collectImages`, `replace`, `append`, image-free pass-through, multiple images, `onFailure` (`pass`/`skip`/`throw`), the `enabled` gate, default vs configured `visionPrompt`, provider/model routing, and that the rebuilt message is a fresh frozen `UserMessage` — using a fake `LlmRuntime` and frozen `UserMessage` fixtures, no real provider.

## Consequences

- Same as the OCR pre-step: runs once at submission, permanent in the log; changing the prompt or model does not revise past sessions.
- The hallucination class (invented filenames for text-free images) is addressed by the prompt contract, not by code; a vision model that violates it still needs a prompt or model change.
- A keyless assembled-app snapshot with a real vision provider remains out of scope (needs a credentialed model).
