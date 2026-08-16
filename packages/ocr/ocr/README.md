# @deepseek-ai/dsh-ocr

English | [中文](README.zh.md)

Image OCR pre-step plugin. It recognizes images carried in user messages that are about to enter an agent step, using a configured vision model, and folds the recognized text back into the message before the message is written to the session log.

The plugin mounts on the `agent/pre-step` seam — the only point where a plugin may rewrite the messages that enter a step. Because the recognized text becomes part of the entered `user/message` session event, it is both model-visible and reconstructable, satisfying the harness "Model-visible ⟺ logged" rule. It is the sanctioned seam for injecting OCR output: the `llm/stream` request is deep-frozen and may not be rewritten, and a `llm/stream` listener would inject content that never reaches the log.

## Route and failure contract

OCR runs through the registered `LlmRuntime` as a normal sub-call: `provider`/`model` come from `ocrProvider`/`ocrModel`, the image block is forwarded unchanged (the adapter resolves the bytes from the attachment reference), and `ocrPrompt` becomes the system prompt. The real model never sees this sub-call, so no recursion guard is needed.

When a message has no image block, the pre-step listener returns `next()` untouched — zero overhead. When OCR yields no usable text, `onFailure` decides: `pass` keeps the original image, `skip` drops it (replace mode only; append mode has no text to add), `throw` aborts the step.

After OCR, the entered message is rebuilt with `createUserMessage` (deep-frozen). In `replace` mode the image block is swapped for a `text` block; in `append` mode the image is kept and a recognized-text `text` block is inserted right after it. The injected text carries `source.kind: 'plugin'` (`plugin: 'dsh-ocr'`, `form: 'notice'`), distinguishing OCR output from the original user image.

## Configuration

Every field varies by deployment and is validated at load; missing required fields fail loud.

| Key | Contract |
|---|---|
| `ocrProvider` | OCR engine provider route, reused through the registered `LlmRuntime` routing. Required. |
| `ocrModel` | OCR engine model id. Required. |
| `ocrPrompt` | System prompt sent to the OCR model. Optional; a sane default asks for verbatim plain text. |
| `ocrProvenance` | Prefix prepended to recognized text in `replace` mode, signaling the downstream model that the text came from an image. Optional; default `[Image OCR result]\n`; set to empty string to disable. |
| `mode` | `replace` swaps the image for text; `append` keeps the image and adds text. Required. |
| `enabled` | Master switch; when `false` the listener passes messages through. Default `true`. |
| `onFailure` | `pass` keeps the image, `throw` aborts, `skip` drops the image on recognition failure. Default `pass`. |

## Usage

The OCR plugin is **not mounted by default**. Add it to a Cordis configuration and route a vision model before it affects incoming messages. The plugin exposes its capability through `ctx.get('ocr')`; hosts (e.g. `apiproxy`) read `ocr.enabled` / `ocr.mode` to decide whether the upload gate lets a text-only main model send images.

### 1. Mount the plugin in a profile / patch

Add the following as an `insert` entry to your Cordis configuration (a profile's `cordis.yml`, or a user-level patch such as `~/.dsh/cordis.patch.yml`):

```yaml
- insert:
    - id: ocr
      name: '@deepseek-ai/dsh-ocr'
      config:
        ocrProvider: dashscope        # reuse a registered LlmRuntime provider route
        ocrModel: qwen3.7-plus        # a vision-capable model (the OCR engine)
        mode: replace                 # replace | append
        onFailure: pass               # pass | skip | throw
        # ocrPrompt: custom system prompt (optional)
        # ocrProvenance: 'Image OCR result:\n'   # custom prefix (optional)
```

`ocrProvider` / `ocrModel` point at a **vision-capable** model (the OCR engine), which may differ from the downstream text-only main model. Config is validated at load; missing `ocrProvider` / `ocrModel` / `mode` fails loud.

### 2. Start and trigger

```sh
pnpm dsh --profile web        # the profile with OCR enabled
```

Upload an image in the web UI and send. On `agent/pre-step`, before the message is logged:

1. Each image is recognized via one sub-call using `ocrProvider`/`ocrModel` (invisible to the real model);
2. Recognized text is folded back per `mode` — `replace` swaps the image for `[Image OCR result]\n<text>`, `append` keeps the image and appends a text block;
3. The rebuilt message is logged as the `user/message` session event and is visible to the downstream model.

### 3. Confirm OCR fired

- Session log `~/.dsh/sessions/<cwd>/session-*/session.jsonl.zstd`: in the stepping `user/message` the image block is gone (replace mode) and `content` carries the `[Image OCR result]`-prefixed text.
- A downstream text-only model (e.g. `qwen3.7-max`, whose adapter rejects image blocks) receives text without a 400 — that proves OCR replacement worked.
- Test with a **real image** (photo / text screenshot / diagram); a terminal screenshot is a weaker demo because the model sees terminal text and may say "no image attached".

### 4. Common scenarios

- **OCR layer for a text-only model**: `mode: replace` + `ocrProvenance` prefix. The image is removed before the main request, so the text-only model gets only text and avoids the "model does not support images" 400.
- **Vision model should also see the image**: `mode: append` keeps the image and appends recognized text after it (the main model must itself accept image input).
- **Recognition failure must not block the chat**: `onFailure: pass` (default) keeps the image; `skip` drops the image with no text; `throw` aborts the step.

> OCR runs once at message commit and is persisted; changing `ocrPrompt` / `ocrModel` / `ocrProvenance` does not retroactively affect existing sessions — verify changes in a **new session**.

## Model Experience

### OCR-preprocessed entering message

#### What the model sees

The real model receives the entered user message after pre-step: for `replace` mode, the image is gone and only the recognized `text` block remains; for `append` mode, the image block is followed by a plugin-source `text` block carrying the recognized text. The OCR sub-call itself is invisible to the real model.

#### Token effect

OCR adds one auxiliary recognition request per image (consuming tokens per image size and OCR output) plus the injected text tokens on the real request. Recognition runs once per message submission and is then permanent in the log; later `ocrPrompt`/model changes do not retroactively affect existing sessions.

#### KV Cache effect

No main-request invalidation from the OCR sub-call. With `replace` mode the image is removed before the real request, so vision-capable but token-expensive image handling is replaced by cheaper text for text-only models (e.g. DeepSeek, whose adapter rejects image blocks).

## Known Limitations and Deferred Work

- OCR runs once at message submission and is logged permanently; it is not re-run on later steps, so changing `ocrPrompt` or `ocrModel` does not revise past sessions.
- `skip` only removes the image in `replace` mode; in `append` mode a failed image is kept (there is no text to append).
- The plugin forwards the image block to the OCR engine unchanged; provider-specific multi-image batching, region selection, and language hints are not currently exposed and would be OCR-engine `Config` additions.
- No keyless snapshot ships in this package; reproduce "user sends image → real model receives OCR text" through a runnable `cordis.yml` bundle with a real OCR-capable provider.
