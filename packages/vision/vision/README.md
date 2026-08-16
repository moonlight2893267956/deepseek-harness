# @deepseek-ai/dsh-vision

English | [中文](README.zh.md)

Image understanding pre-step plugin. It describes images carried in user messages that are about to enter an agent step, using a configured vision model, and folds the description back into the message before the message is written to the session log.

Unlike a pure OCR engine, the vision model is asked to describe the whole picture: when the image contains visible text it transcribes that text, and when the image contains no text it describes what is shown. The system prompt forbids inventing a filename or caption that is absent from the image, so the downstream (often text-only) model is not fed a fabricated placeholder when an image has no text.

The plugin mounts on the `agent/pre-step` seam — the only point where a plugin may rewrite the messages that enter a step. Because the description becomes part of the entered `user/message` session event, it is both model-visible and reconstructable, satisfying the harness "Model-visible ⟺ logged" rule. It is the sanctioned seam for injecting image understanding: the `llm/stream` request is deep-frozen and may not be rewritten, and a `llm/stream` listener would inject content that never reaches the log.

## Route and failure contract

Vision runs through the registered `LlmRuntime` as a normal sub-call: `provider`/`model` come from `visionProvider`/`visionModel`, the image block is forwarded unchanged (the adapter resolves the bytes from the attachment reference), and `visionPrompt` becomes the system prompt. The real model never sees this sub-call, so no recursion guard is needed.

When a message has no image block, the pre-step listener returns `next()` untouched — zero overhead. When the vision model yields no usable text, `onFailure` decides: `pass` keeps the original image, `skip` drops it (replace mode only; append mode has no text to add), `throw` aborts the step.

After vision preprocessing, the entered message is rebuilt with `createUserMessage` (deep-frozen), keeping the original `source` so the description stays a genuine `user/message` event. In `replace` mode the image block is swapped for a `text` block carrying the description (prefixed by `visionProvenance`); in `append` mode the image is kept and a description `text` block is inserted right after it (no prefix).

## Configuration

Every field varies by deployment. The plugin registers a `dsh-vision` settings section: the entry `config` in cordis.yml (or the base bundle) is the **base** layer, and user overrides in `settings.yaml` (or the web UI) form the **user** layer. When the settings service is absent (e.g. a headless run without a settings provider), the section falls back to the entry config, so no config is lost. `visionProvider` / `visionModel` carry schema defaults (`dashscope` / `qwen3.8-max`) so an empty base still validates; the real deployment values come from the user layer.

| Key | Contract |
| --- | --- |
| `visionProvider` | Vision engine provider route, reused through the registered `LlmRuntime` routing. Optional; default `dashscope`. |
| `visionModel` | Vision engine model id. Optional; default `qwen3.8-max`. |
| `visionPrompt` | System prompt sent to the vision model. Optional; a sane default asks for a faithful picture description (transcribe text when present, otherwise describe the scene, never invent a filename). |
| `visionMaxTokens` | `max_tokens` cap sent to the vision sub-call. Optional; when unset the request carries no `max_tokens` and the vision model's own output ceiling applies (qwen3.8-max: 128K). Set it to raise the cap for long screenshots whose full transcription would otherwise be cut off at the model default. Must be a positive integer within the vision model's output ceiling. |
| `visionProvenance` | Prefix prepended to the description in `replace` mode, signaling the downstream model that the text came from an image. Optional; default `[Image understanding]\n`; set to empty string to disable. |
| `mode` | `replace` swaps the image for text; `append` keeps the image and adds text. Optional; default `replace`. |
| `enabled` | Master switch; when `false` the listener passes messages through. Default `true`. |
| `onFailure` | `pass` keeps the image, `throw` aborts, `skip` drops the image on recognition failure. Default `pass`. |

### Editing from the web UI

The "Model" settings page (hosted by `@deepseek-ai/dsh-client-ui-settings-models`) renders a **Vision understanding** card backed by the `dsh-vision` namespace. Each field writes through the wire immediately (`api.settings.mutate` set/unset), so a change hot-applies to the running plugin without a restart. A field carrying a user override shows an amber dot; clicking its reset unsets the one path back to the base layer, and "Reset all customized" clears every override. The live `VisionService.enabled` / `VisionService.mode` are updated by the settings section hook on every attach/detach/commit, so the `agent/pre-step` listener and host image admission always read the latest value.

## Per-model preprocessing opt-in

`enabled` is the deployment-wide master switch that decides whether the vision plugin is mounted at all. But different models in the same deployment often need different image handling — a multimodal main model should read images **natively**, while a text-only main model needs vision to turn them into text. Each model can declare a tristate `vision` flag in its catalog entry (e.g. `DeepSeekCatalogModel`, or the `models`/`modelOverrides` entries of a pi-ai route), which the vision `agent/pre-step` reads before intervening:

