/**
 * dsh-provider-pro — Host half.
 *
 * Gives every hand-declared provider route in the `llm-pi-ai` settings
 * namespace a custom `User-Agent` that actually reaches the wire.
 *
 * Why a global fetch patch: the harness attribution header wins by design.
 * In older builds pi-ai's `requestHeaders()` filtered any case variant of
 * `user-agent` out of a profile's `headers`; in DSH 2.0.x the attribution
 * headers come from `@deepseek-ai/dsh-llm` and pi-ai's header merge strips
 * case-insensitive collisions with them — either way a User-Agent stored in
 * `headers` can never win. The provider SDKs
 * (openai/anthropic) construct their HTTP clients with `fetch` taken from the
 * global at construction time, which makes a minimal, URL-scoped patch of
 * `globalThis.fetch` the one plugin-reachable injection point. The patch only
 * rewrites `user-agent` for requests whose URL starts with a configured
 * provider baseURL; everything else passes through untouched.
 *
 * The User-Agent value itself lives at `llm-pi-ai.providers.<route>.userAgent`
 * — an open profile field the pi-ai schema does not strip and the adapter
 * never reads, so it is a pure configuration storage the patch consumes.
 *
 * The same effect also runs an auto-fill pass ("补档器"): every hand-declared
 * model entry in the user layer that has no `reasoningEfforts` gets the
 * five-level dictionary (off/low/medium/high/max) written for it. pi-ai
 * reports a model with that dictionary as a reasoning model, and the
 * composer's model dropdown then offers the same effort switching the official
 * channels get — defaulting to the "Default" tier (no `defaultEffort` is set,
 * so the picker pre-selects its own Default option). Explicit `false` and
 * declared dictionaries are never overwritten; byte-exact dictionaries from
 * the 0.1.0–0.2.0 seven-level fill migrate down to the current set.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  FILL_REASONING_EFFORTS,
  LEGACY_REASONING_EFFORTS,
  matchesEfforts,
  PROBE_REQ_FLAG,
  PROBE_RESULT_FLAG,
} from './shared.ts'

/** The pi-ai adapter's settings namespace, whose providers we extend. */
const NS = 'llm-pi-ai'

/** Resolve the custom user-agent for an outgoing request URL, or undefined. */
type UaResolver = (url: string) => string | undefined

/**
 * Long-lived patch state. The wrapper function itself is installed exactly
 * once for the lifetime of the process; HMR/reload only swaps the resolver,
 * so the patch never double-wraps.
 */
const STATE_KEY = Symbol.for('dsh-provider-pro.fetch-state')
interface FetchState {
  original: typeof fetch | undefined
  resolver: UaResolver | undefined
}
const state: FetchState = ((globalThis as Record<symbol, FetchState | undefined>)[STATE_KEY] ??= {
  original: undefined,
  resolver: undefined,
})

/** Normalize any fetch input to a URL string. */
function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (typeof input === 'object' && input !== null && 'url' in input) {
    const url = (input as { url: unknown }).url
    if (typeof url === 'string') return url
  }
  return ''
}

/** Install the UA-rewriting fetch wrapper once, returning whether patched. */
function installFetchPatch(): boolean {
  if (state.original !== undefined) return true
  const original = globalThis.fetch
  if (typeof original !== 'function') return false
  state.original = original
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const resolver = state.resolver
    if (resolver === undefined) return original(input as RequestInfo | URL, init)
    const url = urlOf(input)
    const ua = resolver(url)
    if (ua === undefined) return original(input as RequestInfo | URL, init)
    // Merge the existing header source (init wins over the request's own),
    // then force the configured user-agent. Replacing, not appending, is
    // required: the SDK default UA and the harness attribution header are
    // already present somewhere in the chain at this point.
    const headers = new Headers(
      init?.headers ?? (typeof input === 'object' && input !== null && 'headers' in input
        ? (input as Request).headers
        : undefined),
    )
    headers.set('user-agent', ua)
    if (typeof input === 'string' || input instanceof URL) {
      return original(input, { ...(init ?? {}), headers })
    }
    // Request input: fold everything (headers included) into one request so
    // the caller's init cannot re-apply its own headers over ours.
    return original(new Request(input as Request, { ...(init ?? {}), headers }), undefined)
  }
  return true
}

