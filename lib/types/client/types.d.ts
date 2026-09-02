/**
 * Minimal structural types for the RPC faces the card uses.
 *
 * Deliberately loose: these are wire shapes only, so the client bundle stays
 * free of value imports from non-platform @deepseek-ai packages (they live
 * behind the bundle purity gate). Type-only imports are erased at build time.
 */
import type { LocaleKey } from './locales';
import type { ThinkingLevel } from '../shared.ts';
export type T = (key: LocaleKey) => string;
/** The pi-ai adapter's settings namespace (custom providers), read-only view. */
export declare const NS = "llm-pi-ai";
/** One declared model entry inside a pi-ai provider profile. */
export interface ProviderModel {
    id: string;
    input?: string[];
    [key: string]: unknown;
}
/** A hand-declared provider profile as stored in the user layer. */
export interface ProviderProfile {
    displayName?: string;
    api?: string;
    baseURL?: string;
    apiKeyEnv?: string;
    headers?: Record<string, string>;
    models?: ProviderModel[];
    /** Provider-wide default reasoning level (pi-ai `reasoning`). */
    reasoning?: ThinkingLevel;
    /** Custom field this plugin reads for the User-Agent override. */
    userAgent?: string;
    [key: string]: unknown;
}
/** The `llm-pi-ai` section the card edits (user layer). */
export interface PiAiSection {
    providers?: Record<string, ProviderProfile>;
    [key: string]: unknown;
}
interface RpcResult<T> {
    ok: boolean;
    value: T;
    error?: {
        code?: string;
        message: string;
    };
}
export interface SettingsPathOp {
    op: 'set' | 'unset';
    path: string[];
    value?: unknown;
}
export interface SettingsNamespaceView {
    ns: string;
    schema: unknown;
    value: unknown;
    base?: unknown;
    user?: unknown;
    applies: 'live' | 'restart';
    secrets: {
        path: string[];
        set: boolean;
    }[];
    revision: number;
}
export interface SettingsDescribeResult {
    writable: boolean;
    hasDocument: boolean;
    namespaces: SettingsNamespaceView[];
}
/**
 * The settings wire face of DSH 2.0.x (`ctx.remote.settings`): positional
 * parameters and a flat `{ok, value, error}` result — the same face the
 * official settings pages use.
 */
export interface SettingsWireFace {
    describe(): Promise<RpcResult<SettingsDescribeResult>>;
    mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<RpcResult<SettingsNamespaceView>>;
}
/** A t() with a pluggable [untranslated] fallback for unknown keys. */
export type TFallback = (key: LocaleKey) => string;
/** Result of a single model probe (mirrors dsh-provider-probe's ProbeResult). */
export interface ProbeResult {
    status: 'success' | 'failure';
    provider: string;
    model: string;
    firstTokenMs?: number | null;
    totalMs?: number;
    finishReason?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    failure?: {
        code: string;
        message: string;
        category?: string;
        status?: number;
    };
}
/** Minimal shape of the providerProbe remote namespace exposed by dsh-provider-probe. */
export interface ProviderProbeRemote {
    catalog(): Promise<{
        ok: boolean;
        value: {
            providers: Array<{
                id: string;
                models: Array<{
                    id: string;
                    inputModalities?: string[];
                }>;
            }>;
        };
    }>;
    probe(request: {
        provider: string;
        model: string;
    }, signal?: AbortSignal): Promise<{
        ok: boolean;
        value: ProbeResult;
        error?: {
            message: string;
        };
    }>;
}
export {};
