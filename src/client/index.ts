/**
 * dsh-provider-pro — Client half.
 *
 * Registers a Settings → 模型增强 section (`settings.section`, id
 * `provider-pro`, order 15 — right under the official 模型 page, which is 10).
 * The section edits the `llm-pi-ai` user layer directly: per-provider
 * User-Agent, provider-wide default effort, per-model reasoning levels (the
 * same effort set the composer's model dropdown groups by), and endpoint model
 * discovery — with the exact RPC shapes the official Models page uses.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SectionEvents, SectionProps } from './section'
import { ProviderProSection } from './section'
import { en, zh } from './locales'
import { NS } from './types'
import type { ApiLike, T } from './types'

const NS_LOCALE = 'dsh-provider-pro'

/** Required services (cordis fiber inject). The slot registration defers on
 * `slots.inject()`, so activation order against ui-settings is not a concern. */
export const inject = ['slots', 'locale', 'connection', 'remote']

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
  }
  get<T>(key: string): T
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

  const injected = (): SectionProps => ({
    api: c.get<{ api: ApiLike }>('connection').api,
    t,
    events,
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