/** Longest-prefix match of a URL against configured provider baseURLs. */
function buildResolver(getSection: () => unknown): UaResolver {
  return (url) => {
    const section = getSection() as
      | { providers?: Record<string, { baseURL?: unknown; userAgent?: unknown }> }
      | undefined
    const providers = section?.providers
    if (providers === undefined || typeof providers !== 'object') return undefined
    let best: { base: string; ua: string } | undefined
    for (const profile of Object.values(providers)) {
      if (profile === null || typeof profile !== 'object') continue
      const base = profile.baseURL
      const raw = profile.userAgent
      if (typeof base !== 'string' || base.length === 0) continue
      if (typeof raw !== 'string') continue
      const ua = raw.trim()
      if (ua.length === 0) continue
      if (!url.startsWith(base)) continue
      if (best === undefined || base.length > best.base.length) best = { base, ua }
    }
    return best?.ua
  }
}

/** Read the current `llm-pi-ai` section through the settings service. */
function readSection(ctx: Context): unknown {
  const settings = (ctx as unknown as { get(key: string): unknown }).get('settings')
  if (settings === undefined) return undefined
  try {
    return (settings as unknown as { get(ns: string): unknown }).get(NS)
  } catch {
    return undefined
  }
}

/** The slice of the settings service the auto-fill pass needs. */
interface SettingsLike {
  section(ns: string): unknown
  mutate(ns: string, ops: unknown[]): Promise<unknown>
}
function settingsApi(ctx: Context): SettingsLike | undefined {
  const settings = (ctx as unknown as { get(key: string): unknown }).get('settings')
  if (settings === undefined) return undefined
  const api = settings as unknown as SettingsLike
  if (typeof api.section !== 'function' || typeof api.mutate !== 'function') return undefined
  return api
}

type ModelEntry = { reasoningEfforts?: unknown; [key: string]: unknown }
type RouteProfile = { models?: unknown; [key: string]: unknown }

/** Top-level flag in the `llm-pi-ai` user layer controlling the auto-fill. */
const AUTO_REASONING_FLAG = 'dshProviderProAutoReasoning'

/* ------------------------------------------------------------ probe IPC */

/** A 1×1 transparent PNG used to test image admission on the real wire. */
const PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Serialize the llm-chunk stream types the probe observes. */
interface ProbeChunk {
  type?: string
  text?: string
  index?: number
  reason?: unknown
  usage?: { completionTokens?: number }
}

/** Read the human-readable finish reason from a `finish` chunk. */
function reasonText(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason === null || typeof reason !== 'object') return 'stop'
  const entry = reason as Record<string, unknown>
  // DSH FinishReason: { kind: 'stop'|'tool-calls'|'max-tokens'|'aborted'|'error', failure? }
  if (typeof entry.kind === 'string') {
    if (entry.kind === 'error' || entry.kind === 'aborted') {
      const failure = entry.failure
      if (failure !== null && typeof failure === 'object') {
        const message = (failure as Record<string, unknown>).message
        if (typeof message === 'string') return `${entry.kind}: ${message}`
      }
    }
    return entry.kind
  }
  if (typeof entry.code === 'string') return entry.code
  return 'stop'
}

/* ----------------------------------------------------------- wire-level probes */

/** One minimal OpenAI-completions wire POST result. */
interface WireProbe {
  status: number
  ok: boolean
  /** Truncated body text (error detail or empty on transport failure). */
  body: string
}

