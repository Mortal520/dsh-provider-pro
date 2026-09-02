/**
 * dsh-provider-pro — Client half.
 *
 * Registers a Settings → 模型增强 section (`settings.section`, id
 * `provider-pro`, order 15 — right under the official 模型 page, which is 10).
 * The section edits the `llm-pi-ai` user layer directly and holds three
 * capabilities: the reasoning-level master switch, per-provider User-Agent
 * override, and per-model image-input declaration — plus optional probe
 * buttons when dsh-provider-probe is installed.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SectionEvents, SectionProps } from './section'
import { ProviderProSection } from './section'
import { en, zh } from './locales'
import { NS } from './types'
import type { SettingsWireFace, ProviderProbeRemote, T } from './types'

const NS_LOCALE = 'dsh-provider-pro'

/**
 * Required services (cordis fiber inject). The slot registration defers on
 * `slots.inject()`, so activation order against ui-settings is not a concern.
 * The settings wire face must be declared as a dependency (`remote.settings`),
 * exactly as the official Models page does — cordis materializes `ctx.remote.settings`
 * only when the fiber injects it; reading it undeclared yields undefined.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Cordis service surfaces this bundle consumes. Local structural types keep
 * the bundle free of value/type imports from non-platform @deepseek-ai
 * packages (the purity gate) — only @deepseek-ai/cordis is a dev dependency.
 */
interface ClientServices {
  effect(fn: () => void | (() => void)): void
  slots: {
    inject(slot: string, register: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  locale: {
    register(namespace: string, dictionary: unknown): unknown
    bind(namespace: string): (key: string) => string
  }
  remote: {
    $on(event: string, handler: (ns?: unknown) => void): () => void
    settings?: SettingsWireFace
  }
}

export const name = 'dsh-provider-pro'

export function apply(ctx: Context) {
  const c = ctx as unknown as ClientServices

  c.effect(() => {
    c.locale.register(NS_LOCALE, { zh, en })
  })

  const t: T = (c.locale.bind(NS_LOCALE) as (key: string) => string) as T

  // Bridge: re-emit `settings/document-updated` for llm-pi-ai to section
  // listeners, so a save elsewhere (e.g. the Models page) refreshes the
  // section too.
  const listeners = new Set<() => void>()
  const events: SectionEvents = {
    on(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
  c.effect(() => {
    const refresh = (ns?: unknown) => {
      if (ns !== NS) return
      for (const listener of [...listeners]) listener()
    }
    const disposers = [
      c.remote.$on('settings/document-updated', refresh),
      c.remote.$on('llm/adapters-updated', refresh),
    ]
    return () => {
      for (const disposer of disposers) disposer()
      listeners.clear()
    }
  })

  /**
   * Probe detection: resolve dsh-provider-probe's typert remote namespace
   * (`providerProbe`) through the cordis service container. The gateway
   * registers typert remote services under the key `remote:<namespace>`,
   * so we try `ctx.get('remote:providerProbe')`. If unavailable (probe
   * not installed), probe features are hidden (soft dependency).
   */
  let probeApi: ProviderProbeRemote | undefined
  try {
    // Method 1: cordis service resolution (most reliable)
    const svc = (ctx as unknown as { get(key: string): unknown }).get('remote:providerProbe')
    if (svc !== undefined && svc !== null) {
      const ns = svc as Record<string, unknown>
      if (typeof ns.catalog === 'function' && typeof ns.probe === 'function') {
        probeApi = ns as unknown as ProviderProbeRemote
      }
    }
  } catch {
    // Method 2: try the remote proxy directly (fallback)
    try {
      const remote = c.remote as unknown as Record<string, unknown>
      const probeNs = remote?.providerProbe as Record<string, unknown> | undefined
      if (typeof probeNs?.catalog === 'function' && typeof probeNs?.probe === 'function') {
        probeApi = probeNs as unknown as ProviderProbeRemote
      }
    } catch {
      // probe not available — silently degrade
    }
  }

  const injected = (): SectionProps => ({
    api: c.remote.settings,
    t,
    events,
    probeApi,
  })

  c.slots.inject('settings.section', () =>
    c.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-provider-pro',
        order: 15,
        label: () => t('nav'),
        locale: NS_LOCALE,
        inject: injected,
      },
      ProviderProSection,
    ),
  )
}