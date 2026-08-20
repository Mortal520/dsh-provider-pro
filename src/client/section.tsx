/**
 * dsh-provider-pro — Settings → 模型增强 section (`settings.section` slot,
 * id `provider-pro`, order 15, right under the official 模型 page).
 *
 * Minimal by design: the two capabilities this plugin adds to custom providers
 * are (1) a request-level User-Agent override and (2) official-channel-style
 * reasoning-level switching, which is purely data-driven — the host half
 * auto-fills a full `reasoningEfforts` set for every hand-declared custom
 * model, and the composer's effort dropdown appears exactly like the official
 * channels'. So this screen only needs a global master switch for that auto
 * behavior plus one User-Agent input per provider; level switching itself
 * happens in the chat model picker, not here.
 */
import { useEffect, useState } from 'react'
import type { T } from './types'
import type {
  ApiLike,
  PiAiSection,
  ProviderModel,
  ProviderProfile,
  SettingsNamespaceView,
  SettingsPathOp,
} from './types'
import { NS } from './types'
import { THINKING_LEVELS, FULL_REASONING_EFFORTS, type ThinkingLevel } from '../shared.ts'

/** Cross-render event hook the section subscribes to (wired in client/index.ts). */
export interface SectionEvents {
  on(fn: () => void): () => void
}

export interface SectionProps {
  api: ApiLike
  t: T
  events: SectionEvents
}

/** Top-level flag in the `llm-pi-ai` user layer controlling the auto-fill. */
const AUTO_REASONING_FLAG = 'dshProviderProAutoReasoning'

/* ------------------------------------------------------------------ styles */

const css = `
.dpp-root { display: flex; flex-direction: column; gap: 14px; }
.dpp-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dpp-title { font-size: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); margin: 0; line-height: 28px; }
.dpp-desc { font-size: 14px; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; line-height: 24px; }
.dpp-muted { font-size: 13px; color: var(--dsw-alias-label-secondary); line-height: 22px; }
.dpp-error { font-size: 13px; color: var(--dsw-alias-state-error-primary); }
.dpp-ok { font-size: 13px; color: var(--dsw-alias-state-success-primary); }
.dpp-switch {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
}
.dpp-switch-label { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-switch-hint { margin-top: 4px; }
.dpp-checkbox {
  width: 18px; height: 18px; margin: 3px 0 0; accent-color: var(--dsw-alias-button-primary-fill); flex: none;
}
.dpp-card {
  display: flex; flex-direction: column; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
}
.dpp-card-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dpp-provider { font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-code { font-family: var(--ds-font-family-code); font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dpp-field { display: flex; flex-direction: column; gap: 6px; }
.dpp-label { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-input {
  box-sizing: border-box; height: 32px; min-width: 16em; flex: 1; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px;
  outline: none;
}
.dpp-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dpp-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dpp-input:disabled { opacity: 0.55; }
.dpp-btn {
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 5px 12px; font-size: 13px; cursor: pointer;
}
.dpp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-primary {
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
  border: none; border-radius: 8px; padding: 6px 15px; font-size: 13px; font-weight: 500; cursor: pointer;
}
.dpp-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-foot { display: flex; align-items: center; gap: 12px; }
`

let styleInjected = false
function ensureStyle() {
  if (styleInjected) return
  styleInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-provider-pro', '')
  el.textContent = css
  document.head.appendChild(el)
}

/* ----------------------------------------------------------------- helpers */

function userSectionOf(view: SettingsNamespaceView): PiAiSection | undefined {
  const user = view.user
  if (user !== null && typeof user === 'object') return user as PiAiSection
  const value = view.value
  if (value !== null && typeof value === 'object') return value as PiAiSection
  return undefined
}

/** True when `reasoningEfforts` is byte-for-byte the auto-fill dictionary. */
function isAutoFilled(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const dict = value as Record<string, unknown>
  for (const level of THINKING_LEVELS) {
    const expected = FULL_REASONING_EFFORTS[level]
    if (expected === null ? dict[level] !== null : dict[level] !== expected) return false
  }
  return Object.keys(dict).length === THINKING_LEVELS.length
}

/** Next models array with the auto-filled dictionary removed, or undefined. */
function withoutAutoFilled(models: ProviderModel[] | undefined): ProviderModel[] | undefined {
  if (!Array.isArray(models)) return undefined
  let changed = false
  const next = models.map((entry) => {
    if (!isAutoFilled(entry.reasoningEfforts)) return entry
    changed = true
    const { reasoningEfforts: _removed, ...rest } = entry
    return rest as ProviderModel
  })
  return changed ? next : undefined
}

/* --------------------------------------------------------- provider (UA) card */

