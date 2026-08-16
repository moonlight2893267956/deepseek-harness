// @vitest-environment jsdom
/** Vision settings section behavior over a scripted wire face. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { VisionSection } from '../src/client/VisionSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: (key: keyof typeof en) => string = key => en[key]

/** Wire shape the component writes through. */
type MutationPayload = { ns: string; expectedRevision?: number; ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[] }

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}

/** A dsh-vision namespace with a couple of user overrides, as describe() returns. */
function visionNamespace(): SettingsNamespaceView {
  return {
    ns: 'dsh-vision',
    schema: {} as unknown,
    value: {
      enabled: true,
      visionProvider: 'dashscope',
      visionModel: 'qwen3.8-max',
      mode: 'append',
      onFailure: 'pass',
    },
    base: {
      enabled: true,
      visionProvider: 'dashscope',
      visionModel: 'qwen3.8-max',
      mode: 'replace',
      onFailure: 'pass',
    },
    user: {
      visionModel: 'qwen3.8-max',
      mode: 'append',
    },
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function scriptedFace() {
  const mutate = vi.fn<(payload: MutationPayload) => Promise<RpcResponse<SettingsNamespaceView>>>(
    () => Promise.resolve(ok(visionNamespace())),
  )
  const describe = vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [visionNamespace()] })))
  const face = { settings: { mutate, describe } }
  return { face, mutate }
}

function mount(namespace: SettingsNamespaceView = visionNamespace()) {
  const { face, mutate } = scriptedFace()
  render(<VisionSection namespace={namespace} api={face as never} t={t} />)
  return { face, mutate }
}

describe('VisionSection', () => {
  it('renders nothing without a namespace or api', () => {
    const { container } = render(<VisionSection t={t} />)
    expect(container.textContent).toBe('')
  })

  it('shows the title and the effective field values', () => {
    mount()
    expect(screen.getByRole('heading', { name: en.modelVisionTitle })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider).value).toBe('dashscope')
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionModel).value).toBe('qwen3.8-max')
    // The overridden `mode` reads the effective (user) value in the select.
    expect(screen.getByLabelText<HTMLSelectElement>(en.modelVisionMode).value).toBe('append')
  })

  it('writes a set op when a text field changes', async () => {
    const { mutate } = mount()
    const field = screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider)
    fireEvent.change(field, { target: { value: 'openai' } })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'dsh-vision',
      expectedRevision: 0,
      ops: [{ op: 'set', path: ['visionProvider'], value: 'openai' }],
    })
  })

  it('writes a select change as a set op', async () => {
    const { mutate } = mount()
    const select = screen.getByLabelText<HTMLSelectElement>(en.modelVisionMode)
    fireEvent.change(select, { target: { value: 'replace' } })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'dsh-vision',
      expectedRevision: 0,
      ops: [{ op: 'set', path: ['mode'], value: 'replace' }],
    })
  })

  it('unsets a field when its value is cleared, not writing a blank', async () => {
    const { mutate } = mount()
    const field = screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider)
    fireEvent.change(field, { target: { value: '' } })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0].ops).toEqual([{ op: 'unset', path: ['visionProvider'] }])
  })

  it('toggles the master switch with an explicit boolean', async () => {
    const { mutate } = mount()
    const toggle = screen.getByLabelText(en.modelVisionEnabled) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0].ops).toEqual([{ op: 'set', path: ['enabled'], value: false }])
  })

  it('marks only the overridden fields with a per-field reset', async () => {
    const { mutate } = mount()
    // Two fields carried a user override: visionModel and mode.
    const resetLinks = screen.getAllByText(en.modelVisionResetField)
    expect(resetLinks.length).toBe(2)
    fireEvent.click(resetLinks[0] as HTMLElement)
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The reset writes an unset op for the first overridden key (visionModel).
    expect(mutate.mock.calls[0]?.[0].ops).toEqual([{ op: 'unset', path: ['visionModel'] }])
  })

  it('unlocks reset-all only when an override exists', () => {
    mount(visionNamespace())
    const resetAll = screen.getByText<HTMLButtonElement>(en.modelVisionResetAll)
    expect(resetAll.disabled).toBe(false)
    const bare: SettingsNamespaceView = { ...visionNamespace(), user: {} }
    cleanup()
    render(<VisionSection namespace={bare} api={scriptedFace().face as never} t={t} />)
    expect(screen.getByText<HTMLButtonElement>(en.modelVisionResetAll).disabled).toBe(true)
  })

  it('reset-all unsets every overridden field', async () => {
    const { mutate } = mount()
    fireEvent.click(screen.getByText(en.modelVisionResetAll))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0].ops).toEqual([
      { op: 'unset', path: ['visionModel'] },
      { op: 'unset', path: ['mode'] },
    ])
  })

  it('surfaces a rejected write and never marks it saved', async () => {
    const mutate = vi.fn(() => Promise.reject(new Error('settings rejected')))
    render(<VisionSection namespace={visionNamespace()} api={{ settings: { mutate } } as never} t={t} />)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider), { target: { value: 'x' } })
    await screen.findByText('settings rejected')
    expect(screen.queryByText(en.modelVisionSaved)).toBeNull()
  })
})
