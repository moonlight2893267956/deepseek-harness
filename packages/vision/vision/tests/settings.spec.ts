/**
 * The vision plugin's `dsh-vision` settings section layered over the composition entry.
 *
 * Mirrors the canonical settings-section integration pattern: a real in-memory
 * provider drives `installSettingsSection`, and the live `VisionService` reflects
 * committed changes without a plugin restart. The `agent/pre-step` listener reads
 * `vision.enabled` / `vision.mode` live, so hot updates reach admission too.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import * as visionPlugin from '../src/index.ts'
import { NS } from '../src/service.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Entry config used as the settings base layer, as cordis.yml would compose it. */
function entry() {
  return {
    visionProvider: 'dashscope',
    visionModel: 'qwen3.8-max',
    mode: 'replace',
    enabled: true,
    onFailure: 'pass',
  } as const
}

/** Stub the two consumed services so the plugin mounts without a real runtime. */
function provideStubs(ctx: Context): void {
  const llm = {
    resolveModelInfo: async () => ({ vision: undefined, inputModalities: ['text'] }),
    stream: async function* () {
      yield { type: 'finish', reason: 'stop' } as unknown as never
    },
  } as unknown as LlmRuntime
  ctx.provide('llm', llm)
  ctx.provide('attachments', {})
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  provideStubs(ctx)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(visionPlugin, entry())
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dsh-vision settings section', () => {
  it('reflects a user-layer change in the live service without a restart', async () => {
    const bench = await boot()
    expect(bench.ctx.vision.enabled).toBe(true)
    expect(bench.ctx.vision.mode).toBe('replace')

    await bench.ctx.settings.update(NS, { enabled: false, mode: 'append' })

    expect(bench.ctx.vision.enabled).toBe(false)
    expect(bench.ctx.vision.mode).toBe('append')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(NS, { enabled: false })
    expect(bench.ctx.vision.enabled).toBe(false)

    await bench.settingsFiber.dispose()

    expect(bench.ctx.vision.enabled).toBe(true)
    expect(bench.ctx.vision.mode).toBe('replace')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('dsh-vision')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('dsh-vision')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the namespace registered without any settings provider mounted', async () => {
    // No MemorySettings here: the section must fall back to the entry and still mount.
    const ctx = new Context()
    provideStubs(ctx)
    const pluginFiber = ctx.plugin(visionPlugin, entry())
    await pluginFiber.await()
    expect(ctx.vision.enabled).toBe(true)
    expect(ctx.vision.mode).toBe('replace')
    await ctx.fiber.dispose()
  })
})
