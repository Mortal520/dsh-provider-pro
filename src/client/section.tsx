/**
 * dsh-provider-pro — Settings → 模型增强 section (`settings.section` slot,
 * id `provider-pro`, order 15, right under the official 模型 page).
 *
 * Minimal by design: the two capabilities this plugin adds to custom providers
 * are (1) a request-level User-Agent override and (2) official-channel-style
 * reasoning-level switching, which is purely data-driven — the host half
 * auto-fills a five-level `reasoningEfforts` set (off/low/medium/high/max)
 * for every hand-declared custom model, and the composer's effort dropdown
 * appears exactly like the official channels'. So this screen only needs a
 * global master switch for that auto behavior plus one User-Agent input per
 * provider; level switching itself happens in the chat model picker, not here.
 */
import { useEffect, useState } from 'react'
import type { T } from './types'
import type {
  PiAiSection,
  ProviderModel,
  ProviderProfile,
  ProbeResult,
  SettingsNamespaceView,
  SettingsPathOp,
  SettingsWireFace,
} from './types'
import { NS } from './types'
import { FILL_REASONING_EFFORTS, LEGACY_REASONING_EFFORTS, INPUT_WITH_IMAGE, matchesEfforts, PROBE_REQ_FLAG, PROBE_RESULT_FLAG } from '../shared.ts'

/** Cross-render event hook the section subscribes to (wired in client/index.ts). */
export interface SectionEvents {
  on(fn: () => void): () => void
}

export interface SectionProps {
  /** The `ctx.remote.settings` wire face (DSH 2.0.x); undefined when absent. */
  api: SettingsWireFace | undefined
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
.dpp-switch-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dpp-switch-label { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); line-height: 20px; }
.dpp-switch-hint { margin-top: 2px; white-space: pre-line; }
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
.dpp-models { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.dpp-models-scroll { max-height: 280px; overflow-y: auto; }
.dpp-models-title { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.dpp-toggle-btn {
  background: none; border: none; cursor: pointer; font-size: 10px;
  color: var(--dsw-alias-label-secondary); padding: 2px 4px; line-height: 1;
  transition: transform 0.15s;
}
.dpp-model-row {
  display: flex; align-items: center; gap: 10px; padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 13px;
}
.dpp-model-row:last-child { border-bottom: none; }
.dpp-model-id { font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dpp-model-caps { display: inline-flex; gap: 4px; flex: none; }
.dpp-caps-chip {
  font-family: var(--ds-font-family-code); font-size: 11px; line-height: 16px;
  padding: 0 6px; border-radius: 8px; flex: none;
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary);
}
.dpp-model-cb { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.dpp-model-cb input { width: 14px; height: 14px; accent-color: var(--dsw-alias-button-primary-fill); margin: 0; }
.dpp-model-cb-label { color: var(--dsw-alias-label-secondary); }
.dpp-probe-btn {
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  padding: 2px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dpp-probe-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-probe-result { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 4px 0 2px; line-height: 18px; }
.dpp-probe-ok { color: var(--dsw-alias-state-success-primary); }
.dpp-probe-fail { color: var(--dsw-alias-state-error-primary); }
.dpp-alive-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-border-l2);
}
.dpp-alive-dot.up { background: var(--dsw-alias-state-success-primary); }
.dpp-alive-dot.down { background: var(--dsw-alias-state-error-primary); }
.dpp-alive-dot.unknown { background: var(--dsw-alias-border-l3); }
.dpp-provider-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; border-radius: 9px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
.dpp-provider-badge.up { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); border-color: transparent; }
.dpp-provider-badge.down { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); border-color: transparent; }
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

/**
 * True when `reasoningEfforts` is byte-for-byte one of our auto-fill shapes:
 * the current five-level dictionary, or the seven-level dictionary written by
 * 0.1.0–0.2.0 (legacy). A hand-customized dictionary never matches.
 */
