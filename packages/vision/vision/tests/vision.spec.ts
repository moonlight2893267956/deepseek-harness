import { describe, expect, it } from 'vitest'
import type { VisionConfig } from '../src/config.ts'
import { DEFAULT_VISION_PROMPT, DEFAULT_VISION_PROVENANCE } from '../src/config.ts'
import { collectImages, preprocessMessage } from '../src/vision.ts'
import { resolveVisionMode } from '../src/resolve-vision-mode.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  failingLlmRuntime,
  fakeLlmRuntime,
  makeImageBlock,
  makeUserMessage,
  spyLlmRuntime,
} from './fixtures.ts'

/** Build a resolved config from overrides with sensible vision-engine defaults. */
function config(overrides: Partial<VisionConfig> = {}): VisionConfig {
  return {
    visionProvider: 'vision-provider',
    visionModel: 'vision-model',
    mode: 'replace',
    enabled: true,
    onFailure: 'pass',
    ...overrides,
  }
}

const noop = new AbortController().signal

describe('collectImages', () => {
  it('returns only image blocks, in order', () => {
    const imgA = makeImageBlock('a')
    const imgB = makeImageBlock('b')
    const msg = makeUserMessage([{ type: 'text', text: 'hi' }, imgA, imgB])
    expect(collectImages(msg).map(b => b.attachment.attachmentId)).toEqual(['a', 'b'])
  })
})

describe('preprocessMessage mode=replace', () => {
  it('replaces an image with a description and a provenance marker', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config(), fakeLlmRuntime('A penguin standing on ice'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: '[Image understanding]\nA penguin standing on ice' }])
  })

  it('uses a configured provenance marker when provided', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ visionProvenance: 'VIS>> ' }), fakeLlmRuntime('CAPTION'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: 'VIS>> CAPTION' }])
  })

  it('disables the provenance marker with an empty string', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ visionProvenance: '' }), fakeLlmRuntime('CAPTION'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: 'CAPTION' }])
  })

  it('passes through when the message has no image', async () => {
    const msg = makeUserMessage([{ type: 'text', text: 'plain' }])
    expect(await preprocessMessage(msg, config(), fakeLlmRuntime('X'), undefined, noop)).toBe(msg)
  })

  it('processes multiple images independently', async () => {
    const a = makeImageBlock('a')
    const b = makeImageBlock('b')
    const msg = makeUserMessage([a, b])
    const out = await preprocessMessage(msg, config(), fakeLlmRuntime('DESC'), undefined, noop)
    expect(out.content).toEqual([
      { type: 'text', text: '[Image understanding]\nDESC' },
      { type: 'text', text: '[Image understanding]\nDESC' },
    ])
  })

  it('injects the default vision prompt when visionPrompt is not configured', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let system: string | undefined
    await preprocessMessage(
      msg,
      config(),
      spyLlmRuntime('DESC', (options) => { system = options.system }),
      undefined,
      noop,
    )
    expect(system).toBe(DEFAULT_VISION_PROMPT)
  })

  it('uses the configured visionPrompt when provided', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let system: string | undefined
    await preprocessMessage(
      msg,
      config({ visionPrompt: 'DESCRIBE THE SCENE' }),
      spyLlmRuntime('DESC', (options) => { system = options.system }),
      undefined,
      noop,
    )
    expect(system).toBe('DESCRIBE THE SCENE')
  })

  it('routes the vision sub-call through the configured provider and model', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let provider: string | undefined
    let model: string | undefined
    await preprocessMessage(
      msg,
      config({ visionProvider: 'dashscope', visionModel: 'qwen3.8-max' }),
      spyLlmRuntime('DESC', (options) => { provider = options.provider; model = options.model }),
      undefined,
      noop,
    )
    expect(provider).toBe('dashscope')
    expect(model).toBe('qwen3.8-max')
  })

  it('omits maxTokens from the sub-call when visionMaxTokens is unset', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let maxTokens: number | undefined
    await preprocessMessage(
      msg,
      config(),
      spyLlmRuntime('DESC', (options) => { maxTokens = options.maxTokens }),
      undefined,
      noop,
    )
    expect(maxTokens).toBeUndefined()
  })

  it('forwards visionMaxTokens as the sub-call maxTokens cap', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let maxTokens: number | undefined
    await preprocessMessage(
      msg,
      config({ visionMaxTokens: 128000 }),
      spyLlmRuntime('DESC', (options) => { maxTokens = options.maxTokens }),
      undefined,
      noop,
    )
    expect(maxTokens).toBe(128000)
  })
})

describe('preprocessMessage mode=append', () => {
  it('keeps the image and appends the description after it (no provenance marker)', async () => {
    const img = makeImageBlock('a')
    const msg: UserMessage = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ mode: 'append' }), fakeLlmRuntime('A red bird'), undefined, noop)
    expect(out.content).toEqual([
      { type: 'image', attachment: { attachmentId: 'a' } },
      { type: 'text', text: 'A red bird' },
    ])
  })
})

describe('onFailure policy', () => {
  it('pass keeps the original image when the vision model yields no text', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ onFailure: 'pass' }), fakeLlmRuntime(undefined), undefined, noop)
    expect(out).toBe(msg)
  })

  it('skip drops the image when the vision model yields no text (replace mode)', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ onFailure: 'skip' }), fakeLlmRuntime(undefined), undefined, noop)
    expect(out.content).toEqual([])
  })

  it('throw aborts the step on vision transport failure', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    await expect(
      preprocessMessage(msg, config({ onFailure: 'throw' }), failingLlmRuntime(new Error('boom')), undefined, noop),
    ).rejects.toThrow(/vision:/)
  })
})

describe('enabled gating', () => {
  it('returns the original message untouched when disabled', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    expect(await preprocessMessage(msg, config({ enabled: false }), fakeLlmRuntime('X'), undefined, noop)).toBe(msg)
  })
})

describe('rebuilt message is a genuine user message', () => {
  it('replaces the original frozen message with a fresh one carrying the description', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config(), fakeLlmRuntime('DESC'), undefined, noop)
    expect(out).not.toBe(msg)
    expect(out).toHaveProperty('source.kind', 'user')
    expect(out.content[0]).toHaveProperty('type', 'text')
    expect((out.content[0] as { text: string }).text.startsWith(DEFAULT_VISION_PROVENANCE)).toBe(true)
  })
})

describe('resolveVisionMode', () => {
  it('infers off for a multimodal model without an explicit opt-in', () => {
    expect(resolveVisionMode(undefined, true))
      .toEqual({ intervene: false, bypass: false })
  })

  it('infers on for a text-only model without an explicit opt-in', () => {
    expect(resolveVisionMode(undefined, false))
      .toEqual({ intervene: true, bypass: true })
  })

  it('forces on even for a multimodal model', () => {
    expect(resolveVisionMode('on', true))
      .toEqual({ intervene: true, bypass: false })
  })

  it('forces off even for a text-only model', () => {
    expect(resolveVisionMode('off', false))
      .toEqual({ intervene: false, bypass: false })
  })
})
