import { ProviderProSection } from './section';
import { en, zh } from './locales';
import { NS } from './types';
const NS_LOCALE = 'dsh-provider-pro';
/**
 * Required services (cordis fiber inject). `remote.settings` for reading
 * and writing llm-pi-ai settings.
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
    const injected = () => ({
        api: c.remote.settings,
        t,
        events,
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