function ProviderCard(props: {
  route: string
  profile: ProviderProfile
  revision: number
  api: ApiLike
  t: T
  onSaved: () => void
}) {
  const { route, profile, revision, api, t, onSaved } = props
  const [ua, setUa] = useState(profile.userAgent ?? '')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true)
    setFailure(undefined)
    try {
      const ops: SettingsPathOp[] = [
        ua.trim().length === 0
          ? { op: 'unset', path: ['providers', route, 'userAgent'] }
          : { op: 'set', path: ['providers', route, 'userAgent'], value: ua.trim() },
      ]
      const response = await api.settings.mutate({
        ns: NS,
        ops,
        expectedRevision: revision,
      })
      if (!response.result.ok) {
        setFailure(t('saveFailed') + (response.result.error?.message ?? ''))
        return
      }
      setDirty(false)
      setSaved(true)
      onSaved()
    } catch (error) {
      setFailure(t('saveFailed') + String(error))
    } finally {
      setBusy(false)
    }
  }

  const displayName = profile.displayName ?? route
  const baseURLMeta = profile.baseURL ?? '—'
  return (
    <div className="dpp-card" role="group" aria-label={displayName}>
      <div className="dpp-card-header">
        <span className="dpp-provider">{displayName}</span>
        <code className="dpp-code">{route}</code>
        <span className="dpp-muted">{baseURLMeta}</span>
      </div>
      <div className="dpp-field">
        <label className="dpp-label" htmlFor={`ua-${route}`}>
          {t('userAgent')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            id={`ua-${route}`}
            className="dpp-input"
            type="text"
            value={ua}
            placeholder={t('userAgentPlaceholder')}
            disabled={busy}
            onChange={(event) => {
              setUa(event.target.value)
              setDirty(true)
              setSaved(false)
            }}
          />
          {dirty && ua.trim().length > 0 ? (
            <button
              type="button"
              className="dpp-btn"
              disabled={busy}
              onClick={() => {
                setUa('')
                setDirty(true)
              }}
            >
              {t('resetUa')}
            </button>
          ) : null}
        </div>
        <span className="dpp-muted">{t('userAgentHint')}</span>
        <div className="dpp-foot">
          <button type="button" className="dpp-primary" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? t('saving') : t('save')}
          </button>
          {saved ? (
            <span className="dpp-ok" role="status">
              {t('saved')}
            </span>
          ) : null}
          {failure !== undefined ? (
            <span className="dpp-error" role="status">
              {failure}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- root UI */

export function ProviderProSection(props: SectionProps) {
  const { api, t, events } = props
  ensureStyle()

  const [view, setView] = useState<SettingsNamespaceView>()
  const [loadError, setLoadError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)
  /** Current master-switch on/off (absent flag = on). */
  const [autoOn, setAutoOn] = useState(true)
  const [flipBusy, setFlipBusy] = useState(false)
  const [flipFailure, setFlipFailure] = useState<string>()
  const [flipSaved, setFlipSaved] = useState(false)

  const reload = () => setReloadKey((current) => current + 1)

  useEffect(() => {
    let cancelled = false
    setLoadError(undefined)
    void (async () => {
      try {
        const response = await api.settings.describe({})
        if (!response.result.ok) {
          if (!cancelled) setLoadError(response.result.error?.message ?? t('loadFailed'))
          return
        }
        const found = response.result.value.namespaces.find((entry) => entry.ns === NS)
        if (!cancelled && found !== undefined) {
          setView(found)
          const section = userSectionOf(found)
          setAutoOn(
            (section as { [key: string]: unknown } | undefined)?.[AUTO_REASONING_FLAG] !== false,
          )
        }
      } catch (error) {
        if (!cancelled) setLoadError(String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, reloadKey, t])

  useEffect(() => events.on(reload), [events])

  const section = view === undefined ? undefined : userSectionOf(view)
  const providers = section?.providers ?? {}
  const routes = Object.keys(providers)

  /** Flip the master switch: on is one flag write; off also reverts models
   * whose dictionary is byte-for-byte the auto-filled one. */
  const flipAuto = async (next: boolean) => {
    if (view === undefined || flipBusy) return
    setFlipBusy(true)
    setFlipFailure(undefined)
    try {
      const ops: SettingsPathOp[] = [{ op: 'set', path: [AUTO_REASONING_FLAG], value: next }]
      if (!next) {
        for (const route of routes) {
          const nextModels = withoutAutoFilled(providers[route]?.models)
          if (nextModels !== undefined) {
            ops.push({ op: 'set', path: ['providers', route, 'models'], value: nextModels })
          }
        }
      }
      const response = await api.settings.mutate({
        ns: NS,
        ops,
        expectedRevision: view.revision,
      })
      if (!response.result.ok) {
        setFlipFailure(t('saveFailed') + (response.result.error?.message ?? ''))
        return
      }
      setAutoOn(next)
      setFlipSaved(true)
      reload()
    } catch (error) {
      setFlipFailure(t('saveFailed') + String(error))
    } finally {
      setFlipBusy(false)
    }
  }

  return (
    <div className="dpp-root">
      <div className="dpp-header">
        <div>
          <h2 className="dpp-title">{t('title')}</h2>
          <p className="dpp-desc">{t('description')}</p>
        </div>
        <button type="button" className="dpp-btn" onClick={reload}>
          {t('refresh')}
        </button>
      </div>

      {loadError !== undefined ? (
        <span className="dpp-error" role="status">
          {loadError}
        </span>
      ) : null}
      {view === undefined ? (
        <span className="dpp-muted">{t('loadFailed')}</span>
      ) : section === undefined ? (
        <span className="dpp-muted">{t('nsUnavailable')}</span>
      ) : (
        <>
          <label className="dpp-switch">
            <input
              className="dpp-checkbox"
              type="checkbox"
              checked={autoOn}
              disabled={flipBusy}
              onChange={(event) => void flipAuto(event.target.checked)}
            />
            <span>
              <span className="dpp-switch-label">{t('autoReasoning')}</span>
              <span className="dpp-muted dpp-switch-hint">{t('autoReasoningHint')}</span>
              {flipFailure !== undefined ? (
                <span className="dpp-error dpp-switch-hint" role="status">
                  {flipFailure}
                </span>
              ) : null}
              {flipSaved ? (
                <span className="dpp-ok dpp-switch-hint" role="status">
                  {t('saved')}
                </span>
              ) : null}
            </span>
          </label>

          {routes.length === 0 ? (
            <span className="dpp-muted">{t('noProviders')}</span>
          ) : (
            routes.map((route) => (
              <ProviderCard
                key={route}
                route={route}
                profile={providers[route] ?? {}}
                revision={view.revision}
                api={api}
                t={t}
                onSaved={reload}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}