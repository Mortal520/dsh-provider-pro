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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-provider-pro";
/**
 * No hard service dependency: the patch should still mount when the settings
 * service is absent, and start resolving once `llm-pi-ai` is registered.
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
