/**
 * OCR plugin configuration.
 *
 * Every field that varies by deployment is a validated `Config` member; nothing
 * about the OCR route or policy is hardcoded. Missing required fields fail loud
 * at load time, before any request reaches the engine.
 *
 * @module @deepseek-ai/dsh-ocr/config
 */

import z from '@deepseek-ai/schemastery'
import type { OcrMode, OcrOnFailure } from './types.ts'

/** Resolved, validated OCR plugin configuration. */
export interface OcrConfig {
  /** OCR engine provider route, reused through the registered `LlmRuntime` routing. Required. */
  ocrProvider: string
  /** OCR engine model id. Required. */
  ocrModel: string
  /** System prompt sent to the OCR model. Optional; a sane default asks for plain recognized text. */
  ocrPrompt?: string
  /**
   * Marker prepended to recognized text in `replace` mode so the downstream model knows the text came
   * from an image. Optional; an empty string disables it.
   */
  ocrProvenance?: string
  /** Backfill policy: `replace` swaps the image block for text, `append` keeps the image and adds text. */
  mode: OcrMode
  /** Master switch; when false the pre-step listener passes messages through untouched. Default true. */
  enabled: boolean
  /** OCR failure policy: `pass` keeps the image, `throw` aborts the step, `skip` drops the image. Default `pass`. */
  onFailure: OcrOnFailure
}

/** Default system prompt when `ocrPrompt` is not configured. */
export const DEFAULT_OCR_PROMPT =
  'You are an OCR engine. Transcribe all visible text from the image faithfully and verbatim. '
  + 'Output only the recognized text, with no commentary, no translation, and no markup.'

/** Default provenance marker prepended to recognized text in `replace` mode. */
export const DEFAULT_OCR_PROVENANCE = '[Image OCR result]\n'

/** Loader schema for {@link OcrConfig}. Required fields fail load when absent. */
export const Config: z<OcrConfig> = z.object({
  ocrProvider: z.string().required(),
  ocrModel: z.string().required(),
  ocrPrompt: z.string(),
  ocrProvenance: z.string(),
  mode: z.union(['replace', 'append']).required(),
  enabled: z.boolean().default(true),
  onFailure: z.union(['pass', 'throw', 'skip']).default('pass'),
})
