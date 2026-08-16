/**
 * Vision settings section: a flat form over the `dsh-vision` settings namespace,
 * joined to the model page. Each field writes through the wire immediately, so the
 * host vision plugin hot-applies the change without a reload. A field carrying a
 * user override shows a dot; reset unsets that one path back to the base layer.
 */

import { useState } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { getPath, hasPath } from '@deepseek-ai/dsh-client-schema-form'
import type { en } from './locales.ts'
import styles from './VisionSection.module.css'

/** Dependencies shared with the model page. */
export interface VisionSectionInjected {
  /** Wire faces the form writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet. */
export type VisionSectionProps = Partial<VisionSectionInjected> & {
  /** The live `dsh-vision` namespace view (rebased on each settings invalidation). */
  namespace?: SettingsNamespaceView
}

/** Field metadata for the dsh-vision flat config. */
interface VisionField {
  /** Config key under dsh-vision. */
  key: string
  /** Locale key for the label. */
  label: keyof typeof en
  /** Locale key for the hint line. */
  hint: keyof typeof en
  /** Control kind. */
  kind: 'toggle' | 'text' | 'number' | 'textarea' | 'select'
  /** Options for a `select` control. */
  options?: { value: string; label: keyof typeof en }[]
}

const FIELDS: readonly VisionField[] = [
  { key: 'visionProvider', label: 'modelVisionProvider', hint: 'modelVisionProviderHint', kind: 'text' },
  { key: 'visionModel', label: 'modelVisionModel', hint: 'modelVisionModelHint', kind: 'text' },
  { key: 'visionMaxTokens', label: 'modelVisionMaxTokens', hint: 'modelVisionMaxTokensHint', kind: 'number' },
  { key: 'mode', label: 'modelVisionMode', hint: 'modelVisionModeHint', kind: 'select', options: [
    { value: 'replace', label: 'modelVisionModeReplace' },
    { value: 'append', label: 'modelVisionModeAppend' },
  ] },
  { key: 'onFailure', label: 'modelVisionOnFailure', hint: 'modelVisionOnFailureHint', kind: 'select', options: [
    { value: 'pass', label: 'modelVisionOnFailurePass' },
    { value: 'throw', label: 'modelVisionOnFailureThrow' },
    { value: 'skip', label: 'modelVisionOnFailureSkip' },
  ] },
  { key: 'visionPrompt', label: 'modelVisionPrompt', hint: 'modelVisionPromptHint', kind: 'textarea' },
  { key: 'visionProvenance', label: 'modelVisionProvenance', hint: 'modelVisionProvenanceHint', kind: 'text' },
]

/** Read the effective value of one config key from the namespace. */
function readField(namespace: SettingsNamespaceView, key: string): unknown {
  return getPath(namespace.value, [key])
}

/** Safe string coercion for values read from a settings section (typed `unknown`). */
function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** True when the user layer overrides this key. */
function isOverridden(namespace: SettingsNamespaceView, key: string): boolean {
  return hasPath(namespace.user, [key])
}

/**
 * The vision configuration form.
 * @param props - the namespace view and page dependencies.
 */
export function VisionSection(props: VisionSectionProps): React.JSX.Element | null {
  const { namespace, api, t } = props
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!namespace || !api || !t) return null

  const write = async (key: string, operation: 'set' | 'unset', value?: unknown): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await api.settings.mutate({
        ns: namespace.ns,
        expectedRevision: namespace.revision,
        ops: operation === 'set' ? [{ op: 'set', path: [key], value }] : [{ op: 'unset', path: [key] }],
      })
      setSaved(true)
      window.setTimeout(() => { setSaved(false) }, 1500)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const resetAll = async (): Promise<void> => {
    const ops = FIELDS.filter(f => isOverridden(namespace, f.key)).map(f => ({ op: 'unset' as const, path: [f.key] }))
    if (ops.length === 0) return
    setBusy('*')
    setError(null)
    try {
      await api.settings.mutate({ ns: namespace.ns, expectedRevision: namespace.revision, ops })
      setSaved(true)
      window.setTimeout(() => { setSaved(false) }, 1500)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const enabled = Boolean(readField(namespace, 'enabled') ?? true)
  const anyOverridden = FIELDS.some(f => isOverridden(namespace, f.key))

  return (
    <section className={styles.editor} aria-label={t('modelVisionTitle')}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('modelVisionTitle')}</h2>
          <p className={styles.subtitle}>{t('modelVisionSubtitle')}</p>
        </div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            className={styles.toggle}
            checked={enabled}
            disabled={busy !== null}
            onChange={(e) => { void write('enabled', 'set', e.target.checked) }}
          />
          <span className={styles.toggleLabel}>{t('modelVisionEnabled')}</span>
        </label>
      </header>

      <div className={styles.fields}>
        {FIELDS.map((field) => {
          const value = readField(namespace, field.key)
          const overridden = isOverridden(namespace, field.key)
          return (
            <div key={field.key} className={styles.field}>
              <div className={styles.fieldHead}>
                <span className={styles.fieldLabel}>
                  {t(field.label)}
                  {overridden && <span className={styles.overridden} title={t('modelVisionOverriddenHint')} />}
                </span>
                {overridden && (
                  <button
                    type="button"
                    className={styles.resetLink}
                    disabled={busy !== null}
                    onClick={() => { void write(field.key, 'unset') }}
                  >
                    {t('modelVisionResetField')}
                  </button>
                )}
              </div>
              {field.kind === 'select' && (
                <select
                  className={styles.selectInput}
                  aria-label={t(field.label)}
                  value={asText(value)}
                  disabled={busy !== null}
                  onChange={(e) => { void write(field.key, 'set', e.target.value) }}
                >
                  {field.options?.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                  ))}
                </select>
              )}
              {field.kind === 'textarea' && (
                <textarea
                  className={styles.textarea}
                  aria-label={t(field.label)}
                  rows={3}
                  value={asText(value)}
                  disabled={busy !== null}
                  placeholder={t(field.hint)}
                  onChange={(e) => { void write(field.key, e.target.value === '' ? 'unset' : 'set', e.target.value === '' ? undefined : e.target.value) }}
                />
              )}
              {(field.kind === 'text' || field.kind === 'number') && (
                <input
                  type={field.kind === 'number' ? 'number' : 'text'}
                  className={styles.input}
                  aria-label={t(field.label)}
                  value={asText(value)}
                  disabled={busy !== null}
                  placeholder={t(field.hint)}
                  onChange={(e) => {
                    const v = e.target.value
                    void write(field.key, v === '' ? 'unset' : 'set', v === '' ? undefined : (field.kind === 'number' ? Number(v) : v))
                  }}
                />
              )}
              <p className={styles.hint}>{t(field.hint)}</p>
            </div>
          )
        })}
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerStatus}>
          {saved && !error && <span className={styles.savedNotice}>{t('modelVisionSaved')}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>
        <div className={styles.footerActions}>
          <Button variant="outline" disabled={!anyOverridden || busy !== null} onClick={() => { void resetAll() }}>
            {t('modelVisionResetAll')}
          </Button>
        </div>
      </footer>
    </section>
  )
}

/** Best-effort error string extraction (mirrors ProviderEditor.messageOf). */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'write failed'
}
