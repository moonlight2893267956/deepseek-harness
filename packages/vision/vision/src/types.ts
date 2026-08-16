/**
 * Vision (image understanding) capability types.
 *
 * The vision plugin lives on the `agent/pre-step` seam: it rewrites the user
 * messages that are about to enter a step, replacing or annotating image
 * blocks with a natural-language description produced by a configured vision
 * model. The description becomes part of the entered message and is therefore
 * logged as a `user/message` session event — model-visible and reconstructable.
 *
 * Unlike a pure OCR engine, the vision model is asked to describe the whole
 * picture: if the image carries text it transcribes it, otherwise it describes
 * what is shown. This keeps the downstream (often text-only) model from
 * hallucinating a filename or other placeholder when an image has no text.
 *
 * @module @deepseek-ai/dsh-vision/types
 */

import type { ImageBlock, TextBlock } from '@deepseek-ai/dsh-llm'

/** How an image-understanding result is folded back into the owning user message. */
export type VisionMode = 'replace' | 'append'

/**
 * What happens when a vision sub-call fails for a given image.
 * - `pass`: keep the original image block untouched and let the real model see it.
 * - `throw`: propagate the failure as a thrown error, aborting the step.
 * - `skip`: drop the image block so the real model never receives it.
 */
export type VisionOnFailure = 'pass' | 'throw' | 'skip'

/** One image block paired with the description produced for it by the vision model. */
export interface DescribedImage {
  /** The original image block the description was produced from. */
  image: ImageBlock
  /** The description, never empty after validation. */
  text: string
}

/**
 * A user message after vision preprocessing: every image block is either
 * replaced (the image is gone, only the description remains) or annotated (the
 * image is kept and a description block is appended).
 */
export type PreprocessedContent = readonly (TextBlock | ImageBlock)[]
