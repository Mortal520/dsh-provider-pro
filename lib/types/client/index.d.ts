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
import type { Context } from '@deepseek-ai/cordis';
/** Required services (cordis fiber inject). The slot registration defers on
 * `slots.inject()`, so activation order against ui-settings is not a concern. */
export declare const inject: string[];
export declare const name = "dsh-provider-pro";
export declare function apply(ctx: Context): void;
