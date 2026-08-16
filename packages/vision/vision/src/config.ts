/**
 * Vision plugin configuration.
 *
 * Every field that varies by deployment is a validated `Config` member; nothing
 * about the vision route or policy is hardcoded. Missing required fields fail
 * loud at load time, before any request reaches the engine.
 *
 * The plugin registers {@link Config} under the `dsh-vision` settings namespace
 * (see `./index.ts` `installSettingsSection`): the entry config in cordis.yml is the
 * base layer and user overrides in `settings.yaml` / the UI form the user layer.
 *
 * @module @deepseek-ai/dsh-vision/config
 */

import z from '@deepseek-ai/schemastery'
import type { VisionMode, VisionOnFailure } from './types.ts'

/** Resolved, validated vision plugin configuration. */
export interface VisionConfig {
  /** Vision model provider route, reused through the registered `LlmRuntime` routing. Defaults to `dashscope`. */
  visionProvider: string
  /** Vision model id. Defaults to `qwen3.8-max`. */
  visionModel: string
  /** System prompt sent to the vision model. Optional; a sane default asks for a faithful picture description. */
  visionPrompt?: string
  /**
   * `max_tokens` sent to the vision sub-call. Optional; when unset the request carries no `max_tokens`
   * and the vision model's own output ceiling applies (qwen3.8-max: 128K). Set it to raise the cap for
   * long screenshots whose full transcription would otherwise be cut off at the model default.
   */
  visionMaxTokens?: number
  /**
   * Marker prepended to the description in `replace` mode so the downstream model knows the text came
   * from an image. Optional; an empty string disables it.
   */
  visionProvenance?: string
  /** Backfill policy: `replace` swaps the image block for text, `append` keeps the image and adds text. */
  mode: VisionMode
  /** Master switch; when false the pre-step listener passes messages through untouched. Default true. */
  enabled: boolean
  /** Vision failure policy: `pass` keeps the image, `throw` aborts the step, `skip` drops the image. Default `pass`. */
  onFailure: VisionOnFailure
}

/** Default system prompt when `visionPrompt` is not configured. */
export const DEFAULT_VISION_PROMPT =
  'You are a vision assistant. Describe the content of the image faithfully and concisely. '
  + 'If the image contains visible text, transcribe it accurately. '
  + 'If the image contains no text, describe what is shown: subjects, setting, actions, and any notable detail. '
  + 'Never invent a filename, caption, or any text that does not appear in the image. '
  + 'Output only the description, with no preamble.'

/** Default vision provider used when the `dsh-vision` settings section has no user override. */
export const DEFAULT_VISION_PROVIDER = 'dashscope'
/** Default vision model used when the `dsh-vision` settings section has no user override. */
export const DEFAULT_VISION_MODEL = 'qwen3.8-max'

/** Default provenance marker prepended to the description in `replace` mode. */
export const DEFAULT_VISION_PROVENANCE = '[Image understanding]\n'

/**
 * Loader schema for {@link VisionConfig}.
 *
 * `visionProvider` / `visionModel` carry schema defaults so the plugin boots even when the
 * `dsh-vision` settings section has no base or user layer (e.g. `cordis.patch.yml` carries no
 * `config`); the real deployment values come from `settings.yaml` / the UI, which override these.
 * `mode` / `enabled` / `onFailure` also default, matching the documented fallback contract.
 */
export const Config: z<VisionConfig> = z.object({
  visionProvider: z.string().default(DEFAULT_VISION_PROVIDER),
  visionModel: z.string().default(DEFAULT_VISION_MODEL),
  visionPrompt: z.string(),
  visionMaxTokens: z.number().step(1).min(1),
  visionProvenance: z.string(),
  mode: z.union(['replace', 'append']).default('replace'),
  enabled: z.boolean().default(true),
  onFailure: z.union(['pass', 'throw', 'skip']).default('pass'),
})
