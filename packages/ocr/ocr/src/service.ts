/**
 * OCR Service Definition.
 *
 * Owns the OCR capability seam's Service Definition role: it holds the resolved
 * deployment `OcrConfig` and orchestrates recognition of entering user messages
 * through the registered `LlmRuntime`. Concrete wiring into the agent loop lives
 * in the consumer listener (see `./index.ts`), which calls {@link OcrService.preprocess}.
 *
 * @module @deepseek-ai/dsh-ocr/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { OcrConfig } from './config.ts'
import type { OcrMode } from './types.ts'
import { preprocessMessage } from './ocr.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** OCR preprocessing service, exposed after the plugin is mounted. */
    ocr: OcrService
  }
}

/** OCR capability service: recognizes images in entering user messages and injects the text. */
export class OcrService extends Service {
  /** Resolved deployment configuration. */
  private readonly config: OcrConfig
  /** Master switch: whether OCR preprocessing is active for this deployment. */
  readonly enabled: boolean
  /** Backfill policy, read by host admission to know whether images are stripped before the model. */
  readonly mode: OcrMode

  /**
   * @param ctx - the registrant context; must carry an `LlmRuntime` for the OCR engine.
   * @param config - validated OCR configuration.
   */
  constructor(ctx: Context, config: OcrConfig) {
    super(ctx, 'ocr')
    this.config = config
    this.enabled = config.enabled
    this.mode = config.mode
  }

  /**
   * Preprocess entering user messages before they are logged.
   * @param messages - the messages about to enter the step (frozen).
   * @param signal - cancellation carried from the entering step into OCR sub-calls.
   * @returns the same messages when disabled or image-free, otherwise fresh frozen
   *   `UserMessage`s with recognized text folded in.
   */
  async preprocess(messages: readonly UserMessage[], signal: AbortSignal): Promise<UserMessage[]> {
    if (messages.length === 0) return [...messages]
    const llm = this.ctx.llm
    const out: UserMessage[] = []
    for (const message of messages) {
      out.push(await preprocessMessage(message, this.config, llm, this.ctx.attachments, signal))
    }
    return out
  }
}
