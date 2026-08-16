/**
 * Vision preprocessing core.
 *
 * Scans entering user messages for image blocks, describes each image with a
 * configured vision model through the registered `LlmRuntime`, and folds the
 * description back into the message per {@link VisionMode}. The result is a
 * fresh set of `UserMessage`s built with `createUserMessage` (deep-frozen), so
 * the description enters the session log as a genuine `user/message` event —
 * model-visible and reconstructable.
 *
 * @module @deepseek-ai/dsh-vision/vision
 */

import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import {
  createUserMessage,
  type ImageBlock,
  type TextBlock,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { VisionConfig } from './config.ts'
import { DEFAULT_VISION_PROMPT, DEFAULT_VISION_PROVENANCE } from './config.ts'
import type { VisionMode } from './types.ts'

/** Whether a content block is an image block. */
function isImageBlock(block: { type: string }): block is ImageBlock {
  return block.type === 'image'
}

/**
 * Collect every image block in one user message, in order, alongside its owner message.
 * @param message - the entering user message to scan.
 * @returns the ordered image blocks carried by the message.
 */
export function collectImages(message: UserMessage): readonly ImageBlock[] {
  return message.content.filter(isImageBlock)
}

/**
 * Run one vision description sub-call for a single image and return the description.
 * @param image - the image block to describe.
 * @param config - resolved vision configuration (provider, model, prompt).
 * @param llm - the registered LLM runtime used as the vision engine.
 * @param signal - cancellation carried from the entering step.
 * @returns the trimmed, non-empty description text.
 * @throws when the vision engine yields no usable text.
 */
async function describeImage(
  image: ImageBlock,
  config: VisionConfig,
  llm: LlmRuntime,
  signal: AbortSignal,
): Promise<string> {
  // The vision sub-call is dispatched through the same LlmRuntime the real
  // model uses; it does not pass through `agent/pre-step`, so no recursion
  // guard is needed. The adapter resolves the image bytes from the attachment
  // reference.
  const subOptions: Parameters<LlmRuntime['stream']>[0] = {
    provider: config.visionProvider,
    model: config.visionModel,
    messages: [createUserMessage({ content: [image], source: { kind: 'user' } })],
    // A set cap overrides the vision model's own output ceiling — raise it for long
    // screenshots whose full transcription would otherwise be cut off (qwen3.8-max: 128K).
    ...config.visionMaxTokens === undefined ? {} : { maxTokens: config.visionMaxTokens },
    signal,
  }
  subOptions.system = config.visionPrompt ?? DEFAULT_VISION_PROMPT
  const chunks = llm.stream(subOptions)
  let text = ''
  for await (const chunk of chunks) {
    if (chunk.type === 'text-delta') text += chunk.text
    // block-end carries the authoritative assembled block; prefer it over the
    // deltas to avoid double-counting the same text.
    else if (chunk.type === 'block-end' && chunk.block.type === 'text') text = chunk.block.text
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new Error('vision: recognition returned no text')
  }
  return trimmed
}

/**
 * Fold the description into a message's content per the configured mode.
 * @param content - the original content blocks (frozen).
 * @param image - the image block the text was described from.
 * @param text - the described, non-empty text.
 * @param mode - replace the image with text, or append text after the image.
 * @param provenance - marker prepended to described text in `replace` mode.
 * @returns the new (unfrozen) content blocks.
 */
function applyVision(
  content: readonly (ImageBlock | TextBlock)[],
  image: ImageBlock,
  text: string,
  mode: VisionMode,
  provenance: string,
): (ImageBlock | TextBlock)[] {
  // In replace mode the image block is gone, so the downstream (text-only)
  // model needs an explicit signal that this text was produced from an image;
  // the provenance marker supplies it. Append mode keeps the image, so no marker.
  const textBlock: TextBlock = { type: 'text', text: mode === 'replace' ? `${provenance}${text}` : text }
  if (mode === 'replace') {
    return content.map(block => (block === image ? textBlock : block))
  }
  // append: keep the image, insert the description right after it.
  const out: (ImageBlock | TextBlock)[] = []
  for (const block of content) {
    out.push(block)
    if (block === image) out.push(textBlock)
  }
  return out
}

/**
 * Preprocess one entering user message: describe its images and rebuild it with the description folded in.
 * @param message - the entering user message (frozen).
 * @param config - resolved vision configuration.
 * @param llm - the registered LLM runtime used as the vision engine.
 * @param signal - cancellation carried from the entering step.
 * @returns a fresh frozen `UserMessage` with the description, or the original message when it has no image.
 */
export async function preprocessMessage(
  message: UserMessage,
  config: VisionConfig,
  llm: LlmRuntime,
  attachments: AttachmentStore | undefined,
  signal: AbortSignal,
): Promise<UserMessage> {
  void attachments
  if (!config.enabled) return message
  const images = collectImages(message)
  if (images.length === 0) return message

  const described = new Map<string, string>()
  const failed: ImageBlock[] = []
  for (const image of images) {
    try {
      described.set(image.attachment.attachmentId, await describeImage(image, config, llm, signal))
    } catch (error) {
      if (config.onFailure === 'throw') {
        throw new Error(`vision: recognition failed for ${String(image.attachment.attachmentId)}: ${String(error)}`)
      }
      failed.push(image)
    }
  }
  if (described.size === 0 && failed.length === 0) return message

  const provenance = config.visionProvenance ?? DEFAULT_VISION_PROVENANCE
  let content = message.content as (ImageBlock | TextBlock)[]
  for (const image of images) {
    const text = described.get(image.attachment.attachmentId)
    if (text !== undefined) {
      content = applyVision(content, image, text, config.mode, provenance)
    } else if (config.onFailure === 'skip') {
      // replace mode: drop the unrecognized image. append mode keeps the image
      // (there is no text to append, and dropping it would change the layout).
      content = content.filter(block => block !== image)
    }
  }
  if (content === message.content) return message
  // Rebuild as a genuine user message so the description is logged as a user/message event.
  return createUserMessage({ content, source: message.source })
}
