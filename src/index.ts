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
 * model entry in the user layer that has no `reasoningEfforts` gets the full
 * seven-level dictionary written for it. pi-ai reports a model with that
 * dictionary as a reasoning model with the complete level set, and the
 * composer's model dropdown then offers the same effort switching the official
 * channels get — defaulting to the "Default" tier (no `defaultEffort` is set,
 * so the picker pre-selects its own Default option). Explicit `false` and
 * declared dictionaries are never overwritten.
 */
import type { Context } from '@deepseek-ai/cordis'
import { FULL_REASONING_EFFORTS } from './shared.ts'

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

/**
 * One auto-fill pass: give every hand-declared model without a
 * `reasoningEfforts` the full dictionary. Applies through `settings.mutate`
 * (path ops, no expected revision — background best-effort) and only writes
 * when something is actually missing, so the next `settings/updated` it
 * triggers is a no-op scan. The master switch (top-level
 * `dshProviderProAutoReasoning`, absent = on) disables the pass entirely.
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
      if (entry.reasoningEfforts !== undefined) return raw
      changed = true
      return { ...entry, reasoningEfforts: { ...FULL_REASONING_EFFORTS } }
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
      const handler = (payload?: unknown) => {
        // `settings/updated` also fires for other namespaces; only ours matters.
        if (typeof payload === 'string' && payload !== NS) return
        sync()
        void fill()
      }
      const disposer = events.on('settings/updated', handler) as unknown as () => void
      // The namespace may not be registered yet at activation; poll briefly
      // (like dsh-models-dev-reasoning does) and then rely on the event.
      const run = async () => {
        for (let i = 0; i < 50 && !cancelled; i++) {
          if (readSection(ctx) !== undefined) {
            sync()
            void fill()
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