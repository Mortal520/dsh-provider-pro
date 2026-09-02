import type { T } from './types';
import type { ProviderProbeRemote, SettingsWireFace } from './types';
/** Cross-render event hook the section subscribes to (wired in client/index.ts). */
export interface SectionEvents {
    on(fn: () => void): () => void;
}
export interface SectionProps {
    /** The `ctx.remote.settings` wire face (DSH 2.0.x); undefined when absent. */
    api: SettingsWireFace | undefined;
    t: T;
    events: SectionEvents;
    /** Lazy probe resolver — call on-demand to resolve dsh-provider-probe's remote. */
    resolveProbe?: () => ProviderProbeRemote | undefined;
}
export declare function ProviderProSection(props: SectionProps): import("react").JSX.Element;
