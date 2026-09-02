/**
 * dsh-provider-pro — Client half.
 *
 * Registers a Settings → 模型增强 section (`settings.section`, id
 * `provider-pro`, order 15 — right under the official 模型 page, which is 10).
 * The section edits the `llm-pi-ai` user layer directly and holds exactly two
 * controls: the reasoning-level master switch and one User-Agent card per
 * provider — using the exact RPC shapes the official Models page uses.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Required services (cordis fiber inject). The slot registration defers on
 * `slots.inject()`, so activation order against ui-settings is not a concern.
 * The settings wire face must be declared as a dependency (`remote.settings`),
 * exactly as the official Models page does — cordis materializes `ctx.remote.settings`
 * only when the fiber injects it; reading it undeclared yields undefined.
 */
export declare const inject: string[];
export declare const name = "dsh-provider-pro";
export declare function apply(ctx: Context): void;
