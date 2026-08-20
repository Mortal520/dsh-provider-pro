/**
 * Minimal structural types for the RPC faces the card uses.
 *
 * Deliberately loose: these are wire shapes only, so the client bundle stays
 * free of value imports from non-platform @deepseek-ai packages (they live
 * behind the bundle purity gate). Type-only imports are erased at build time.
 */
import type { LocaleKey } from './locales'
import type { ThinkingLevel } from '../shared.ts'

export type T = (key: LocaleKey) => string

/** The pi-ai adapter's settings namespace (custom providers), read-only view. */
export const NS = 'llm-pi-ai'

/** One declared model entry inside a pi-ai provider profile. */
export interface ProviderModel {
  id: string
  [key: string]: unknown
}

/** A hand-declared provider profile as stored in the user layer. */
export interface ProviderProfile {
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  models?: ProviderModel[]
  /** Provider-wide default reasoning level (pi-ai `reasoning`). */
  reasoning?: ThinkingLevel
  /** Custom field this plugin reads for the User-Agent override. */
  userAgent?: string
  [key: string]: unknown
}

/** The `llm-pi-ai` section the card edits (user layer). */
export interface PiAiSection {
  providers?: Record<string, ProviderProfile>
  [key: string]: unknown
}

interface RpcResult<T> {
  ok: boolean
  value: T
  error?: { message: string }
}
interface RpcEnvelope<T> {
  result: RpcResult<T>
}

export interface SettingsPathOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export interface SettingsMutationRequest {
  ns: string
  ops: SettingsPathOp[]
  expectedRevision?: number
}

export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: { path: string[]; set: boolean }[]
  revision: number
}

export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  [key: string]: unknown
}

/** The slice of IApiClient the card uses. */
export interface ApiLike {
  settings: {
    describe(request: Record<string, never>): Promise<RpcEnvelope<{
      writable: boolean
      hasDocument: boolean
      namespaces: SettingsNamespaceView[]
    }>>
    mutate(request: SettingsMutationRequest): Promise<RpcEnvelope<SettingsNamespaceView>>
  }
  llm: {
    discoverModels(request: {
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }): Promise<RpcEnvelope<{ models: DiscoveredModel[] }>>
  }
}

/** A t() with a pluggable [untranslated] fallback for unknown keys. */
export type TFallback = (key: LocaleKey) => string