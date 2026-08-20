import type { T } from './types';
import type { ApiLike } from './types';
/** Cross-render event hook the section subscribes to (wired in client/index.ts). */
export interface SectionEvents {
    on(fn: () => void): () => void;
}
export interface SectionProps {
    api: ApiLike;
    t: T;
    events: SectionEvents;
}
export declare function ProviderProSection(props: SectionProps): import("react").JSX.Element;
