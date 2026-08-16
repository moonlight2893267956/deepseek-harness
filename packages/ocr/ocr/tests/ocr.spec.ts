import { describe, expect, it } from 'vitest'
import type { OcrConfig } from '../src/config.ts'
import { DEFAULT_OCR_PROMPT } from '../src/config.ts'
import { collectImages, preprocessMessage } from '../src/ocr.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  failingLlmRuntime,
  fakeLlmRuntime,
  makeImageBlock,
  makeUserMessage,
  spyLlmRuntime,
} from './fixtures.ts'

/** Build a resolved config from overrides with sensible OCR-engine defaults. */
function config(overrides: Partial<OcrConfig> = {}): OcrConfig {
  return {
    ocrProvider: 'ocr-provider',
    ocrModel: 'ocr-model',
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
  it('replaces an image block with recognized text and a provenance marker', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config(), fakeLlmRuntime('RECEIPT 42'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: '[Image OCR result]\nRECEIPT 42' }])
  })

  it('uses a configured provenance marker when provided', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ ocrProvenance: 'OCR>> ' }), fakeLlmRuntime('TEXT'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: 'OCR>> TEXT' }])
  })

  it('disables the provenance marker with an empty string', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ ocrProvenance: '' }), fakeLlmRuntime('TEXT'), undefined, noop)
    expect(out.content).toEqual([{ type: 'text', text: 'TEXT' }])
  })

  it('passes through when the message has no image', async () => {
    const msg = makeUserMessage([{ type: 'text', text: 'plain' }])
    expect(await preprocessMessage(msg, config(), fakeLlmRuntime('X'), undefined, noop)).toBe(msg)
  })

  it('processes multiple images independently', async () => {
    const a = makeImageBlock('a')
    const b = makeImageBlock('b')
    const msg = makeUserMessage([a, b])
    const out = await preprocessMessage(msg, config(), fakeLlmRuntime('TEXT'), undefined, noop)
    expect(out.content).toEqual([
      { type: 'text', text: '[Image OCR result]\nTEXT' },
      { type: 'text', text: '[Image OCR result]\nTEXT' },
    ])
  })

  it('injects the default OCR prompt when ocrPrompt is not configured', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let system: string | undefined
    await preprocessMessage(
      msg,
      config(),
      spyLlmRuntime('TEXT', (options) => { system = options.system }),
      undefined,
      noop,
    )
    expect(system).toBe(DEFAULT_OCR_PROMPT)
  })

  it('uses the configured ocrPrompt when provided', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    let system: string | undefined
    await preprocessMessage(
      msg,
      config({ ocrPrompt: 'TRANSCRIBE STRICTLY' }),
      spyLlmRuntime('TEXT', (options) => { system = options.system }),
      undefined,
      noop,
    )
    expect(system).toBe('TRANSCRIBE STRICTLY')
  })
})

describe('preprocessMessage mode=append', () => {
  it('keeps the image and appends recognized text after it', async () => {
    const img = makeImageBlock('a')
    const msg: UserMessage = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ mode: 'append' }), fakeLlmRuntime('CAPTION'), undefined, noop)
    expect(out.content).toEqual([
      { type: 'image', attachment: { attachmentId: 'a' } },
      { type: 'text', text: 'CAPTION' },
    ])
  })
})

describe('onFailure policy', () => {
  it('pass keeps the original image when OCR yields no text', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ onFailure: 'pass' }), fakeLlmRuntime(undefined), undefined, noop)
    expect(out).toBe(msg)
  })

  it('skip drops the image when OCR yields no text (replace mode)', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    const out = await preprocessMessage(msg, config({ onFailure: 'skip' }), fakeLlmRuntime(undefined), undefined, noop)
    expect(out.content).toEqual([])
  })

  it('throw aborts the step on OCR transport failure', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    await expect(
      preprocessMessage(msg, config({ onFailure: 'throw' }), failingLlmRuntime(new Error('boom')), undefined, noop),
    ).rejects.toThrow(/ocr:/)
  })
})

describe('enabled gating', () => {
  it('returns the original message untouched when disabled', async () => {
    const img = makeImageBlock('a')
    const msg = makeUserMessage([img])
    expect(await preprocessMessage(msg, config({ enabled: false }), fakeLlmRuntime('X'), undefined, noop)).toBe(msg)
  })
})
