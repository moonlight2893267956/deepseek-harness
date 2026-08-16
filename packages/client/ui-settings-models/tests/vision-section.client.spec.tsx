// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales'
import { VisionSection } from '../src/client/VisionSection'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'

const t = (key: string): string => en[key as keyof typeof en]

/** Typed mutate signature, so assertions over mock calls stay member-safe. */
type MutateFn = NonNullable<IApiClient['settings']['mutate']>

function makeNamespace(over: Record<string, unknown> = {}): SettingsNamespaceView {
  const value: Record<string, unknown> = {
    visionProvider: 'dashscope',
    visionModel: 'qwen3.8-max',
    mode: 'replace',
    onFailure: 'pass',
    visionMaxTokens: 4096,
    enabled: true,
    ...over,
  }
  return {
    ns: 'dsh-vision',
    revision: 1,
    value,
    user: {},
    base: over,
    view: { fields: Object.keys(value).map(key => ({ key })) },
    schema: {},
    defaults: value,
  } as unknown as SettingsNamespaceView
}

function makeApi() {
  const mutate = vi.fn<MutateFn>().mockResolvedValue({
    result: { ok: true, value: { revision: 42 } },
  } as never)
  return { api: { settings: { mutate } } as unknown as Pick<IApiClient, 'settings'>, mutate }
}

const saveButton = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: en.modelVisionSave })

const edit = async (label: string, value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  })
}

const clickSave = async (): Promise<void> => {
  await act(async () => { fireEvent.click(saveButton()) })
}

afterEach(() => {
  cleanup()
})