function isAutoFilled(value: unknown): boolean {
  return matchesEfforts(value, FILL_REASONING_EFFORTS) || matchesEfforts(value, LEGACY_REASONING_EFFORTS)
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

/* -------------------------------------------------------- probe via LLM catalog */

/** Result written by the host half after running a real probe. */
interface HostProbeResult {
  id: string
  provider: string
  model: string
  ok: boolean
  mode?: 'full' | 'capabilities' | 'deep'
  firstTokenMs?: number | null
  totalMs?: number
  finishReason?: string
  imageProbe?: boolean
  imageSupported?: boolean
  /** developer-role admission: admitted = wire accepts developer, fixed = compat written, already = already off. */
  roleFix?: 'admitted' | 'fixed' | 'already' | 'failed'
  /** Efforts probe: wire-accepted levels + refused ones + whether settings were rewritten. */
  levels?: string[]
  unsupported?: string[]
  applied?: boolean
  declaredNonReasoning?: boolean
  contextWindow?: number
  maxTokens?: number
  backfilled?: number
  error?: string
}

/**
 * Ask the host half to run a real probe through DSH's LLM runtime. The host
 * (a) mints a 1×1 PNG attachment, (b) streams a minimal request carrying it,
 * and (c) writes the result back to the `dshProviderProProbeResult` settings
 * slot. The client (this function) writes the request, then waits for the
 * settings event (which fires when the host publishes the result) up to a
 * timeout.
 *
 * IPC path: both halves exchange through the llm-pi-ai user layer — the host
 * listens to `settings/updated`, consumes `PROBE_REQ_FLAG`, and publishes
 * `PROBE_RESULT_FLAG`. The `events` bus re-emits `settings/document-updated`
 * so we wake on the host's write instead of busy-polling `describe()`.
 */
async function sendProbeRequest(
  api: SettingsWireFace,
  provider: string,
  model: string,
  events: SectionEvents,
  mode: 'full',
): Promise<ProbeResult> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  // Freshest revision: the write advances the document, and probe-all walks
  // many models in sequence, so a section-load snapshot goes stale quickly.
  const snapshot = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined)
  const nsView = snapshot?.namespaces.find((entry) => entry.ns === NS)
  if (nsView === undefined) {
    return { status: 'failure', provider, model, failure: { code: 'NO_NS', message: 'llm-pi-ai namespace not readable' } }
  }
  // Clear any stale result for this probe; write the request. The host reacts
  // on the resulting settings/updated, runs the probe, then publishes.
  const write = await api.mutate(NS, [
    { op: 'set', path: [PROBE_REQ_FLAG], value: { id, provider, model, mode } },
  ], nsView.revision)
  if (!write.ok) {
    return { status: 'failure', provider, model, failure: { code: 'WRITE_FAIL', message: write.error?.message ?? 'probe request write failed' } }
  }

  /** Read the probe-result slot from the freshest settings view. */
  const readSlot = async (): Promise<HostProbeResult | undefined> => {
    const view = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined)
    const ns = view?.namespaces.find((entry) => entry.ns === NS)
    const user = (ns?.user ?? ns?.value ?? {}) as Record<string, unknown>
    const slot = user[PROBE_RESULT_FLAG]
    if (slot === undefined || typeof slot !== 'object') return undefined
    const result = slot as HostProbeResult
    return result.id === id ? result : undefined
  }

  // Wait on the settings event (host writes the result) with a timeout cap.
  const answer = await new Promise<HostProbeResult | undefined>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposer: (() => void) | undefined
    const done = (value: HostProbeResult | undefined) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      disposer?.()
      resolve(value)
    }
    disposer = events.on(() => {
      void readSlot().then(done)
    })
    timer = setTimeout(() => done(undefined), 12000)
    // One immediate read in case the result already landed before we attached.
    void readSlot().then((value) => { if (value !== undefined) done(value) })
  })

  if (answer === undefined) {
    // Timeout: likely the host probe never ran (LLM runtime absent) or the
    // request is stuck. Clean the request slot so a retry re-fires.
    const fresh = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined)
    const freshNs = fresh?.namespaces.find((entry) => entry.ns === NS)
    if (freshNs !== undefined) {
      void api.mutate(NS, [{ op: 'unset', path: [PROBE_REQ_FLAG] }], freshNs.revision).catch(() => undefined)
    }
    return { status: 'failure', provider, model, failure: { code: 'TIMEOUT', message: 'probe timed out (host probe did not respond)' } }
  }

  if (!answer.ok) {
    const base = answer.error ?? (answer.imageSupported === false ? 'model does not accept image input' : 'probe failed')
    // Role-repair note: the deep probe hit a role rejection and the host
    // verified + repaired (or could not repair) the developer-role compat.
    const note = answer.roleFix === 'fixed'
      ? ' (role-fix: developer rejected → compat written, retry)'
      : answer.roleFix === 'failed'
        ? ' (role-fix attempted but write failed)'
        : undefined
    return {
      status: 'failure', provider, model, totalMs: answer.totalMs,
      failure: {
        code: answer.imageSupported === false ? 'IMAGE_UNSUPPORTED' : 'PROBE_FAIL',
        message: note !== undefined ? base + note : base,
      },
    }
  }
  if (answer.mode === 'full') {
    // One-button probe: capacity + role admission + effort levels + image.
    const parts: string[] = []
    if (answer.contextWindow !== undefined) parts.push(`ctx: ${answer.contextWindow}`)
    if (answer.maxTokens !== undefined) parts.push(`max: ${answer.maxTokens}`)
    if (answer.roleFix === 'admitted') parts.push('role: developer')
    else if (answer.roleFix === 'already') parts.push('role: system')
    else if (answer.roleFix === 'fixed') parts.push('role: system (fixed)')
    else if (answer.roleFix === 'failed') parts.push('role: unresolved')
    if (answer.levels !== undefined && answer.levels.length > 0) parts.push(`efforts: ${answer.levels.join('/')}`)
    else if (answer.declaredNonReasoning === true) parts.push('efforts: non-reasoning')
    else parts.push('efforts: none')
    if (answer.unsupported !== undefined && answer.unsupported.length > 0) parts.push(`rejected: ${answer.unsupported.join('/')}`)
    if (answer.imageProbe) parts.push('image: accepted')
    else if (answer.imageSupported === false) parts.push('image: rejected')
    if (answer.firstTokenMs !== undefined && answer.firstTokenMs !== null) parts.push(`first-token: ${answer.firstTokenMs}ms`)
    if (answer.applied) parts.push('written')
    if (answer.backfilled !== undefined && answer.backfilled > 0) parts.push(`backfilled: ${answer.backfilled}`)
    return {
      status: 'success', provider, model, totalMs: answer.totalMs,
      firstTokenMs: answer.firstTokenMs,
      finishReason: parts.join(' · '),
      usage: {},
    }
  }
  if (answer.mode === 'capabilities') {
    // Legacy host (pre-0.5.0) answered a capabilities probe: capacity only.
    const caps: string[] = []
    if (answer.contextWindow !== undefined) caps.push(`ctx: ${answer.contextWindow}`)
    if (answer.maxTokens !== undefined) caps.push(`max: ${answer.maxTokens}`)
    if (caps.length === 0) caps.push('no capacity info')
    if (answer.backfilled !== undefined && answer.backfilled > 0) caps.push(`backfilled: ${answer.backfilled}`)
    return {
      status: 'success', provider, model, totalMs: answer.totalMs,
      firstTokenMs: answer.firstTokenMs,
      finishReason: caps.join(' · '),
      usage: {},
    }
  }
  return {
    status: 'failure', provider, model,
    failure: { code: 'PROBE_FAIL', message: `unknown probe mode: ${String(answer.mode)}` },
  }
}

