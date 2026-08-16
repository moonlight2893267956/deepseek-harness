/**
 * Vision understanding settings: the `dsh-vision` namespace editor behind the
 * Settings rail's own section. The card opens with an icon-led header that
 * carries the live enable switch and state, then walks two grouped field lists
 * (engine, behavior) under the settings-panel vocabulary. Every field stages
 * into a local draft and lands on the wire only when the user presses Save, so
 * a half-finished edit never reaches a describe in between; per-field reset
 * and reset-all clear user-layer overrides immediately. The override dot,
 * per-field reset, and customized summary keep the settings.yaml provenance
 * story the Models cards already tell.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { IconEyeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales'
import styles from './VisionSection.module.css'

const NAMESPACE = 'dsh-vision'

type VisionFieldKind = 'text' | 'number' | 'textarea' | 'select' | 'toggle'

interface VisionField {
  key: keyof VisionConfig
  kind: VisionFieldKind
  labelKey: keyof typeof import('./locales').en
  hintKey?: keyof typeof import('./locales').en
  options?: readonly { value: string; label: string }[]
}

interface VisionConfig {
  visionProvider: string
  visionModel: string
  mode: string
  onFailure: string
  visionMaxTokens: number
  enabled: boolean
}

const MODE_OPTIONS = [
  { value: 'replace', label: 'replace' },
  { value: 'append', label: 'append' },
] as const

const ON_FAILURE_OPTIONS = [
  { value: 'pass', label: 'pass' },
  { value: 'throw', label: 'throw' },
  { value: 'skip', label: 'skip' },
] as const

const ENGINE_FIELDS: readonly VisionField[] = [
  { key: 'visionProvider', kind: 'text', labelKey: 'modelVisionProvider', hintKey: 'modelVisionProviderHint' },
  { key: 'visionModel', kind: 'text', labelKey: 'modelVisionModel', hintKey: 'modelVisionModelHint' },
  { key: 'visionMaxTokens', kind: 'number', labelKey: 'modelVisionMaxTokens', hintKey: 'modelVisionMaxTokensHint' },
]

const BEHAVIOR_FIELDS: readonly VisionField[] = [
  { key: 'mode', kind: 'select', labelKey: 'modelVisionMode', hintKey: 'modelVisionModeHint', options: MODE_OPTIONS },
  { key: 'onFailure', kind: 'select', labelKey: 'modelVisionOnFailure', hintKey: 'modelVisionOnFailureHint', options: ON_FAILURE_OPTIONS },
]

const ENABLED_FIELD: VisionField = { key: 'enabled', kind: 'toggle', labelKey: 'modelVisionEnabled' }

/** Every editable field, in the order the editor's save/reset logic walks it. */
const FIELDS: readonly VisionField[] = [...ENGINE_FIELDS, ...BEHAVIOR_FIELDS, ENABLED_FIELD]

/** Presentational grouping of the config fields under two subheadings. */
const GROUPS: readonly { titleKey: keyof typeof import('./locales').en; fields: readonly VisionField[] }[] = [
  { titleKey: 'modelVisionGroupEngine', fields: ENGINE_FIELDS },
  { titleKey: 'modelVisionGroupBehavior', fields: BEHAVIOR_FIELDS },
]

const DEFAULTS: VisionConfig = {
  visionProvider: 'dashscope',
  visionModel: 'qwen3.8-max',
  mode: 'replace',
  onFailure: 'pass',
  visionMaxTokens: 4096,
  enabled: true,
}

/** Staged field values: text-shaped fields keep strings, the toggle a boolean. */
type VisionDraft = Record<string, string | boolean>

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  /* v8 ignore next 2 -- every call site passes a string or a number; the fallback is a scalar guard */
  if (typeof value === 'number') return String(value)
  return ''
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** The staged value the field would hold without any user-layer override. */
function defaultValue(field: VisionField, value: Record<string, unknown>): string | boolean {
  if (field.kind === 'toggle') {
    const wire = value[field.key]
    return wire === undefined ? Boolean(DEFAULTS[field.key]) : Boolean(wire)
  }
  return asText(value[field.key])
}

function initialDraft(namespace?: SettingsNamespaceView): VisionDraft {
  const value = (namespace?.value ?? {}) as Record<string, unknown>
  const out: VisionDraft = {}
  for (const field of FIELDS) {
    out[field.key] = defaultValue(field, value)
  }
  return out
}

export interface VisionSectionProps {
  /** dsh-vision namespace view; undefined before the first describe lands. */
  namespace?: SettingsNamespaceView
  api: Pick<IApiClient, 'settings'>
  t: (key: keyof typeof en) => string
  /** Whether the Host document accepts writes. */
  writable?: boolean
}

