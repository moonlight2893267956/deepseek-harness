# Agent Note: vision image admission bypass for text-only models

Status: implemented

English | [中文](2026-08-16-vision-image-admission-bypass.zh.md)

## Problem

A text-only model (e.g. `deepseek-v4`) declares `inputModalities: ['text']`. The host image
admission in `packages/host/apiproxy/src/api-proxy.ts` rejects image-bearing input for such a
model **before** the `agent/pre-step` waterfall runs. Because the vision pre-step (which converts
images to text) lives downstream of admission, images were refused at the door and the vision plugin
never got a chance to strip them — the user saw "the current model does not support images".

Two wrong fixes were considered and rejected:

- **Declare the vision model as multimodal** (`inputModalities: ['text','image']`): this is a
  dishonest capability claim. The negative-capability signal exists so the host refuses images
  early instead of failing at the serializer; lying about it lets a non-vision session accept
  images and then break. Reverted.
- **Unconditionally route every model through vision**: that conflates multimodal and text-only
  models. A multimodal model (e.g. `qwen-vl`) already admits images and should keep seeing them
  natively; forcing a vision rewrite on it wastes a round-trip and loses image fidelity.

## Decision

Keep the model capability signal honest, and let an image-rewriting pre-step opt a specific agent
out of the text-only rejection. The contract:

- `packages/core/agent/src/runtime-types.ts` adds an optional `imageAdmissionBypass?: true` to the
  `Agent` interface. It is a read-only host-admission signal set by a pre-step plugin, never by the
  model catalog.
- `packages/vision/vision/src/index.ts` registers it on each agent when `enabled && mode === 'replace'`
  (via an `agent/created` effect): in `replace` mode the image is gone before the model sees the
  message, so admission is safe.
- `packages/host/apiproxy/src/api-proxy.ts` admits images when
  `info.inputModalities.includes('image')` **or** `agent.imageAdmissionBypass === true`, at both the
  `selectModel` and `prompt` admission points. The OCR pre-step (`ctx.get('ocr')`) keeps its existing
  bypass for parity; the two seams are independent and either one suffices.

A multimodal model still passes on its own `inputModalities` and never reads `imageAdmissionBypass`;
a text-only model without a stripping pre-step is still refused. The distinction is preserved.

## Surface changes

| Surface | Responsibility |
| --- | --- |
| `packages/core/agent/src/runtime-types.ts` | `Agent.imageAdmissionBypass?: true` merge-extensible signal. |
| `packages/vision/vision/src/index.ts` | Sets `imageAdmissionBypass` on `agent/created` when `enabled && mode === 'replace'`. |
| `packages/host/apiproxy/src/api-proxy.ts` | `selectModel` and `prompt` admission bypass the text-only rejection when the signal is set. |

## Testing

- `packages/host/apiproxy/tests/api-proxy-models.spec.ts` adds two cases: a text-only selection
  admits prompt images when `agent.imageAdmissionBypass` is set (vision `replace` path), and a
  text-only selection still refuses images with neither an OCR seam nor the bypass. The existing
  OCR `replace` admission case is unchanged.

## Consequences

- Vision `replace` now works end-to-end on a text-only model without lying about capabilities.
- `append` mode does **not** set the bypass: in `append` the original image survives to the model,
  so a text-only model must still reject it (correct — the model would receive an image it cannot read).
- The OCR and vision bypasses coexist; unifying them onto one seam is a later cleanup, not required
  for correctness.
