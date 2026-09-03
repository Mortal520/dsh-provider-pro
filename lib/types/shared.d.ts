/**
 * Shared constants for both halves of dsh-provider-pro. Imported by the Host
 * (tsc → lib/) and the Client (tsdown → bundled into lib/client.js).
 */
/** Every pi-ai thinking level a profile may declare, in escalation order. */
export declare const THINKING_LEVELS: readonly ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/**
 * The reasoning-effort dictionary this plugin auto-fills since 0.3.0:
 * off / low / medium / high / max (`minimal` and `xhigh` dropped by request).
 * `off -> null` is pi-ai's "supported, send nothing" dispatch; every other
 * level carries its own name as the wire value.
 */
export declare const FILL_LEVELS: readonly ['off', 'low', 'medium', 'high', 'max'];
export type FillLevel = (typeof FILL_LEVELS)[number];
export declare const FILL_REASONING_EFFORTS: Record<FillLevel, string | null>;
/**
 * The auto-fill shape written by 0.1.0–0.2.0 (all seven levels). Recognized
 * byte-for-byte so those earlier writes migrate down to the five-level set
 * (host) and strip cleanly when the master switch turns off (client).
 */
export declare const LEGACY_REASONING_EFFORTS: Record<ThinkingLevel, string | null>;
/**
 * True when `value` is byte-for-byte `dict`: every level mapped exactly as
 * declared and no extra keys. A dictionary that differs in any way (custom
 * subset, different wire value, extra level) is a hand-written one and is
 * never treated as ours.
 */
export declare function matchesEfforts(value: unknown, dict: Record<string, string | null>): boolean;
/** The value written to a model's `input` field when the user enables image support. */
export declare const INPUT_WITH_IMAGE: readonly ['text', 'image'];
/** Client → host probe request slot (llm-pi-ai user layer). */
export declare const PROBE_REQ_FLAG = "dshProviderProProbe";
/** Host → client probe result slot (llm-pi-ai user layer). */
export declare const PROBE_RESULT_FLAG = "dshProviderProProbeResult";