- **`undefined` (undeclared)**: inferred from the model's `inputModalities`. A multimodal model (contains `image`) does **not** intervene by default — it reads images natively and does not need vision preprocessing; a text-only model intervenes by default.
- **`'on'`**: force preprocessing, even for a multimodal main model (for deployments that want one vision engine everywhere).
- **`'off'`**: force no intervention, even for a text-only main model (images go through the host's normal admission; `imageAdmissionBypass` is not set).

`vision` is a decision input internal to the vision plugin and does not affect how the host reads `imageAdmissionBypass`. `resolveVisionMode(vision, isMultimodal)` is the pure function behind this decision. Both the deepseek and pi-ai adapters currently support declaring `vision` on a model entry (`on` / `off`); when undeclared, both infer from `inputModalities` with identical behavior.

```yaml
# Model entries in a provider's catalog (example: deepseek adapter)
models:
  - id: deepseek-chat
    vision: off          # explicit opt-out on a model that declares multimodal input
  # - id: some-multimodal-model   # undeclared vision -> no intervention (reads natively)
```

> Tristate rather than boolean: `undefined` keeps the "infer from modalities" default, so a multimodal model's default behavior is not locked down; `'on'` / `'off'` provide explicit overrides.

## Usage

The vision plugin is **not mounted by default**. Add it to a Cordis configuration and route a vision model before it affects incoming messages. The plugin exposes its capability through `ctx.get('vision')`. Whether the pre-step intervenes is decided per model by the deployment's master `enabled` switch plus the current model's `vision` opt-in (see "Per-model preprocessing opt-in" below). When it intervenes in `replace` mode for a **text-only** main model, it sets `agent.imageAdmissionBypass` (see `packages/core/agent`). Hosts read that signal to let a text-only main model admit image-bearing input: because the image is gone before the model sees the message, the text-only rejection is bypassed. A multimodal main model admits images on its own `inputModalities` and never consults the signal.

### 1. Mount the plugin in a profile / patch

Add the following as an `insert` entry to your Cordis configuration (a profile's `cordis.yml`, or a user-level patch such as `~/.dsh/cordis.patch.yml`). The plugin carries **no `config`** — deployment values live in the `dsh-vision` settings section (see "Configuration"):

```yaml
- insert:
    - id: vision
      name: '@deepseek-ai/dsh-vision'
      # visionProvider / visionModel / mode / onFailure / ... belong in settings.yaml (dsh-vision)
      # or the web UI "Model" page → "Vision understanding" card.
```

`visionProvider` / `visionModel` point at a **vision-capable** model (the vision engine), which may differ from the downstream text-only main model. With no settings layer present, the schema defaults (`dashscope` / `qwen3.8-max`) apply.

### 2. Start and trigger

```sh
pnpm dsh --profile web        # the profile with vision enabled
```

Upload an image in the web UI and send. On `agent/pre-step`, before the message is logged:

1. Each image is described via one sub-call using `visionProvider`/`visionModel` (invisible to the real model);
2. The description is folded back per `mode` — `replace` swaps the image for `[Image understanding]\n<text>`, `append` keeps the image and appends a description text block;
3. The rebuilt message is logged as the `user/message` session event and is visible to the downstream model.

### 3. Confirm vision fired

- Session log `~/.dsh/sessions/<cwd>/session-*/session.jsonl.zstd`: in the stepping `user/message` the image block is gone (replace mode) and `content` carries the `[Image understanding]`-prefixed text.
- A downstream text-only model (e.g. a model whose adapter rejects image blocks) receives text without a 400 — that proves vision replacement worked.
- Test with a **real image** (photo / text screenshot / diagram / a picture with no text at all); the no-text case is the one OCR could not cover — the vision model should describe the scene, not fabricate a filename.

### 4. Common scenarios

- **Text-only model should understand any image**: `mode: replace` + `visionProvenance` prefix. The image is removed before the main request, so the text-only model gets a description and avoids the "model does not support images" 400. For an image with no text, the description is the scene; for an image with text, the description includes the transcribed text.
- **Vision model should also see the image**: `mode: append` keeps the image and appends the description after it (the main model must itself accept image input).
- **Description failure must not block the chat**: `onFailure: pass` (default) keeps the image; `skip` drops the image with no text; `throw` aborts the step.

> Vision runs once at message commit and is persisted; changing `visionPrompt` / `visionModel` / `visionProvenance` does not retroactively affect existing sessions — verify changes in a **new session**.

## Model Experience

### Vision-preprocessed entering message

#### What the model sees

The real model receives the entered user message after pre-step: for `replace` mode, the image is gone and only the description `text` block remains; for `append` mode, the image block is followed by a description `text` block. The vision sub-call itself is invisible to the real model.

#### Token effect

Vision adds one auxiliary description request per image (consuming tokens per image size and description output) plus the injected description tokens on the real request. Description runs once per message submission and is then permanent in the log; later `visionPrompt`/model changes do not retroactively affect existing sessions.

#### KV Cache effect

No main-request invalidation from the vision sub-call. With `replace` mode the image is removed before the real request, so vision-capable but token-expensive image handling is replaced by cheaper text for text-only models.

## Known Limitations and Deferred Work

- Vision runs once at message submission and is logged permanently; it is not re-run on later steps, so changing `visionPrompt` or `visionModel` does not revise past sessions. Images persisted in history under a multimodal model (whose per-model inference declined preprocessing) therefore cannot be revisited later: host `selectModel`/`prompt` admission refuses a text-only target while a derived-history image remains, naming compaction as the clear — see the atomic-web-image-admission design.
- `skip` only removes the image in `replace` mode; in `append` mode a failed image is kept (there is no text to append).
- The image-admission bypass applies only to `replace` mode. In `append` mode the original image survives to the model, so a text-only main model must still reject the message (the `imageAdmissionBypass` signal is not set) — correct, because the model would receive an image it cannot read.
- The plugin forwards the image block to the vision engine unchanged; whether the model faithfully transcribes text vs. describes the scene is governed by the prompt contract, not by code — a vision model that violates the prompt still needs a prompt or model change.
- Provider-specific multi-image batching, region selection, and language hints are not currently exposed and would be vision-engine `Config` additions.
- No keyless snapshot ships in this package; reproduce "user sends image → real model receives a description" through a runnable `cordis.yml` bundle with a real vision-capable provider.
