# Agent Note: Vision configuration UI (dsh-vision settings section)

Status: implemented

English | [中文](2026-08-16-vision-settings-section.zh.md)

## Problem

Vision deployment config (`visionProvider` / `visionModel` / `mode` / `onFailure` / `visionMaxTokens` / `visionPrompt` / `visionProvenance` / `enabled`) lived in hand-edited `~/.dsh/cordis.patch.yml` as a static `insert` `config`. Editing it meant knowing the YAML shape, hand-writing tunables, and restarting the host. The plugin also held the resolved config in a closed closure, so even a settings-driven change would not reach the `agent/pre-step` listener without a reload.

## Decision

Wire the plugin into the settings capability seam, mirroring `llm-pi-ai`: `apply` calls `installSettingsSection(ctx, NS, Config, entry, { setSource, onChange })`, where `NS = settingsNamespace('dsh-vision')` and `entry` is the cordis.yml `config` (the base layer). The user layer comes from `settings.yaml` / the web UI. When the settings service is absent (headless without a provider), the section falls back to `entry`, so no config is lost.

`VisionService` gained an `update(config)` method that refreshes its `config`, `enabled`, and `mode` fields. The `agent/pre-step` listener no longer reads a static snapshot: it reads the live `vision.enabled` / `vision.mode`, and `onChange` calls `vision.update(source())` on every attach/detach/commit. Because `enabled`/`mode` are read live, the host `imageAdmissionBypass` (set only in `replace` mode) and the intervention decision always reflect the latest value without a restart.

`visionProvider` / `visionModel` now carry schema defaults (`dashscope` / `qwen3.8-max`), so an empty base layer validates; the real deployment values come from the user layer. `mode` / `enabled` / `onFailure` already defaulted. This lets `~/.dsh/cordis.patch.yml` drop the vision `config` entirely — only the plugin `insert` row remains.

The web UI renders a **Vision understanding** card on the Model settings page (`@deepseek-ai/dsh-client-ui-settings-models`). It reads the `dsh-vision` namespace view from the shared `ModelsSettingsStore`, renders each field, and writes immediately through `api.settings.mutate` (`set`/`unset`). Empty values `unset` back to the base layer rather than writing `null`. Fields carrying a user override show an amber dot; a per-field reset unsets that path, and "Reset all customized" clears every override. The store re-describes on every settings invalidation, so the form reflects external edits live.

## Verification

`packages/vision/vision/tests/settings.spec.ts` pins: a user-layer change hot-updates `vision.enabled` / `vision.mode` without restart; detach falls back to the entry; the namespace unregisters on plugin unload; and the section still mounts with no settings provider. `packages/client/ui-settings-models/tests/vision-section.client.spec.tsx` pins field rendering, immediate `set`/`unset` writes, the override dot + reset, reset-all, and a rejected write surfacing the error without a false "saved" state. The host boots cleanly against a `~/.dsh/settings.yaml` carrying `dsh-vision`, and the served client plugin module contains the section.

## Alternatives considered

- **Keep config in cordis.patch.yml** — rejected: it is the hand-edited file the user wanted to stop editing, and a static `config` cannot hot-apply.
- **Read `settings.yaml` directly in the plugin** — rejected: it bypasses the settings seam's base/user/revision contract, the live `watch`, and the UI's single write path; the seam already owns this.
- **Hold resolved config in a mutable plugin-local field updated by a `watch` listener** — rejected in favor of `VisionService.update` driven by the section hook, so the listener and the service share one source and the hook already runs on attach/detach/commit.
- **Make `visionProvider`/`visionModel` required with no default** — rejected: it would force every `cordis.patch.yml` to carry a `config` (contradicting the "drop config" goal) and break headless boots without a settings layer.

## Consequences

- Vision config is edited from the web UI and persisted to `~/.dsh/settings.yaml` (`dsh-vision`), hot-applying without a host restart.
- `~/.dsh/cordis.patch.yml` carries only the vision plugin `insert` row.
- The schema defaults mean an unconfigured deployment still boots with `dashscope` / `qwen3.8-max`; the web UI shows those as the inherited values until overridden.
- The plugin still fails loud at load when the resolved config violates a field contract (e.g. a non-positive `visionMaxTokens`), preserving the misconfiguration-fails-loud rule.
