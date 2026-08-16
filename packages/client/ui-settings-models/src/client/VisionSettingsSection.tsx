/**
 * Settings rail entry for the `dsh-vision` namespace: binds the namespace's
 * settings scope and renders the {@link VisionSection} editor, bridging the
 * scope snapshot into the namespace view the editor stages against. The
 * namespace key is spelled here rather than imported so the section stays free
 * of Host imports; the ocr capability's Host plugin owns the same value.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { en } from './locales'
import { VisionSection } from './VisionSection.tsx'

/** Settings namespace of the vision-understanding capability. */
export const VISION_NAMESPACE = 'dsh-vision'

/** The fields the vision editor edits — a subset of the served schema by design. */
export interface VisionConfig {
  visionProvider: string
  visionModel: string
  mode: string
  onFailure: string
  visionMaxTokens: number
  enabled: boolean
}

/** Registration-side face the vision section's slot entry injects. */
export interface VisionSettingsSectionInjected {
  /** The bound settings scope for the `dsh-vision` namespace. */
  scope: SettingsScope<VisionConfig>
  /** uSES selector hook bound to the scope. */
  useSnapshot: SnapshotSelectorHook<SettingsScopeSnapshot<VisionConfig>>
  /** Wire face the editor writes through. */
  api: Pick<IApiClient, 'settings'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type VisionSettingsSectionProps = Partial<VisionSettingsSectionInjected>

/**
 * Render the vision section.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function VisionSettingsSection(props: VisionSettingsSectionProps) {
  const { scope, useSnapshot, api, t } = props
  if (scope === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ scope, useSnapshot, api, t }} />
}

function Loaded({ injected }: { injected: VisionSettingsSectionInjected }) {
  const { useSnapshot, api, t } = injected
  const state = useSnapshot(s => s)
  // Loading and unavailable both leave the rail section empty; the editor only
  // paints once a schema-resolved section stands.
  if (state.status !== 'ready' || state.value === undefined) return null
  const namespace: SettingsNamespaceView = {
    ns: VISION_NAMESPACE,
    schema: {},
    value: state.value,
    base: state.base,
    user: state.user,
    applies: 'live',
    secrets: [],
    revision: state.revision ?? 0,
  }
  return <VisionSection namespace={namespace} api={api} t={t} writable={state.writable} />
}
