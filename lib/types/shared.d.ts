/**
 * Shared constants for both halves of dsh-provider-pro. Imported by the Host
 * (tsc → lib/) and the Client (tsdown → bundled into lib/client.js).
 */
/** Every pi-ai thinking level a profile may declare, in escalation order. */
export declare const THINKING_LEVELS: readonly ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/**
 * The full reasoning-effort dictionary this plugin writes for every
 * hand-declared custom model that declares none. `off -> null` is pi-ai's
 * "supported, send nothing" dispatch; every other level carries its own name
 * as the wire value.
 */
export declare const FULL_REASONING_EFFORTS: Record<ThinkingLevel, string | null>;
