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
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * The reasoning-effort dictionary this plugin auto-fills since 0.3.0:
 * off / low / medium / high / max (`minimal` and `xhigh` dropped by request).
 * `off -> null` is pi-ai's "supported, send nothing" dispatch; every other
 * level carries its own name as the wire value.
 */
export const FILL_LEVELS = ['off', 'low', 'medium', 'high', 'max'] as const

export type FillLevel = (typeof FILL_LEVELS)[number]

export const FILL_REASONING_EFFORTS: Record<FillLevel, string | null> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
}

/**
 * The auto-fill shape written by 0.1.0–0.2.0 (all seven levels). Recognized
 * byte-for-byte so those earlier writes migrate down to the five-level set
 * (host) and strip cleanly when the master switch turns off (client).
 */
export const LEGACY_REASONING_EFFORTS: Record<ThinkingLevel, string | null> = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/**
 * True when `value` is byte-for-byte `dict`: every level mapped exactly as
 * declared and no extra keys. A dictionary that differs in any way (custom
 * subset, different wire value, extra level) is a hand-written one and is
 * never treated as ours.
 */
export function matchesEfforts(value: unknown, dict: Record<string, string | null>): boolean {
  if (value === null || typeof value !== 'object') return false
  const entries = value as Record<string, unknown>
  for (const [level, wire] of Object.entries(dict)) {
    if (entries[level] !== wire) return false
  }
  return Object.keys(entries).length === Object.keys(dict).length
}

/* ------------------------------------------------------------------ input */

/** The value written to a model's `input` field when the user enables image support. */
export const INPUT_WITH_IMAGE = ['text', 'image'] as const

/* --------------------------------------------------------------- probe IPC */

/** Client → host probe request slot (llm-pi-ai user layer). */
export const PROBE_REQ_FLAG = 'dshProviderProProbe'

/** Host → client probe result slot (llm-pi-ai user layer). */
export const PROBE_RESULT_FLAG = 'dshProviderProProbeResult'
