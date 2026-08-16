import type { VisionModelMode } from '@deepseek-ai/dsh-llm'

/** Decision the vision pre-step takes for one model before any image work happens. */
export interface VisionModeDecision {
  /**
   * Whether the pre-step injects image understanding text for this model.
   * `false` short-circuits the pre-step with `next()`, leaving image admission
   * to the host's normal policy.
   */
  intervene: boolean
  /**
   * Whether to set `agent.imageAdmissionBypass` when intervening. It is set for
   * text-only models so the host will not reject the persisted images the
   * vision model consumed on the model's behalf; multimodal models that are
   * forced on still read images natively and need no bypass.
   */
  bypass: boolean
}

/**
 * Resolve whether vision preprocessing applies to one model.
 *
 * The global master switch (`enabled`) is checked by the caller first; this
 * function only decides the per-model opt-in once preprocessing is allowed at
 * all. `vision` is the model configuration entry (`undefined` = infer):
 *
 * - `'off'` — never preprocess, regardless of modality.
 * - `'on'` — always preprocess, even for a multimodal model.
 * - `undefined` — infer from `inputModalities`: a multimodal model reads images
 *   natively and needs no preprocessing, while a text-only model keeps the
 *   deployment-wide behavior.
 *
 * `bypass` is set exactly when the model cannot read images natively, so the
 * host's image admission must not reject the images vision consumed for it.
 */
export function resolveVisionMode(
  vision: VisionModelMode | undefined,
  isMultimodal: boolean,
): VisionModeDecision {
  if (vision === 'off') return { intervene: false, bypass: false }
  if (vision === 'on') return { intervene: true, bypass: !isMultimodal }
  // Inferred: multimodal models read natively; text-only models preprocess.
  return { intervene: !isMultimodal, bypass: !isMultimodal }
}
