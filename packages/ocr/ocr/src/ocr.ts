/**
 * OCR preprocessing core.
 *
 * Scans entering user messages for image blocks, recognizes each image with a
 * configured vision model through the registered `LlmRuntime`, and folds the
 * recognized text back into the message per {@link OcrMode}. The result is a
 * fresh set of `UserMessage`s built with `createUserMessage` (deep-frozen), so
 * the recognized text enters the session log as a genuine `user/message` event
 * — model-visible and reconstructable.
 *
 * @module @deepseek-ai/dsh-ocr/ocr
 */

import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import {
  createUserMessage,
  deepFreeze,
  type ImageBlock,
  type TextBlock,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { OcrConfig } from './config.ts'
import { DEFAULT_OCR_PROMPT, DEFAULT_OCR_PROVENANCE } from './config.ts'
import type { OcrMode } from './types.ts'

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
 * Run one OCR recognition sub-call for a single image and return the recognized text.
 * @param image - the image block to recognize.
 * @param config - resolved OCR configuration (provider, model, prompt).
 * @param llm - the registered LLM runtime used as the OCR engine.
 * @param signal - cancellation carried from the entering step.
 * @returns the trimmed, non-empty recognized text.
 * @throws when the OCR engine yields no usable text.
 */
async function recognizeImage(
  image: ImageBlock,
  config: OcrConfig,
  llm: LlmRuntime,
  attachments: AttachmentStore | undefined,
  signal: AbortSignal,
): Promise<string> {
  // The OCR sub-call is dispatched through the same LlmRuntime the real model
  // uses; it does not pass through `agent/pre-step`, so no recursion guard is
  // needed. The adapter resolves the image bytes from the attachment reference.
  void attachments
  const subOptions: Parameters<LlmRuntime['stream']>[0] = {
    provider: config.ocrProvider,
    model: config.ocrModel,
    messages: [createUserMessage({ content: [image], source: { kind: 'user' } })],
    signal,
  }
  subOptions.system = config.ocrPrompt ?? DEFAULT_OCR_PROMPT
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
    throw new Error('ocr: recognition returned no text')
  }
  return trimmed
}

/**
 * Fold recognized text into a message's content per the configured mode.
 * @param content - the original content blocks (frozen).
 * @param image - the image block the text was recognized from.
 * @param text - the recognized, non-empty text.
 * @param mode - replace the image with text, or append text after the image.
 * @param provenance - marker prepended to recognized text in `replace` mode.
 * @returns the new (unfrozen) content blocks.
 */
function applyOcr(
  content: readonly (ImageBlock | TextBlock)[],
  image: ImageBlock,
  text: string,
  mode: OcrMode,
  provenance: string,
): (ImageBlock | TextBlock)[] {
  // In replace mode the image block is gone, so the downstream (text-only)
  // model needs an explicit signal that this text was recognized from an image;
  // the provenance marker supplies it. Append mode keeps the image, so no marker.
  const textBlock: TextBlock = { type: 'text', text: mode === 'replace' ? `${provenance}${text}` : text }
  if (mode === 'replace') {
    return content.map(block => (block === image ? textBlock : block))
  }
  // append: keep the image, insert the recognized text right after it.
  const out: (ImageBlock | TextBlock)[] = []
  for (const block of content) {
    out.push(block)
    if (block === image) out.push(textBlock)
  }
  return out
}

/**
 * Preprocess one entering user message: recognize its images and rebuild it with the OCR text folded in.
 * @param message - the entering user message (frozen).
 * @param config - resolved OCR configuration.
 * @param llm - the registered LLM runtime used as the OCR engine.
 * @param signal - cancellation carried from the entering step.
 * @returns a fresh frozen `UserMessage` with recognized text, or the original message when it has no image.
 */
export async function preprocessMessage(
  message: UserMessage,
  config: OcrConfig,
  llm: LlmRuntime,
  attachments: AttachmentStore | undefined,
  signal: AbortSignal,
): Promise<UserMessage> {
  if (!config.enabled) return message
  const images = collectImages(message)
  if (images.length === 0) return message

  const recognized = new Map<AttachmentId, string>()
  const failed: ImageBlock[] = []
  for (const image of images) {
    try {
      recognized.set(image.attachment.attachmentId, await recognizeImage(image, config, llm, attachments, signal))
    } catch (error) {
      if (config.onFailure === 'throw') {
        throw new Error(`ocr: recognition failed for ${String(image.attachment.attachmentId)}: ${String(error)}`)
      }
      failed.push(image)
    }
  }
  if (recognized.size === 0 && failed.length === 0) return message

  const provenance = config.ocrProvenance ?? DEFAULT_OCR_PROVENANCE
  let content = message.content as (ImageBlock | TextBlock)[]
  for (const image of images) {
    const text = recognized.get(image.attachment.attachmentId)
    if (text !== undefined) {
      content = applyOcr(content, image, text, config.mode, provenance)
    } else if (config.onFailure === 'skip') {
      // replace mode: drop the unrecognized image. append mode keeps the image
      // (there is no text to append, and dropping it would change the layout).
      content = content.filter(block => block !== image)
    }
  }
  if (content === message.content) return message
  // Rebuild as a genuine user message so the OCR text is logged as a user/message event.
  return createUserMessage({ content, source: message.source })
}

/** Re-exported to keep the frozen-message construction in one module. */
export { deepFreeze }
