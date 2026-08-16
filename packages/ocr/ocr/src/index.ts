/**
 * OCR pre-step plugin.
 *
 * Mounts the OCR `Service Definition` and wires it into the agent loop on the
 * `agent/pre-step` seam — the only point where a plugin may rewrite the user
 * messages that are about to enter a step, before they are written to the
 * session log. Recognized text therefore becomes a genuine `user/message`
 * event: model-visible and reconstructable, satisfying the harness
 * "Model-visible ⟺ logged" rule.
 *
 * @module @deepseek-ai/dsh-ocr
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { OcrConfig } from './config.ts'
import { OcrService } from './service.ts'

export type { OcrMode, OcrOnFailure, RecognizedImage } from './types.ts'
export type { OcrConfig } from './config.ts'
export { Config, DEFAULT_OCR_PROMPT } from './config.ts'
export { OcrService } from './service.ts'

/** Loader plugin name. */
export const name = 'ocr'
/** Services this plugin provides. */
export const provide = ['ocr']
/** Services this plugin consumes at mount (vendored Cordis reads `inject`, not `using`). */
export const inject = ['llm', 'attachments']

/**
 * Register the OCR service and the `agent/pre-step` listener.
 * @param ctx - the plugin context; carries `llm` (OCR engine) and `attachments`.
 * @param config - raw OCR configuration, validated by {@link Config} at load.
 */
export function apply(ctx: Context, config: OcrConfig): void {
  const resolved: OcrConfig = config
  // Constructing the service registers it on `ctx.ocr` (Cordis Service contract).
  new OcrService(ctx, resolved)

  ctx.on('agent/pre-step', async (
    payload: { agent: Agent; messages: UserMessage[]; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    if (!resolved.enabled) return next()
    const preprocessed = await ctx.ocr.preprocess(payload.messages, payload.signal)
    if (preprocessed === payload.messages) return next()
    return { kind: 'enter', messages: preprocessed }
  })
}
