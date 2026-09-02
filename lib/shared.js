/**
 * Shared constants for both halves of dsh-provider-pro. Imported by the Host
 * (tsc → lib/) and the Client (tsdown → bundled into lib/client.js).
 */
/** Every pi-ai thinking level a profile may declare, in escalation order. */
export const THINKING_LEVELS = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
];
/**
 * The reasoning-effort dictionary this plugin auto-fills since 0.3.0:
 * off / low / medium / high / max (`minimal` and `xhigh` dropped by request).
 * `off -> null` is pi-ai's "supported, send nothing" dispatch; every other
 * level carries its own name as the wire value.
 */
export const FILL_LEVELS = ['off', 'low', 'medium', 'high', 'max'];
export const FILL_REASONING_EFFORTS = {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'max',
};
/**
 * The auto-fill shape written by 0.1.0–0.2.0 (all seven levels). Recognized
 * byte-for-byte so those earlier writes migrate down to the five-level set
 * (host) and strip cleanly when the master switch turns off (client).
 */
export const LEGACY_REASONING_EFFORTS = {
    off: null,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
};
/**
 * True when `value` is byte-for-byte `dict`: every level mapped exactly as
 * declared and no extra keys. A dictionary that differs in any way (custom
 * subset, different wire value, extra level) is a hand-written one and is
 * never treated as ours.
 */
export function matchesEfforts(value, dict) {
    if (value === null || typeof value !== 'object')
        return false;
    const entries = value;
    for (const [level, wire] of Object.entries(dict)) {
        if (entries[level] !== wire)
            return false;
    }
    return Object.keys(entries).length === Object.keys(dict).length;
}
