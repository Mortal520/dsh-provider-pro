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
  usage?: { completionTokens?: number }
}

/**
 * Run one real probe through DSH's LLM runtime: a minimal request carrying a
 * 1×1 PNG (image admission exercised on the actual wire) plus a text request
 * fallback when no attachment store is mounted. Measures first-token latency,
 * total time, and whether the upstream rejected the image.
 *
 * Alongside the latency probe it runs model discovery for the provider and
 * includes each model's `contextWindow`/`maxTokens` so the client can show
 * them and backfill any model that lacks them in settings.
 */
async function runProbe(
  ctx: Context,
  provider: string,
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
    return { ok: false, error: 'LLM runtime not available' }
  }

  // Discover the provider's models (contextWindow/maxTokens) so we can
  // surface and, where missing, backfill capacity. The discovery handler
  // resolves the API key from storage; only provider + baseURL are required.
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

  // Try to mint a durable image attachment for the probe; fall back to
  // text-only if the attachment store is absent.
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
      if (firstTokenMs === null && (chunk.type === 'text' || chunk.type === 'delta')) {
        firstTokenMs = Date.now() - startedAt
      }
      if (chunk.type === 'finish') {
        finishReason = (chunk as { reason?: string }).reason ?? 'stop'
      }
    }
    return {
      ok: true,
      firstTokenMs,
      totalMs: Date.now() - startedAt,
      finishReason: finishReason || 'stop',
      imageProbe,
      contextWindow: thisModel?.contextWindow,
      maxTokens: thisModel?.maxTokens,
      discovery: discoveryError === undefined ? undefined : { error: discoveryError },
      models: discoveryError === undefined ? discovered : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()
    const imageRejected = /image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(lower)
    return {
      ok: false,
      totalMs: Date.now() - startedAt,
      imageProbe,
      imageSupported: imageRejected ? false : undefined,
      contextWindow: thisModel?.contextWindow,
      maxTokens: thisModel?.maxTokens,
      discovery: discoveryError === undefined ? undefined : { error: discoveryError },
      models: discoveryError === undefined ? discovered : undefined,
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
        const { id, provider, model } = req as { id?: unknown; provider?: unknown; model?: unknown }
        if (typeof id !== 'string' || typeof provider !== 'string' || typeof model !== 'string') return
        if (id === lastProbeId) return
        lastProbeId = id
        probing = true
        const providers = (section?.providers ?? {}) as Record<string, { baseURL?: unknown; models?: Array<{ id?: unknown; contextWindow?: unknown; maxTokens?: unknown }> } | undefined>
        const profile = providers[provider]
        const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined
        try {
          const result = await runProbe(ctx, provider, baseURL, model)
          // Capacity backfill: for every declared model that lacks
          // contextWindow/maxTokens, write the discovered value. Only fills
          // missing fields — hand-set values are never overwritten.
          const discovered = Array.isArray(result.models) ? result.models as Array<{ id: string; contextWindow?: number; maxTokens?: number }> : []
          const models = profile?.models
          let backfilled = 0
          if (discovered.length > 0 && Array.isArray(models)) {
            let changed = false
            const next = models.map((entry) => {
              const disc = discovered.find((d) => d.id === entry.id)
              if (disc === undefined) return entry
              const copy = { ...entry }
              if (entry.contextWindow === undefined && disc.contextWindow !== undefined) { copy.contextWindow = disc.contextWindow; changed = true }
              if (entry.maxTokens === undefined && disc.maxTokens !== undefined) { copy.maxTokens = disc.maxTokens; changed = true }
              return copy
            })
            if (changed) {
              await settingsApi(ctx)!.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }])
              backfilled = next.reduce((n, e, i) => n + (e.contextWindow !== models[i]?.contextWindow || e.maxTokens !== models[i]?.maxTokens ? 1 : 0), 0)
            }
          }
          const settings = settingsApi(ctx)
          if (settings === undefined) return
          await settings.mutate(NS, [
            { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...result, id, provider, model, backfilled } },
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