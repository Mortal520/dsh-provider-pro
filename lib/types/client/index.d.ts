/**
 * dsh-provider-pro — Client half.
 *
 * Registers a Settings → 模型增强 section (`settings.section`, id
 * `provider-pro`, order 15 — right under the official 模型 page, which is 10).
 * The section edits the `llm-pi-ai` user layer directly and holds three
 * capabilities: the reasoning-level master switch, per-provider User-Agent
 * override, per-model image-input declaration, and built-in probe via
 * the DSH LLM catalog (`remote.llm`).
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Required services (cordis fiber inject). `remote.settings` for reading
 * and writing llm-pi-ai settings; `remote.llm` for built-in probe
 * (querying model capabilities through DSH's LLM catalog).
 *
 * `remote.llm` is a typert remote catalog proxy exposing listProviders()
 * and listModels(provider). The client-side proxy does NOT expose stream()
 * or chat() — those run host-side only.
 */
export declare const inject: string[];
export declare const name = "dsh-provider-pro";
export declare function apply(ctx: Context): void;