/* -------------------------------------------------------- model row (image input + probe) */

function ModelRow(props: {
  route: string
  profile: ProviderProfile
  modelIndex: number
  revision: number
  api: SettingsWireFace
  events: SectionEvents
  t: T
  probeResult?: ProbeResult
  onMutated: () => void
}) {
  const { route, profile, modelIndex, revision, api, events, t, probeResult: probeAllResult, onMutated } = props
  const model = profile.models?.[modelIndex]
  if (!model) return null
  const hasImage = Array.isArray(model.input) && model.input.includes('image')
  const [probeResult, setProbeResult] = useState<ProbeResult>()
  const [probeBusy, setProbeBusy] = useState(false)

  // Merge: per-model probe result takes priority over probe-all result
  const displayResult = probeResult ?? probeAllResult

  // Declared capacity from the settings entry (hand-set or probe-backfilled).
  // Compact display: 1024-multiples render KiB-style (262144 → 256k),
  // 1000-multiples decimal-style (200000 → 200k), anything else raw.
  const fmtTokens = (n: number): string => {
    if (n % 1024 === 0) return `${n / 1024}k`
    if (n % 1000 === 0) return `${n / 1000}k`
    return String(n)
  }
  const declaredCaps = [model.contextWindow, model.maxTokens].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  )
  const capsTitle = [
    model.contextWindow !== undefined ? `ctx ${model.contextWindow}` : undefined,
    model.maxTokens !== undefined ? `max ${model.maxTokens}` : undefined,
  ].filter(Boolean).join(' · ')

  const toggleImage = async (next: boolean) => {
    // Build the full models array with the target model's input field updated.
    // Writing the whole array avoids pi-ai path-resolution issues with
    // string-encoded array indices in nested settings paths.
    const models = (profile.models ?? []).map((entry, idx) => {
      if (idx !== modelIndex) return entry
      const copy = { ...entry }
      if (next) {
        copy.input = [...INPUT_WITH_IMAGE]
      } else {
        delete copy.input
      }
      return copy
    })
    const op: SettingsPathOp = { op: 'set', path: ['providers', route, 'models'], value: models }
    const response = await api.mutate(NS, [op], revision)
    if (response.ok) onMutated()
  }

  const runProbe = async () => {
    setProbeBusy(true)
    setProbeResult(undefined)
    try {
      setProbeResult(await sendProbeRequest(api, route, model.id, events, 'full'))
    } catch (error: unknown) {
      const err = error as { message?: string }
      setProbeResult({ status: 'failure', provider: route, model: model.id, totalMs: 0, failure: { code: 'ERROR', message: err.message ?? String(error) } })
    } finally {
      setProbeBusy(false)
    }
  }

  // Alive status: capabilities success (gateway reachable) or deep success
  // (real inference worked) both mean the model responds.
  const aliveStatus: 'up' | 'down' | 'unknown' = displayResult === undefined
    ? 'unknown'
    : (displayResult.status === 'success' ? 'up' : 'down')

  return (
    <div className="dpp-model-row">
      <span className={'dpp-alive-dot ' + aliveStatus} title={aliveStatus} />
      <span className="dpp-model-id" title={model.id}>{model.id}</span>
      {declaredCaps.length > 0 ? (
        <span className="dpp-model-caps" title={capsTitle}>
          {declaredCaps.map((n, i) => <span key={i} className="dpp-caps-chip">{fmtTokens(n)}</span>)}
        </span>
      ) : null}
      <label className="dpp-model-cb">
        <input
          type="checkbox"
          checked={hasImage}
          onChange={(e) => void toggleImage(e.target.checked)}
        />
        <span className="dpp-model-cb-label">{t('imageInput')}</span>
      </label>
      <button type="button" className="dpp-probe-btn" disabled={probeBusy} title={t('probeHint')} onClick={() => void runProbe()}>
        {probeBusy ? t('probing') : t('probe')}
      </button>
      {displayResult ? (
        <span className={'dpp-probe-result ' + (displayResult.status === 'success' ? 'dpp-probe-ok' : 'dpp-probe-fail')}>
          {displayResult.status === 'success'
            ? displayResult.finishReason ?? ''
            : `${displayResult.failure?.code ?? 'ERR'}: ${displayResult.failure?.message ?? ''}`}
        </span>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------- provider (UA) card */

function ProviderCard(props: {
  route: string
  profile: ProviderProfile
  revision: number
  api: SettingsWireFace
  events: SectionEvents
  t: T
  onSaved: () => void
}) {
  const { route, profile, revision, api, events, t, onSaved } = props
  const [ua, setUa] = useState(profile.userAgent ?? '')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [probeAllResults, setProbeAllResults] = useState<Map<string, ProbeResult>>(new Map())
  const [probeAllBusy, setProbeAllBusy] = useState(false)
  const [modelsExpanded, setModelsExpanded] = useState(false)

  const save = async () => {
    setBusy(true)
    setFailure(undefined)
    try {
      const ops: SettingsPathOp[] = [
        ua.trim().length === 0
          ? { op: 'unset', path: ['providers', route, 'userAgent'] }
          : { op: 'set', path: ['providers', route, 'userAgent'], value: ua.trim() },
      ]
      const response = await api.mutate(NS, ops, revision)
      if (!response.ok) {
        setFailure(t('saveFailed') + (response.error?.message ?? ''))
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
  const modelCount = profile.models?.length ?? 0

  const probeAll = async () => {
    if (!profile.models?.length) return
    setProbeAllBusy(true)
    setProbeAllResults(new Map())
    const results = new Map<string, ProbeResult>()
    // Same full probe as the per-model button, walked across the roster:
    // each result also feeds the provider-level alive badge.
    for (const model of profile.models) {
      results.set(model.id, await sendProbeRequest(api, route, model.id, events, 'full'))
      setProbeAllResults(new Map(results))
    }
    setProbeAllBusy(false)
  }

  // Provider-level alive badge: aggregated from per-model results. Any
  // success = up; all failures = down; none run yet = untested.
  const providerAlive: 'up' | 'down' | 'unknown' = (() => {
    if (probeAllResults.size === 0) return 'unknown'
    const values = [...probeAllResults.values()]
    return values.some((r) => r.status === 'success') ? 'up' : 'down'
  })()
  return (
    <div className="dpp-card" role="group" aria-label={displayName}>
      <div className="dpp-card-header">
        <span className={'dpp-provider-badge ' + providerAlive} title={providerAlive}>
          {providerAlive === 'up' ? '✓' : providerAlive === 'down' ? '✗' : '·'}
        </span>
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
      {Array.isArray(profile.models) && profile.models.length > 0 ? (
        <div className="dpp-models">
          <div className="dpp-models-title">
            <button type="button" className="dpp-toggle-btn" onClick={() => setModelsExpanded(v => !v)}>
              {modelsExpanded ? '▼' : '▶'}
            </button>
            <span>{t('models')}（{modelCount}）</span>
            {modelsExpanded ? (
              <button type="button" className="dpp-probe-btn" disabled={probeAllBusy} onClick={() => void probeAll()}>
                {probeAllBusy ? t('probing') : t('probeAll')}
              </button>
            ) : null}
          </div>
          {modelsExpanded ? (
            <div className="dpp-models-scroll">
              {profile.models.map((model, idx) => (
                <ModelRow
                  key={model.id}
                  route={route}
                  profile={profile}
                  modelIndex={idx}
                  revision={revision}
                  api={api}
                  events={events}
                  t={t}
                  probeResult={probeAllBusy || probeAllResults.size > 0 ? probeAllResults.get(model.id) : undefined}
                  onMutated={onSaved}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
    if (api === undefined) return
    void (async () => {
      try {
        const response = await api.describe()
        if (!response.ok) {
          if (!cancelled) setLoadError(response.error?.message ?? t('loadFailed'))
          return
        }
        const found = response.value.namespaces.find((entry) => entry.ns === NS)
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
   * whose dictionary is byte-for-byte one of our auto-filled shapes. */
  const flipAuto = async (next: boolean) => {
    if (api === undefined || view === undefined || flipBusy) return
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
      const response = await api.mutate(NS, ops, view.revision)
      if (!response.ok) {
        setFlipFailure(t('saveFailed') + (response.error?.message ?? ''))
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
      {api === undefined ? (
        <span className="dpp-muted">{t('rpcUnavailable')}</span>
      ) : view === undefined ? (
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
            <span className="dpp-switch-body">
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
                events={events}
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