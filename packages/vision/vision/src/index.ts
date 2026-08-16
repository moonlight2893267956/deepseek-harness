/**
 * Vision (image understanding) pre-step plugin.
 *
 * Mounts the vision `Service Definition` and wires it into the agent loop on
 * the `agent/pre-step` seam — the only point where a plugin may rewrite the
 * user messages that are about to enter a step, before they are written to the
 * session log. The description therefore becomes a genuine `user/message`
 * event: model-visible and reconstructable, satisfying the harness
 * "Model-visible ⟺ logged" rule.
 *
 * Unlike a pure OCR engine, the vision model is asked to describe the whole
 * picture: if the image carries text it transcribes it, otherwise it describes
 * what is shown. This keeps the downstream (often text-only) model from
 * hallucinating a filename or placeholder when an image has no text.
 *
 * @module @deepseek-ai/dsh-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { Config, type VisionConfig } from './config.ts'
import { NS, VisionService } from './service.ts'
import { resolveVisionMode } from './resolve-vision-mode.ts'

export type { VisionMode, VisionOnFailure, DescribedImage } from './types.ts'
export type { VisionConfig } from './config.ts'
export { Config, DEFAULT_VISION_PROMPT } from './config.ts'
export { NS, VisionService } from './service.ts'
export { resolveVisionMode } from './resolve-vision-mode.ts'
export type { VisionModeDecision } from './resolve-vision-mode.ts'

/** Loader plugin name. */
export const name = 'vision'
/** Services this plugin provides. */
export const provide = ['vision']
/** Services this plugin consumes at mount (vendored Cordis reads `inject`, not `using`). */
export const inject = ['llm', 'attachments']

/**
 * Register the vision service and the `agent/pre-step` listener.
 *
 * The deployment config is supplanted by the dsh-vision settings section: the
 * `entry` config passed at load becomes the `base` layer, while user overrides
 * in `settings.yaml` (or the UI) form the user layer. When the settings service
 * is absent (e.g. headless without a settings provider) the section falls back
 * to this `entry` value, so no config is lost.
 * @param ctx - the plugin context; carries `llm` (vision engine) and `attachments`.
 * @param config - raw vision configuration, validated by {@link Config} at load; used as the settings base layer.
 */
export function apply(ctx: Context, config: VisionConfig): void {
  // Dynamic authoritative config source. Until the settings section attaches it
  // equals the entry config; once attached it resolves from the settings layers.
  let source: () => VisionConfig = () => config
  const vision = new VisionService(ctx, config)
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (current) => { source = current },
    onChange: () => { vision.update(source()) },
  })

  ctx.on('agent/pre-step', async (
    payload: { agent: Agent; messages: UserMessage[]; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    if (!vision.enabled) return next()
    const { provider, model } = payload.agent.options
    if (!provider || !model) return next()
    const info = await ctx.llm.resolveModelInfo(provider, model)
    const isMultimodal = info.inputModalities?.includes('image') ?? false
    const decision = resolveVisionMode(info.vision, isMultimodal)
    if (!decision.intervene) return next()
    const preprocessed = await vision.preprocess(payload.messages, payload.signal)
    if (preprocessed === payload.messages) return next()
    // `replace` mode rewrites images into text before the model sees them, so image-bearing
    // input is admissible even on a text-only model. Only a text-only model needs the host's
    // image admission to bypass the text-only-model rejection (multimodal models read natively).
    if (decision.bypass) {
      Object.defineProperty(payload.agent, 'imageAdmissionBypass', { value: true, configurable: true })
    }
    return { kind: 'enter', messages: preprocessed }
  })
}