/** Read-only credential resolution, mirroring how pi-ai resolves apiKeyEnv. */
async function resolveProviderKey(ctx: Context, apiKeyEnv: unknown): Promise<string | undefined> {
  if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) return undefined
  const credentials = (ctx as unknown as { get(key: string): unknown }).get('credentials') as
    | { resolve(ref: string): Promise<{ value?: string } | undefined> }
    | undefined
  if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
  try {
    const hit = await credentials.resolve(apiKeyEnv)
    const value = hit?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** POST one minimal chat-completions request; never throws. */
async function wirePost(
  baseURL: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<WireProbe> {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(body),
      // 10s per wire request: a healthy relay answers in 2-3s; anything
      // slower is treated as refused so the whole probe stays inside the
      // client's 60s wait cap even when several requests stall.
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text().catch(() => '')
    return { status: response.status, ok: response.ok, body: text.slice(0, 400) }
  } catch (error) {
    return { status: 0, ok: false, body: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Full per-model probe — one button, everything measured:
 *
 * 1. context window/maxTokens — `discoverModels` (GET /v1/models), the
 *    gateway's declared listing; missing values are backfilled.
 * 2. message-role admission — pi-ai's OpenAI-completions compat defaults
 *    `supportsDeveloperRole` to true, so a reasoning-capable model makes
 *    pi-ai send its system prompt as `developer`, which some upstreams
 *    (GLM relay, error 1214 角色信息不正确) refuse. One developer POST +
 *    one system baseline settles it; a refusal with a passing `system`
 *    writes `compat.supportsDeveloperRole: false`.
 * 3. reasoning-effort levels — each of low/medium/high/max gets one minimal
 *    request carrying the declared wire spelling; refused levels are
 *    dropped and the validated `reasoningEfforts` dict is written back
 *    (all levels refused → the entry becomes a non-reasoning model,
 *    `reasoningEfforts: false`).
 * 4. image admission — a real stream carrying a 1×1 PNG through the LLM
 *    runtime measures first-token latency and whether the wire accepted
 *    the image (run last, after any role fix, so it exercises the exact
 *    configuration the chat will use).
 *
 * Everything lands in ONE models-array mutate (backfill + compat + efforts)
 * before the stream, so results can never clobber each other.
 */
async function runFullProbe(
  ctx: Context,
  provider: string,
  profile: Record<string, unknown> | undefined,
  baseURL: string | undefined,
  model: string,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  const llm = (ctx as unknown as { get(key: string): unknown }).get('llm') as
    | {
        stream(options: unknown): AsyncIterable<ProbeChunk>
        discoverModels(ns: string, request: { provider?: string; baseURL?: string }, signal?: AbortSignal): Promise<Array<{ id: string; contextWindow?: number; maxTokens?: number }>>
      }
    | undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    return { ok: false, mode: 'full', error: 'LLM runtime not available' }
  }

  // 1. Discovery — declared capacity listing.
  let discovered: Array<{ id: string; contextWindow?: number; maxTokens?: number }> = []
  let discoveryError: string | undefined
  if (typeof llm.discoverModels === 'function' && baseURL !== undefined) {
    try {
      discovered = await llm.discoverModels('llm-pi-ai', { provider, baseURL })
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : String(error)
    }
  }
  const thisModel = discovered.find((entry) => entry.id === model)

  const api = typeof profile?.api === 'string' ? profile.api : 'openai-completions'
  const models = Array.isArray(profile?.models) ? profile?.models as Array<Record<string, unknown>> : undefined
  const entry = models?.find((m) => m.id === model)

  // 2+3. Wire checks (role admission, effort levels) — openai-completions only.
  let roleFix: 'admitted' | 'fixed' | 'already' | 'failed' | 'skipped' = 'skipped'
  let levels: string[] = []
  let unsupported: string[] = []
  let declaredNonReasoning = false
  let baselineError: string | undefined
  const canWire = baseURL !== undefined && api === 'openai-completions' && entry !== undefined
  if (canWire) {
    const apiKey = await resolveProviderKey(ctx, profile?.apiKeyEnv)
    const send = (messages: unknown[], extra: Record<string, unknown> = {}): Promise<WireProbe> =>
      wirePost(baseURL!, apiKey, { model, messages, max_tokens: 1, ...extra })
    // Baseline: a plain user message must pass or the rest is meaningless.
    const baseline = await send([{ role: 'user', content: 'Reply OK' }])
    if (!baseline.ok) {
      baselineError = baseline.status === 0 ? `unreachable: ${baseline.body}` : `baseline ${baseline.status}: ${baseline.body}`
    } else {
      // Role admission.
      const compat = (entry!.compat ?? {}) as Record<string, unknown>
      if (compat.supportsDeveloperRole === false) {
        roleFix = 'already'
      } else if ((await send([{ role: 'developer', content: 'Reply OK' }])).ok) {
        roleFix = 'admitted'
      } else {
        const systemOk = (await send([{ role: 'system', content: 'Reply OK' }])).ok
        roleFix = systemOk ? 'fixed' : 'failed'
      }
      // The role pi-ai will actually send: developer only when admitted.
      const probeRole = roleFix === 'admitted' ? 'developer' : 'system'
      // Effort levels — a declared non-reasoning model stays as-is.
      if (entry!.reasoningEfforts === false) {
        declaredNonReasoning = true
      } else {
        const declared = (entry!.reasoningEfforts !== undefined && typeof entry!.reasoningEfforts === 'object' && entry!.reasoningEfforts !== null)
          ? entry!.reasoningEfforts as Record<string, unknown>
          : undefined
        for (const level of ['low', 'medium', 'high', 'max'] as const) {
          const declaredWire = declared?.[level]
          const wire = typeof declaredWire === 'string' && declaredWire.length > 0 ? declaredWire : level
          const probe = await send([{ role: probeRole, content: 'Reply OK' }], { reasoning_effort: wire })
          if (probe.ok) levels.push(level)
          else unsupported.push(level)
        }
      }
    }
  }

  // Combined write: capacity backfill + compat fix + validated effort dict
  // in one models-array mutate, only when something actually changed.
  let applied = false
  let backfilled = 0
  const nextDict: Record<string, unknown> | false | undefined = levels.length > 0
    ? { off: null, ...Object.fromEntries(levels.map((level) => [level, level])) }
    : (canWire && baselineError === undefined && !declaredNonReasoning ? false : undefined)
  const dictChanged = nextDict !== undefined && JSON.stringify(nextDict) !== JSON.stringify(entry?.reasoningEfforts)
  const compatChanged = roleFix === 'fixed'
  if ((discovered.length > 0 || dictChanged || compatChanged) && models !== undefined) {
    const next = models.map((m) => {
      const disc = discovered.find((d) => d.id === m.id)
      if (m.id !== model && disc === undefined) return m
      const copy: Record<string, unknown> = { ...m }
      if (disc !== undefined) {
        if (copy.contextWindow === undefined && disc.contextWindow !== undefined) { copy.contextWindow = disc.contextWindow; backfilled++ }
        if (copy.maxTokens === undefined && disc.maxTokens !== undefined) { copy.maxTokens = disc.maxTokens; backfilled++ }
      }
      if (m.id === model) {
        if (dictChanged) copy.reasoningEfforts = nextDict
        if (compatChanged) copy.compat = { ...((m.compat ?? {}) as Record<string, unknown>), supportsDeveloperRole: false }
      }
      return copy
    })
    const settings = settingsApi(ctx)
    if (settings !== undefined) {
      try {
        await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }])
        applied = true
      } catch {
        applied = false
      }
    }
  }

  // 4. Image admission + latency — real stream through the LLM runtime,
  // after the role fix, so it exercises the exact post-fix configuration.
  let attachment: unknown
  let imageProbe = false
  try {
    const attachments = (ctx as unknown as { get(key: string): unknown }).get('attachments') as
      | { saveImages(inputs: Array<{ data: Uint8Array; mediaType: string }>): Promise<unknown[]> }
      | undefined
    if (attachments !== undefined && typeof attachments.saveImages === 'function') {
      const bytes = new Uint8Array(Buffer.from(PROBE_IMAGE_BASE64, 'base64'))
      const refs = await attachments.saveImages([{ data: bytes, mediaType: 'image/png' }])
      attachment = refs[0]
      imageProbe = true
    }
  } catch {
    // attachment store failure — text-only probe
  }
  const content = attachment !== undefined
    ? [
        { type: 'text', text: 'Reply with OK.' },
        { type: 'image', attachment },
      ]
    : [{ type: 'text', text: 'Reply with OK.' }]
  let firstTokenMs: number | null = null
  let finishReason = ''
  try {
    const stream = llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content }],
      maxTokens: 8,
    }) as AsyncIterable<ProbeChunk>
    for await (const chunk of stream) {
      if (firstTokenMs === null && chunk.type === 'text-delta') {
        firstTokenMs = Date.now() - startedAt
      }
      if (chunk.type === 'finish') {
        finishReason = reasonText((chunk as { reason?: unknown }).reason)
      }
    }
    return {
      ok: baselineError === undefined && roleFix !== 'failed',
      mode: 'full',
      totalMs: Date.now() - startedAt,
      firstTokenMs,
      finishReason: finishReason || 'stop',
      imageProbe,
      roleFix,
      levels,
      unsupported,
      declaredNonReasoning,
      applied,
      backfilled,
      contextWindow: thisModel?.contextWindow,
      maxTokens: thisModel?.maxTokens,
      ...(baselineError !== undefined ? { error: baselineError } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const imageRejected = /image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(message)
    return {
      ok: false,
      mode: 'full',
      totalMs: Date.now() - startedAt,
      imageProbe,
      imageSupported: imageRejected ? false : undefined,
      roleFix,
      levels,
      unsupported,
      declaredNonReasoning,
      applied,
      backfilled,
      contextWindow: thisModel?.contextWindow,
      maxTokens: thisModel?.maxTokens,
      error: message,
    }
  }
}

