import { ProviderProSection } from './section';
import { en, zh } from './locales';
import { NS } from './types';
const NS_LOCALE = 'dsh-provider-pro';
/**
 * Required services (cordis fiber inject). The slot registration defers on
 * `slots.inject()`, so activation order against ui-settings is not a concern.
 * The settings wire face must be declared as a dependency (`remote.settings`),
 * exactly as the official Models page does — cordis materializes `ctx.remote.settings`
 * only when the fiber injects it; reading it undeclared yields undefined.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'];
export const name = 'dsh-provider-pro';
export function apply(ctx) {
    const c = ctx;
    c.effect(() => {
        c.locale.register(NS_LOCALE, { zh, en });
    });
    const t = c.locale.bind(NS_LOCALE);
    // Bridge: re-emit `settings/document-updated` for llm-pi-ai to section
    // listeners, so a save elsewhere (e.g. the Models page) refreshes the
    // section too.
    const listeners = new Set();
    const events = {
        on(fn) {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },
    };
    c.effect(() => {
        const refresh = (ns) => {
            if (ns !== NS)
                return;
            for (const listener of [...listeners])
                listener();
        };
        const disposers = [
            c.remote.$on('settings/document-updated', refresh),
            c.remote.$on('llm/adapters-updated', refresh),
        ];
        return () => {
            for (const disposer of disposers)
                disposer();
            listeners.clear();
        };
    });
    /**
     * Probe detection: try to access dsh-provider-probe's typert remote
     * (`providerProbe`) lazily. If available, the section will show probe
     * buttons; if not, probe features are hidden (soft dependency).
     */
    let probeApi;
    try {
        const remote = c.remote;
        const probeNs = remote?.providerProbe;
        if (typeof probeNs?.catalog === 'function' && typeof probeNs?.probe === 'function') {
            probeApi = probeNs;
        }
    }
    catch {
        // probe not available — silently degrade
    }
    const injected = () => ({
        api: c.remote.settings,
        t,
        events,
        probeApi,
    });
    c.slots.inject('settings.section', () => c.slots.register({
        name: 'settings.section',
        id: 'dsh-provider-pro',
        order: 15,
        label: () => t('nav'),
        locale: NS_LOCALE,
        inject: injected,
    }, ProviderProSection));
}
