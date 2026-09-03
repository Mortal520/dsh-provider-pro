import type { T } from './types';
import type { SettingsWireFace } from './types';
/** Cross-render event hook the section subscribes to (wired in client/index.ts). */
export interface SectionEvents {
    on(fn: () => void): () => void;
}
export interface SectionProps {
    /** The `ctx.remote.settings` wire face (DSH 2.0.x); undefined when absent. */
    api: SettingsWireFace | undefined;
    /** Raw remote.llm wire — discovered at runtime; methods TBD. */
    llmWire?: Record<string, unknown>;
    t: T;
    events: SectionEvents;
}
export declare function ProviderProSection(props: SectionProps): import("react").JSX.Element;