/**
 * One auto-fill pass: give every hand-declared model without a
 * `reasoningEfforts` the five-level dictionary (off/low/medium/high/max),
 * and migrate models still carrying the byte-exact seven-level dictionary
 * auto-filled by 0.1.0–0.2.0 down to the current set. Explicit `false` and
 * hand-customized dictionaries are never overwritten. Applies through
 * `settings.mutate` (path ops, no expected revision — background best-effort)
 * and only writes when something actually changes, so the next
 * `settings/updated` it triggers is a no-op scan. The master switch
 * (top-level `dshProviderProAutoReasoning`, absent = on) disables the pass
 * entirely.
 */
async function fillEfforts(ctx: Context): Promise<void> {
  const settings = settingsApi(ctx)
  if (settings === undefined) return
  let section: unknown
  try {
    section = settings.section(NS)
  } catch {
    return
  }
  if (section === null || typeof section !== 'object') return
  if ((section as Record<string, unknown>)[AUTO_REASONING_FLAG] === false) return
  const providers = (section as { providers?: Record<string, RouteProfile | undefined> }).providers
  if (providers === undefined || typeof providers !== 'object') return
  const ops: { op: 'set'; path: string[]; value: unknown }[] = []
  for (const [route, profile] of Object.entries(providers)) {
    if (profile === null || typeof profile !== 'object') continue
    const declared = profile.models
    if (!Array.isArray(declared)) continue
    let changed = false
    const next = declared.map((raw) => {
      if (raw === null || typeof raw !== 'object') return raw
      const entry = raw as ModelEntry
      if (entry.reasoningEfforts === undefined) {
        changed = true
        return { ...entry, reasoningEfforts: { ...FILL_REASONING_EFFORTS } }
      }
      if (matchesEfforts(entry.reasoningEfforts, LEGACY_REASONING_EFFORTS)) {
        changed = true
        return { ...entry, reasoningEfforts: { ...FILL_REASONING_EFFORTS } }
      }
      return raw
    })
    if (!changed) continue
    ops.push({ op: 'set', path: ['providers', route, 'models'], value: next })
  }
  if (ops.length === 0) return
  try {
    await settings.mutate(NS, ops)
  } catch {
    // Best-effort: the next settings/updated re-runs the scan.
  }
}

