// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { en } from '../src/client/locales'
import { VisionSettingsSection } from '../src/client/VisionSettingsSection'
import type { VisionConfig } from '../src/client/VisionSettingsSection'

const t = (key: string): string => en[key as keyof typeof en]

afterEach(() => {
  cleanup()
})

const VALUE: VisionConfig = {
  visionProvider: 'dashscope',
  visionModel: 'qwen3.8-max',
  mode: 'replace',
  onFailure: 'pass',
  visionMaxTokens: 4096,
  enabled: true,
}

function makeScope(snapshot: SettingsScopeSnapshot<VisionConfig>): SettingsScope<VisionConfig> {
  let current = snapshot
  return {
    getSnapshot: () => current,
    subscribe: () => () => {},
    set: async () => { current = { ...current } },
    unset: async () => {},
  }
}

function makeApi() {
  const mutate = vi.fn<NonNullable<IApiClient['settings']['mutate']>>()
  return { api: { settings: { mutate } } as unknown as Pick<IApiClient, 'settings'>, mutate }
}

const ready = (value: VisionConfig | undefined): SettingsScopeSnapshot<VisionConfig> => ({
  status: 'ready',
  value,
  base: VALUE,
  user: {},
  revision: 1,
  writable: true,
  mode: 'host',
})

describe('VisionSettingsSection', () => {
  it('renders nothing before the shell injects', () => {
    const { container } = render(<VisionSettingsSection />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing while the namespace is loading', () => {
    const scope = makeScope({ status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' })
    const { container } = render(
      <VisionSettingsSection scope={scope} useSnapshot={bindSnapshotSelector(scope)} api={makeApi().api} t={t} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the namespace is unavailable', () => {
    const scope = makeScope({ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' })
    const { container } = render(
      <VisionSettingsSection scope={scope} useSnapshot={bindSnapshotSelector(scope)} api={makeApi().api} t={t} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when a ready scope carries no value', () => {
    const scope = makeScope(ready(undefined))
    const { container } = render(
      <VisionSettingsSection scope={scope} useSnapshot={bindSnapshotSelector(scope)} api={makeApi().api} t={t} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the editor once the namespace resolves', () => {
    const scope = makeScope(ready(VALUE))
    render(
      <VisionSettingsSection scope={scope} useSnapshot={bindSnapshotSelector(scope)} api={makeApi().api} t={t} />,
    )
    expect(screen.getByRole('heading', { name: en.modelVisionTitle })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.modelVisionProvider).value).toBe('dashscope')
  })

  it('bridges an absent revision to zero', () => {
    const snapshot = ready(VALUE)
    snapshot.revision = undefined
    const scope = makeScope(snapshot)
    render(
      <VisionSettingsSection scope={scope} useSnapshot={bindSnapshotSelector(scope)} api={makeApi().api} t={t} />,
    )
    expect(screen.getByRole('heading', { name: en.modelVisionTitle })).toBeTruthy()
  })
})