export function VisionSection(props: VisionSectionProps) {
  const { namespace, api, t, writable = true } = props
  const [draft, setDraft] = useState<VisionDraft>(() => initialDraft(namespace))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Fields the user is actively editing stay put while the wire refreshes, so
  // an inflight describe can never swallow a half-typed value.
  const touched = useRef(new Set<string>())
  const latestRevision = useRef(namespace?.revision ?? 0)

  useEffect(() => {
    if (namespace) latestRevision.current = namespace.revision
  }, [namespace])

  // Adopt wire values for fields the user is not actively editing.
  useEffect(() => {
    if (!namespace) return
    setDraft((current) => {
      const value = namespace.value as Record<string, unknown>
      const next = { ...current }
      let changed = false
      for (const field of FIELDS) {
        if (touched.current.has(field.key)) continue
        const wire = defaultValue(field, value)
        if (current[field.key] !== wire) {
          next[field.key] = wire
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [namespace])

  if (namespace === undefined) return null

  const value = namespace.value as Record<string, unknown>
  const user = (namespace.user ?? {}) as Record<string, unknown>
  const overriddenKeys = new Set(
    Object.keys(user).filter(key => user[key] !== undefined),
  )
  const customized = FIELDS.filter(field => overriddenKeys.has(field.key))

  /** Whether any field differs from what the wire currently serves. */
  const dirty = FIELDS.some((field) => {
    const wire = value[field.key]
    if (field.kind === 'toggle') {
      return Boolean(draft[field.key]) !== Boolean(wire === undefined ? DEFAULTS[field.key] : wire)
    }
    return asText(draft[field.key]) !== asText(wire)
  })

  /** Immediate single-field write; the reset paths only. */
  const write = useCallback(async (key: string, op: 'set' | 'unset', value?: unknown): Promise<void> => {
    setError(null)
    try {
      const response = await api.settings.mutate({
        ns: NAMESPACE,
        ops: [{ op, path: [key], value }],
        expectedRevision: latestRevision.current,
      })
      if (response.result.ok) {
        latestRevision.current = response.result.value.revision
        setSaved(true)
      } else {
        setError(messageOf(response.result.error))
      }
    } catch {
      setError(t('modelVisionErrorNetwork'))
    }
  }, [api, t])

  /** Stage one text-shaped field; nothing reaches the wire until Save. */
  const stageText = useCallback((field: VisionField, raw: string): void => {
    touched.current.add(field.key)
    setSaved(false)
    setDraft(current => ({ ...current, [field.key]: raw }))
  }, [])

  /** Stage the toggle; nothing reaches the wire until Save. */
  const stageToggle = useCallback((field: VisionField, checked: boolean): void => {
    touched.current.add(field.key)
    setSaved(false)
    setDraft(current => ({ ...current, [field.key]: checked }))
  }, [])

  /** Persist every staged change as one settings mutate. */
  const save = useCallback(async (): Promise<void> => {
    const ops: SettingsPathOpView[] = []
    for (const field of FIELDS) {
      const wire = value[field.key]
      if (field.kind === 'toggle') {
        const next = Boolean(draft[field.key])
        const current = wire === undefined ? Boolean(DEFAULTS[field.key]) : Boolean(wire)
        if (next !== current) ops.push({ op: 'set', path: [field.key], value: next })
      } else {
        const raw = asText(draft[field.key])
        if (raw !== asText(wire)) {
          if (raw === '') ops.push({ op: 'unset', path: [field.key] })
          else ops.push({ op: 'set', path: [field.key], value: field.kind === 'number' ? Number(raw) : raw })
        }
      }
    }
    /* v8 ignore next -- Save stays disabled while nothing is staged, so an empty op list is unreachable */
    if (ops.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const response = await api.settings.mutate({
        ns: NAMESPACE,
        ops,
        expectedRevision: latestRevision.current,
      })
      if (response.result.ok) {
        latestRevision.current = response.result.value.revision
        touched.current.clear()
        setSaved(true)
      } else {
        setError(messageOf(response.result.error))
      }
    } catch {
      setError(t('modelVisionErrorNetwork'))
    } finally {
      setBusy(false)
    }
  }, [api, draft, t, value])

  /** Revert one overridden field to its settings.yaml default, immediately. */
  const resetField = useCallback((field: VisionField): void => {
    touched.current.delete(field.key)
    setSaved(false)
    setDraft(current => ({
      ...current,
      [field.key]: field.kind === 'toggle' ? Boolean(DEFAULTS[field.key]) : '',
    }))
    /* v8 ignore next -- reset links and reset-all are disabled while read-only */
    if (writable) void write(field.key, 'unset')
  }, [write, writable])

  const resetAll = useCallback((): void => {
    for (const field of customized) resetField(field)
  }, [customized, resetField])

  return (
    <section className={styles['editor']} aria-label={t('modelVisionTitle')}>
      <header className={styles['header']}>
        <div className={styles['identity']}>
          <span className={styles['badge']} aria-hidden>
            <IconEyeOutline16 size={16} />
          </span>
          <div className={styles['titleBlock']}>
            <h3 className={styles['title']}>{t('modelVisionTitle')}</h3>
            <p className={styles['subtitle']}>{t('modelVisionSubtitle')}</p>
          </div>
        </div>
        <div className={styles['state']}>
          <span className={styles['stateText']}>
            {Boolean(draft.enabled) ? t('modelVisionStatusOn') : t('modelVisionStatusOff')}
          </span>
          <input
            type="checkbox"
            className={styles['toggle']}
            checked={Boolean(draft.enabled)}
            disabled={!writable || busy}
            aria-label={t('modelVisionEnabled')}
            onChange={(event) => { stageToggle(ENABLED_FIELD, event.target.checked) }}
          />
        </div>
      </header>

      <p className={styles['intro']}>{t('modelVisionIntro')}</p>

      {GROUPS.map(group => (
        <div key={group.titleKey} className={styles['group']}>
          <h4 className={styles['groupTitle']}>{t(group.titleKey)}</h4>
          <ul className={styles['fields']}>
            {group.fields.map((field) => {
              const label = t(field.labelKey)
              /* v8 ignore next -- every non-toggle field ships a hint; the fallback is a type-literal guard */
              const hint = field.hintKey === undefined ? undefined : t(field.hintKey)
              // v8 ignore next 3 -- hint is always set for the fields that reach here
              const hintNode = hint !== undefined
                ? <span className={styles['fieldHint']}>{hint}</span>
                : null
              const customizedNow = overriddenKeys.has(field.key)
              const draftValue = asText(draft[field.key])
              // v8 ignore next -- every select field in GROUPS ships its options; the fallback is a type guard
              const options = field.options ?? []
              return (
                <li key={field.key} className={styles['field']}>
                  <div className={styles['labelColumn']}>
                    <label className={styles['fieldLabel']} htmlFor={`vision-${field.key}`}>
                      {label}
                      {customizedNow
                        ? (
                          <button
                            type="button"
                            className={styles['resetLink']}
                            title={t('modelVisionOverriddenHint')}
                            aria-label={t('modelVisionResetField')}
                            disabled={!writable || busy}
                            onClick={() => { resetField(field) }}
                          >
                            {t('modelVisionResetField')}
                          </button>
                        )
                        : null}
                    </label>
                    {hintNode}
                  </div>
                  {field.kind === 'select'
                    ? (
                      <select
                        id={`vision-${field.key}`}
                        className={`${styles['input']} ${styles['selectInput']}`}
                        value={draftValue}
                        disabled={!writable || busy}
                        onChange={(event) => { stageText(field, event.target.value) }}
                      >
                        {options.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    )
                    : (
                      <input
                        id={`vision-${field.key}`}
                        type={field.kind === 'number' ? 'number' : 'text'}
                        className={styles['input']}
                        value={draftValue}
                        disabled={!writable || busy}
                        placeholder={asText(DEFAULTS[field.key])}
                        onChange={(event) => { stageText(field, event.target.value) }}
                      />
                    )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {customized.length > 0
        ? (
          <div className={styles['customized']}>
            <span className={styles['customizedTitle']}>
              <span className={styles['dot']} aria-hidden />
              {t('customized')}
            </span>
            <ul className={styles['customizedList']}>
              {customized.map(field => (
                <li key={field.key} className={styles['customizedItem']}>
                  <span className={styles['customizedKey']}>{t(field.labelKey)}</span>
                  <code className={styles['customizedValue']}>
                    {asText(value[field.key])}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )
        : null}

      <footer className={styles['footer']}>
        <div className={styles['status']}>
          {error !== null
            ? <p className={styles['error']} role="alert">{error}</p>
            : null}
          {saved && error === null
            ? <span className={styles['saved']}>{t('modelVisionSaved')}</span>
            : null}
        </div>
        <div className={styles['actions']}>
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={!writable || busy || customized.length === 0}
            onClick={() => { resetAll() }}
          >
            {t('modelVisionResetAll')}
          </button>
          <button
            type="button"
            className={styles['saveButton']}
            disabled={!writable || busy || !dirty}
            onClick={() => { void save() }}
          >
            {busy ? t('modelVisionSaving') : t('modelVisionSave')}
          </button>
        </div>
      </footer>
    </section>
  )
}