export const name = 'dsh-provider-pro'

/**
 * No hard service dependency: the patch should still mount when the settings
 * service is absent, and start resolving once `llm-pi-ai` is registered.
 */
export const inject: string[] = []

/** Emit-name loosened `on`, since cordis types events strictly. */
type EventsLike = {
  on(event: string, handler: (payload?: unknown) => void): unknown
}

export function apply(ctx: Context) {
  installFetchPatch()
  ctx.effect(
    () => {
      let cancelled = false
      let filling = false
      let probing = false
      /** Last request id consumed, so a repeated settings/updated for the same
       * request does not re-run the probe (client re-uses one request slot). */
      let lastProbeId = ''
      const events = ctx as unknown as EventsLike
      const sync = () => {
        state.resolver = buildResolver(() => readSection(ctx))
      }
      const fill = async () => {
        if (filling || cancelled) return
        filling = true
        try {
          await fillEfforts(ctx)
        } finally {
          filling = false
        }
      }
      /** Consume the probe request slot (if any) and write the result back. */
      const probe = async () => {
        if (probing || cancelled) return
        const section = readSection(ctx) as Record<string, unknown> | undefined
        const req = section?.[PROBE_REQ_FLAG]
        if (req === undefined || req === null || typeof req !== 'object') return
        const { id, provider, model } = req as { id?: unknown; provider?: unknown; model?: unknown; mode?: unknown }
        if (typeof id !== 'string' || typeof provider !== 'string' || typeof model !== 'string') return
        if (id === lastProbeId) return
        lastProbeId = id
        probing = true
        const providers = (section?.providers ?? {}) as Record<string, Record<string, unknown> | undefined>
        const profile = providers[provider]
        const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined
        try {
          // One button, one full probe: discovery backfill + role admission
          // + effort levels + image stream, all write-backs inside runFullProbe.
          const result = await runFullProbe(ctx, provider, profile, baseURL, model)
          const settings = settingsApi(ctx)
          if (settings === undefined) return
          await settings.mutate(NS, [
            { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...result, id, provider, model } },
            { op: 'unset', path: [PROBE_REQ_FLAG] },
          ])
        } catch {
          // Result slot left unset; the client times out and reports.
        } finally {
          probing = false
        }
      }
      const handler = (payload?: unknown) => {
        // `settings/updated` also fires for other namespaces; only ours matters.
        if (typeof payload === 'string' && payload !== NS) return
        sync()
        void fill()
        void probe()
      }
      const disposer = events.on('settings/updated', handler) as unknown as () => void
      // The namespace may not be registered yet at activation; poll briefly
      // (like dsh-models-dev-reasoning does) and then rely on the event.
      const run = async () => {
        for (let i = 0; i < 50 && !cancelled; i++) {
          if (readSection(ctx) !== undefined) {
            sync()
            void fill()
            void probe()
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      void run()
      return () => {
        cancelled = true
        disposer()
        state.resolver = undefined
      }
    },
    'dsh-provider-pro: user-agent resolver + effort auto-fill',
  )
}