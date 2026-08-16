/**
 * Vision Service Definition.
 *
 * Owns the vision capability seam's Service Definition role: it holds the
 * resolved deployment `VisionConfig` and orchestrates description of entering
 * user messages through the registered `LlmRuntime`. Concrete wiring into the
 * agent loop lives in the consumer listener (see `./index.ts`), which calls
 * {@link VisionService.preprocess}.
 *
 * @module @deepseek-ai/dsh-vision/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { VisionConfig } from './config.ts'
import type { VisionMode } from './types.ts'
import { preprocessMessage } from './vision.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Vision preprocessing service, exposed after the plugin is mounted. */
    vision: VisionService
  }
}

/** Vision capability service: describes images in entering user messages and injects the text. */
export class VisionService extends Service {
  /** Resolved deployment configuration. */
  private readonly config: VisionConfig
  /** Master switch: whether vision preprocessing is active for this deployment. */
  readonly enabled: boolean
  /** Backfill policy, read by host admission to know whether images are stripped before the model. */
  readonly mode: VisionMode

  /**
   * @param ctx - the registrant context; must carry an `LlmRuntime` for the vision engine.
   * @param config - validated vision configuration.
   */
  constructor(ctx: Context, config: VisionConfig) {
    super(ctx, 'vision')
    this.config = config
    this.enabled = config.enabled
    this.mode = config.mode
  }

  /**
   * Preprocess entering user messages before they are logged.
   * @param messages - the messages about to enter the step (frozen).
   * @param signal - cancellation carried from the entering step into vision sub-calls.
   * @returns the same messages when disabled or image-free, otherwise fresh frozen
   *   `UserMessage`s with descriptions folded in.
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