describe('VisionSection', () => {
  it('renders nothing before the namespace arrives', () => {
    const { container } = render(<VisionSection api={makeApi().api} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the title, field hints, and the effective field values', () => {
    const namespace = makeNamespace({ mode: 'append' })
    render(<VisionSection namespace={namespace} api={makeApi().api} t={t} />)
    expect(screen.getByRole('heading', { name: en.modelVisionTitle })).toBeTruthy()
    expect(screen.getByText(en.modelVisionProviderHint)).toBeTruthy()
    expect(screen.getByText(en.modelVisionModeHint)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider).value).toBe('dashscope')
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionModel).value).toBe('qwen3.8-max')
    expect(screen.getByLabelText<HTMLSelectElement>(en.modelVisionMode).value).toBe('append')
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionEnabled).checked).toBe(true)
  })

  it('leads with the eye badge, the live state, and the grouped field lists', () => {
    const { container } = render(<VisionSection namespace={makeNamespace()} api={makeApi().api} t={t} />)
    // The enable switch moved into the header and keeps the full copy as its
    // accessible name; the state caption echoes the current draft.
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionEnabled).checked).toBe(true)
    expect(screen.getByText(en.modelVisionStatusOn)).toBeTruthy()
    expect(screen.getByText(en.modelVisionIntro)).toBeTruthy()
    expect(screen.getByText(en.modelVisionGroupEngine)).toBeTruthy()
    expect(screen.getByText(en.modelVisionGroupBehavior)).toBeTruthy()
    // The header badge echoes the vision glyph.
    expect(container.querySelector('section svg')).not.toBeNull()
  })

  it('reports the disabled state when the wire carries enabled=false', () => {
    render(<VisionSection namespace={makeNamespace({ enabled: false })} api={makeApi().api} t={t} />)
    expect(screen.getByText(en.modelVisionStatusOff)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionEnabled).checked).toBe(false)
  })

  it('stages edits without writing until Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    expect(saveButton().disabled).toBe(true)
    await edit(en.modelVisionProvider, 'openai')
    expect(mutate).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(false)
  })

  it('writes a set op for a staged text change on Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      ns: 'dsh-vision',
      ops: [{ op: 'set', path: ['visionProvider'], value: 'openai' }],
    })
  })

  it('coerces a staged number field to a number on Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionMaxTokens, '2048')
    await clickSave()
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'set', path: ['visionMaxTokens'], value: 2048 },
    ])
  })

  it('writes a set op for a staged select change on Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionMode, 'append')
    await clickSave()
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'set', path: ['mode'], value: 'append' },
    ])
  })

  it('writes a set op for the staged toggle on Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await act(async () => { fireEvent.click(screen.getByLabelText(en.modelVisionEnabled)) })
    await clickSave()
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'set', path: ['enabled'], value: false },
    ])
  })

  it('stages a toggle against its default when the wire carries no override', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace({ enabled: undefined })} api={api} t={t} />)
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionEnabled).checked).toBe(true)
    await act(async () => { fireEvent.click(screen.getByLabelText(en.modelVisionEnabled)) })
    await clickSave()
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'set', path: ['enabled'], value: false },
    ])
  })

  it('batches multiple staged edits into one Save', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText(en.modelVisionProvider), { target: { value: 'openai' } })
      fireEvent.change(screen.getByLabelText(en.modelVisionModel), { target: { value: 'qwen-vl-max' } })
    })
    await clickSave()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'set', path: ['visionProvider'], value: 'openai' },
      { op: 'set', path: ['visionModel'], value: 'qwen-vl-max' },
    ])
  })

  it('saves an emptied text field as an unset', async () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, '')
    await clickSave()
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'unset', path: ['visionProvider'] },
    ])
  })

  it('keeps Save disabled while nothing is staged', async () => {
    const { api } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    expect(saveButton().disabled).toBe(true)
    // Editing a field back to its wire value leaves nothing to save.
    await edit(en.modelVisionProvider, 'dashscope')
    expect(saveButton().disabled).toBe(true)
  })

  it('surfaces a rejected save', async () => {
    const { api, mutate } = makeApi()
    mutate.mockRejectedValueOnce(new Error('boom'))
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(screen.getByText(en.modelVisionErrorNetwork)).toBeTruthy()
  })

  it('surfaces a business-rejected save', async () => {
    const { api, mutate } = makeApi()
    mutate.mockResolvedValueOnce({ result: { ok: false, error: { message: 'rejected' } } } as never)
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(screen.getByText('rejected')).toBeTruthy()
  })

  it('shows the saving state while the write is in flight', async () => {
    const { api, mutate } = makeApi()
    let resolve!: (value: Awaited<ReturnType<MutateFn>>) => void
    mutate.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await act(async () => { fireEvent.click(saveButton()) })
    expect(screen.getByRole('button', { name: en.modelVisionSaving })).toBeTruthy()
    await act(async () => { resolve({ result: { ok: true, value: { revision: 42 } } } as never) })
    expect(screen.getByText(en.modelVisionSaved)).toBeTruthy()
  })

  it('surfaces a non-string error value', async () => {
    const { api, mutate } = makeApi()
    mutate.mockResolvedValueOnce({ result: { ok: false, error: 'boom' } } as never)
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('falls back when the rejected error carries no message', async () => {
    const { api, mutate } = makeApi()
    mutate.mockResolvedValueOnce({ result: { ok: false, error: { message: 42 } } } as never)
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(screen.getByText('unknown error')).toBeTruthy()
  })

  it('treats a missing user layer as an empty override map', () => {
    const namespace = makeNamespace()
    namespace.user = undefined
    render(<VisionSection namespace={namespace} api={makeApi().api} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.modelVisionResetAll }).disabled).toBe(true)
  })

  it('shows saved after Save and clears it on the next edit', async () => {
    const { api } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    await clickSave()
    expect(screen.getByText(en.modelVisionSaved)).toBeTruthy()
    await edit(en.modelVisionModel, 'qwen-vl-max')
    expect(screen.queryByText(en.modelVisionSaved)).toBeNull()
  })

  it('keeps staged edits while the wire refreshes', async () => {
    const { api } = makeApi()
    const { rerender } = render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    await edit(en.modelVisionProvider, 'openai')
    // A wire refresh with a newer provider must not overwrite the staged edit.
    rerender(<VisionSection namespace={makeNamespace({ visionProvider: 'wire-value' })} api={api} t={t} />)
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider).value).toBe('openai')
  })

  it('adopts wire values for fields not being edited', async () => {
    const { api } = makeApi()
    const { rerender } = render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    rerender(<VisionSection namespace={makeNamespace({ visionModel: 'qwen-vl-plus' })} api={api} t={t} />)
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionModel).value).toBe('qwen-vl-plus')
  })

  it('marks only the overridden fields with a per-field reset', () => {
    const namespace = makeNamespace()
    namespace.user = { visionModel: 'qwen3.8-max', mode: 'append' }
    render(<VisionSection namespace={namespace} api={makeApi().api} t={t} />)
    expect(screen.getAllByText(en.modelVisionResetField)).toHaveLength(2)
  })

  it('unlocks reset-all only when an override exists', () => {
    const { api } = makeApi()
    const { rerender } = render(<VisionSection namespace={makeNamespace()} api={api} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.modelVisionResetAll }).disabled).toBe(true)
    const overridden = makeNamespace()
    overridden.user = { visionProvider: 'ollama' }
    rerender(<VisionSection namespace={overridden} api={api} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.modelVisionResetAll }).disabled).toBe(false)
  })

  it('resets a single overridden field immediately', async () => {
    const { api, mutate } = makeApi()
    const namespace = makeNamespace()
    namespace.user = { visionModel: 'qwen3.8-max' }
    render(<VisionSection namespace={namespace} api={api} t={t} />)
    await act(async () => { fireEvent.click(screen.getAllByText(en.modelVisionResetField)[0]!) })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0].ops).toEqual([
      { op: 'unset', path: ['visionModel'], value: undefined },
    ])
  })

  it('surfaces a rejected field reset', async () => {
    const { api, mutate } = makeApi()
    mutate.mockRejectedValueOnce(new Error('boom'))
    const namespace = makeNamespace()
    namespace.user = { visionModel: 'qwen3.8-max' }
    render(<VisionSection namespace={namespace} api={api} t={t} />)
    await act(async () => { fireEvent.click(screen.getAllByText(en.modelVisionResetField)[0]!) })
    expect(screen.getByText(en.modelVisionErrorNetwork)).toBeTruthy()
  })

  it('surfaces a business-rejected field reset', async () => {
    const { api, mutate } = makeApi()
    mutate.mockResolvedValueOnce({ result: { ok: false, error: { message: 'rejected' } } } as never)
    const namespace = makeNamespace()
    namespace.user = { visionModel: 'qwen3.8-max' }
    render(<VisionSection namespace={namespace} api={api} t={t} />)
    await act(async () => { fireEvent.click(screen.getAllByText(en.modelVisionResetField)[0]!) })
    expect(screen.getByText('rejected')).toBeTruthy()
  })

  it('reset-all unsets every overridden field, including the toggle', async () => {
    const { api, mutate } = makeApi()
    const namespace = makeNamespace()
    namespace.user = { visionModel: 'qwen3.8-max', mode: 'append', enabled: false }
    render(<VisionSection namespace={namespace} api={api} t={t} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.modelVisionResetAll })) })
    const unsetPaths = mutate.mock.calls.map(call => call[0].ops[0]!.path[0]!).sort()
    expect(unsetPaths).toEqual(['enabled', 'mode', 'visionModel'])
    for (const call of mutate.mock.calls) {
      expect(call[0].ops[0]!.op).toBe('unset')
    }
  })

  it('disables editing and saving when not writable', () => {
    const { api, mutate } = makeApi()
    render(<VisionSection namespace={makeNamespace()} api={api} t={t} writable={false} />)
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider).disabled).toBe(true)
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.modelVisionProvider), { target: { value: 'openai' } })
    expect(mutate).not.toHaveBeenCalled()
  })
})
