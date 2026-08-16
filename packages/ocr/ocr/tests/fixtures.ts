/**
 * Test fixtures for the OCR plugin.
 *
 * Builds frozen `UserMessage`s with image blocks and a fake `LlmRuntime` whose
 * `stream` emits a configurable recognized text, so the core preprocessing can
 * be exercised without a real provider.
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageBlock, LlmRuntime, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'

/** Build a branded attachment id from a plain string for tests. */
function attachId(value: string): AttachmentId {
  return value as unknown as AttachmentId
}

/** Build an image block referencing a synthetic attachment. */
export function makeImageBlock(id = 'img-1'): ImageBlock {
  return { type: 'image', attachment: { attachmentId: attachId(id) } } as unknown as ImageBlock
}

/** Build a frozen user message carrying the given content blocks. */
export function makeUserMessage(blocks: ContentBlock[]): UserMessage {
  return createUserMessage({ content: blocks, source: { kind: 'user' } })
}

/**
 * A fake `LlmRuntime` whose OCR `stream` emits the supplied text as text-delta chunks.
 * Pass `undefined` to emulate an OCR engine that yields no text (forces failure).
 */
export function fakeLlmRuntime(text: string | undefined): LlmRuntime {
  // A real adapter streams text in deltas and closes with an authoritative
  // block-end carrying the full block; the OCR consumer must not double-count.
  const mid = text === undefined ? 0 : Math.ceil(text.length / 2)
  const chunks: StreamChunk[] = text === undefined
    ? [{ type: 'finish', reason: 'stop' } as unknown as StreamChunk]
    : [
      { type: 'text-delta', index: 0, text: text.slice(0, mid) } as unknown as StreamChunk,
      { type: 'text-delta', index: 0, text: text.slice(mid) } as unknown as StreamChunk,
      { type: 'block-end', index: 0, block: { type: 'text', text } } as unknown as StreamChunk,
      { type: 'finish', reason: 'stop' } as unknown as StreamChunk,
    ]
  return {
    stream: async function* () {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as LlmRuntime
}

/**
 * Wrap {@link fakeLlmRuntime} to capture the OCR sub-call options (e.g. the
 * injected system prompt) for assertions.
 * @param text - the recognized text to stream, or `undefined` to force failure.
 * @param onOptions - invoked with the sub-call options before the stream runs.
 */
export function spyLlmRuntime(
  text: string | undefined,
  onOptions?: (options: { provider: string; model: string; system?: string }) => void,
): LlmRuntime {
  type StreamOptions = Parameters<LlmRuntime['stream']>[0]
  return {
    stream: async function* (options: StreamOptions) {
      onOptions?.(options)
      const fake = fakeLlmRuntime(text)
      for await (const chunk of fake.stream(options)) yield chunk
    },
  } as unknown as LlmRuntime
}

/** A fake `LlmRuntime` that rejects, simulating an OCR engine transport failure. */
export function failingLlmRuntime(error: Error): LlmRuntime {
  return {
    stream: async function* () {
      throw error
    },
  } as unknown as LlmRuntime
}
