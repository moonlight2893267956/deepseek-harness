/**
 * OCR capability types.
 *
 * The OCR plugin lives on the `agent/pre-step` seam: it rewrites the user
 * messages that are about to enter a step, replacing or annotating image
 * blocks with text recognized by a configured vision model. The recognized
 * text becomes part of the entered message and is therefore logged as a
 * `user/message` session event — model-visible and reconstructable.
 *
 * @module @deepseek-ai/dsh-ocr/types
 */

import type { ImageBlock, TextBlock } from '@deepseek-ai/dsh-llm'

/** How an OCR result is folded back into the owning user message. */
export type OcrMode = 'replace' | 'append'

/**
 * What happens when an OCR sub-call fails for a given image.
 * - `pass`: keep the original image block untouched and let the real model see it.
 * - `throw`: propagate the failure as a thrown error, aborting the step.
 * - `skip`: drop the image block so the real model never receives it.
 */
export type OcrOnFailure = 'pass' | 'throw' | 'skip'

/** One image block paired with the text recognized from it by the OCR engine. */
export interface RecognizedImage {
  /** The original image block the text was recognized from. */
  image: ImageBlock
  /** The recognized text, never empty after validation. */
  text: string
}

/**
 * A user message after OCR preprocessing: every image block is either
 * replaced (the image is gone, only text remains) or annotated (the image is
 * kept and a recognized-text block is appended).
 */
export type PreprocessedContent = readonly (TextBlock | ImageBlock)[]
