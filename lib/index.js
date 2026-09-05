import { FILL_REASONING_EFFORTS, LEGACY_REASONING_EFFORTS, matchesEfforts, PROBE_REQ_FLAG, PROBE_RESULT_FLAG, } from './shared.js';
/** The pi-ai adapter's settings namespace, whose providers we extend. */
const NS = 'llm-pi-ai';
/**
 * Long-lived patch state. The wrapper function itself is installed exactly
 * once for the lifetime of the process; HMR/reload only swaps the resolver,
 * so the patch never double-wraps.
 */
const STATE_KEY = Symbol.for('dsh-provider-pro.fetch-state');
const state = (globalThis[STATE_KEY] ??= {
    original: undefined,
    resolver: undefined,
});
/** Normalize any fetch input to a URL string. */
function urlOf(input) {
    if (typeof input === 'string')
        return input;
    if (input instanceof URL)
        return input.href;
    if (typeof input === 'object' && input !== null && 'url' in input) {
        const url = input.url;
        if (typeof url === 'string')
            return url;
    }
    return '';
}
/** Install the UA-rewriting fetch wrapper once, returning whether patched. */
function installFetchPatch() {
    if (state.original !== undefined)
        return true;
    const original = globalThis.fetch;
    if (typeof original !== 'function')
        return false;
    state.original = original;
    globalThis.fetch = async (input, init) => {
        const resolver = state.resolver;
        if (resolver === undefined)
            return original(input, init);
        const url = urlOf(input);
        const ua = resolver(url);
        if (ua === undefined)
            return original(input, init);
        // Merge the existing header source (init wins over the request's own),
        // then force the configured user-agent. Replacing, not appending, is
        // required: the SDK default UA and the harness attribution header are
        // already present somewhere in the chain at this point.
        const headers = new Headers(init?.headers ?? (typeof input === 'object' && input !== null && 'headers' in input
            ? input.headers
            : undefined));
        headers.set('user-agent', ua);
        if (typeof input === 'string' || input instanceof URL) {
            return original(input, { ...(init ?? {}), headers });
        }
        // Request input: fold everything (headers included) into one request so
        // the caller's init cannot re-apply its own headers over ours.
        return original(new Request(input, { ...(init ?? {}), headers }), undefined);
    };
    return true;
}
/** Longest-prefix match of a URL against configured provider baseURLs. */
function buildResolver(getSection) {
    return (url) => {
        const section = getSection();
        const providers = section?.providers;
        if (providers === undefined || typeof providers !== 'object')
            return undefined;
        let best;
        for (const profile of Object.values(providers)) {
            if (profile === null || typeof profile !== 'object')
                continue;
            const base = profile.baseURL;
            const raw = profile.userAgent;
            if (typeof base !== 'string' || base.length === 0)
                continue;
            if (typeof raw !== 'string')
                continue;
            const ua = raw.trim();
            if (ua.length === 0)
                continue;
            if (!url.startsWith(base))
                continue;
            if (best === undefined || base.length > best.base.length)
                best = { base, ua };
        }
        return best?.ua;
    };
}
/** Read the current `llm-pi-ai` section through the settings service. */
function readSection(ctx) {
    const settings = ctx.get('settings');
    if (settings === undefined)
        return undefined;
    try {
        return settings.get(NS);
    }
    catch {
        return undefined;
    }
}
function settingsApi(ctx) {
    const settings = ctx.get('settings');
    if (settings === undefined)
        return undefined;
    const api = settings;
    if (typeof api.section !== 'function' || typeof api.mutate !== 'function')
        return undefined;
    return api;
}
/** Top-level flag in the `llm-pi-ai` user layer controlling the auto-fill. */
const AUTO_REASONING_FLAG = 'dshProviderProAutoReasoning';
/* ------------------------------------------------------------ probe IPC */
/** A 1×1 transparent PNG used to test image admission on the real wire. */
const PROBE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** Read the human-readable finish reason from a `finish` chunk. */
function reasonText(reason) {
    if (typeof reason === 'string')
        return reason;
    if (reason === null || typeof reason !== 'object')
        return 'stop';
    const entry = reason;
    // DSH FinishReason: { kind: 'stop'|'tool-calls'|'max-tokens'|'aborted'|'error', failure? }
    if (typeof entry.kind === 'string') {
        if (entry.kind === 'error' || entry.kind === 'aborted') {
            const failure = entry.failure;
            if (failure !== null && typeof failure === 'object') {
                const message = failure.message;
                if (typeof message === 'string')
                    return `${entry.kind}: ${message}`;
            }
        }
        return entry.kind;
    }
    if (typeof entry.code === 'string')
        return entry.code;
    return 'stop';
}
/**
 * Run one capability/deep probe through DSH's LLM runtime.
 *
 * - `mode: 'capabilities'` — zero-token, primary: `discoverModels`
 *   (GET /v1/models) for the provider's full listing. What the gateway
 *   declares is what you get — a relaying gateway may return an empty
 *   contextWindow/maxTokens, and that is reported as-is rather than
 *   guessed. Missing values are never fabricated.
 * - `mode: 'deep'` — fallback, token-cost: streams a minimal request carrying
 *   a 1×1 PNG (image admission exercised on the actual wire; text-only when
 *   no attachment store is mounted) and measures first-token latency, total
 *   time, and whether the upstream accepted the image.
 */
async function runProbe(ctx, provider, baseURL, model, mode) {
    const startedAt = Date.now();
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.stream !== 'function') {
        return { ok: false, mode, error: 'LLM runtime not available' };
    }
    // Discover the provider's models (contextWindow/maxTokens) so we can
    // surface and, where missing, backfill capacity. The discovery handler
    // resolves the API key from storage; provider + baseURL required.
    let discovered = [];
    let discoveryError;
    if (typeof llm.discoverModels === 'function' && baseURL !== undefined) {
        try {
            discovered = await llm.discoverModels('llm-pi-ai', { provider, baseURL });
        }
        catch (error) {
            discoveryError = error instanceof Error ? error.message : String(error);
        }
    }
    const thisModel = discovered.find((entry) => entry.id === model);
    // Capabilities-only mode: no wire inference, no token cost. Report what
    // the gateway declared; if discovery failed entirely, the client can fall
    // back to a deep probe.
    if (mode === 'capabilities') {
        if (discoveryError !== undefined) {
            return { ok: false, mode, totalMs: Date.now() - startedAt, error: discoveryError, discovery: { error: discoveryError } };
        }
        return {
            ok: true,
            mode,
            totalMs: Date.now() - startedAt,
            contextWindow: thisModel?.contextWindow,
            maxTokens: thisModel?.maxTokens,
            models: discovered,
        };
    }
    // Deep mode: real stream probe (image admission + latency).
    // Try to mint a durable image attachment; fall back to text-only.
    let attachment;
    let imageProbe = false;
    try {
        const attachments = ctx.get('attachments');
        if (attachments !== undefined && typeof attachments.saveImages === 'function') {
            const bytes = new Uint8Array(Buffer.from(PROBE_IMAGE_BASE64, 'base64'));
            const refs = await attachments.saveImages([{ data: bytes, mediaType: 'image/png' }]);
            attachment = refs[0];
            imageProbe = true;
        }
    }
    catch {
        // attachment store failure — text-only probe
    }
    const content = attachment !== undefined
        ? [
            { type: 'text', text: 'Reply with OK.' },
            { type: 'image', attachment },
        ]
        : [{ type: 'text', text: 'Reply with OK.' }];
    let firstTokenMs = null;
    let finishReason = '';
    try {
        const stream = llm.stream({
            provider,
            model,
            messages: [{ role: 'user', content }],
            maxTokens: 8,
        });
        for await (const chunk of stream) {
            if (firstTokenMs === null && chunk.type === 'text-delta') {
                firstTokenMs = Date.now() - startedAt;
            }
            if (chunk.type === 'finish') {
                finishReason = reasonText(chunk.reason);
            }
        }
        return {
            ok: true,
            mode,
            firstTokenMs,
            totalMs: Date.now() - startedAt,
            finishReason: finishReason || 'stop',
            imageProbe,
            contextWindow: thisModel?.contextWindow,
            maxTokens: thisModel?.maxTokens,
            discovery: discoveryError === undefined ? undefined : { error: discoveryError },
            models: discoveryError === undefined ? discovered : undefined,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        const imageRejected = /image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(lower);
        return {
            ok: false,
            mode,
            totalMs: Date.now() - startedAt,
            imageProbe,
            imageSupported: imageRejected ? false : undefined,
            contextWindow: thisModel?.contextWindow,
            maxTokens: thisModel?.maxTokens,
            discovery: discoveryError === undefined ? undefined : { error: discoveryError },
            models: discoveryError === undefined ? discovered : undefined,
            error: message,
        };
    }
}
/**
 * One auto-fill pass: give every hand-declared model without a
 * `reasoningEfforts` the five-level dictionary (off/low/medium/high/max),
 * and migrate models still carrying the byte-exact seven-level dictionary
 * auto-filled by 0.1.0–0.2.0 down to the current set. Explicit `false` and
 * hand-customized dictionaries are never overwritten. Applies through
 * `settings.mutate` (path ops, no expected revision — background best-effort)
 * and only writes when something actually changes, so the next
 * `settings/updated` it triggers is a no-op scan. The master switch
 * (top-level `dshProviderProAutoReasoning`, absent = on) disables the pass
 * entirely.
 */
async function fillEfforts(ctx) {
    const settings = settingsApi(ctx);
    if (settings === undefined)
        return;
    let section;
    try {
        section = settings.section(NS);
    }
    catch {
        return;
    }
    if (section === null || typeof section !== 'object')
        return;
    if (section[AUTO_REASONING_FLAG] === false)
        return;
    const providers = section.providers;
    if (providers === undefined || typeof providers !== 'object')
        return;
    const ops = [];
    for (const [route, profile] of Object.entries(providers)) {
        if (profile === null || typeof profile !== 'object')
            continue;
        const declared = profile.models;
        if (!Array.isArray(declared))
            continue;
        let changed = false;
        const next = declared.map((raw) => {
            if (raw === null || typeof raw !== 'object')
                return raw;
            const entry = raw;
            if (entry.reasoningEfforts === undefined) {
                changed = true;
                return { ...entry, reasoningEfforts: { ...FILL_REASONING_EFFORTS } };
            }
            if (matchesEfforts(entry.reasoningEfforts, LEGACY_REASONING_EFFORTS)) {
                changed = true;
                return { ...entry, reasoningEfforts: { ...FILL_REASONING_EFFORTS } };
            }
            return raw;
        });
        if (!changed)
            continue;
        ops.push({ op: 'set', path: ['providers', route, 'models'], value: next });
    }
    if (ops.length === 0)
        return;
    try {
        await settings.mutate(NS, ops);
    }
    catch {
        // Best-effort: the next settings/updated re-runs the scan.
    }
}
export const name = 'dsh-provider-pro';
/**
 * No hard service dependency: the patch should still mount when the settings
 * service is absent, and start resolving once `llm-pi-ai` is registered.
 */
export const inject = [];
export function apply(ctx) {
    installFetchPatch();
    ctx.effect(() => {
        let cancelled = false;
        let filling = false;
        let probing = false;
        /** Last request id consumed, so a repeated settings/updated for the same
         * request does not re-run the probe (client re-uses one request slot). */
        let lastProbeId = '';
        const events = ctx;
        const sync = () => {
            state.resolver = buildResolver(() => readSection(ctx));
        };
        const fill = async () => {
            if (filling || cancelled)
                return;
            filling = true;
            try {
                await fillEfforts(ctx);
            }
            finally {
                filling = false;
            }
        };
        /** Consume the probe request slot (if any) and write the result back. */
        const probe = async () => {
            if (probing || cancelled)
                return;
            const section = readSection(ctx);
            const req = section?.[PROBE_REQ_FLAG];
            if (req === undefined || req === null || typeof req !== 'object')
                return;
            const { id, provider, model, mode } = req;
            if (typeof id !== 'string' || typeof provider !== 'string' || typeof model !== 'string')
                return;
            if (id === lastProbeId)
                return;
            lastProbeId = id;
            probing = true;
            const providers = (section?.providers ?? {});
            const profile = providers[provider];
            const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined;
            const probeMode = mode === 'deep' ? 'deep' : 'capabilities';
            try {
                const result = await runProbe(ctx, provider, baseURL, model, probeMode);
                // Capacity backfill: for every declared model that lacks
                // contextWindow/maxTokens, write the discovered value. Only fills
                // missing fields — hand-set values are never overwritten. Applies
                // only when discovery returned a real listing.
                const discovered = Array.isArray(result.models) ? result.models : [];
                const models = profile?.models;
                let backfilled = 0;
                if (discovered.length > 0 && Array.isArray(models)) {
                    let changed = false;
                    const next = models.map((entry) => {
                        const disc = discovered.find((d) => d.id === entry.id);
                        if (disc === undefined)
                            return entry;
                        const copy = { ...entry };
                        if (entry.contextWindow === undefined && disc.contextWindow !== undefined) {
                            copy.contextWindow = disc.contextWindow;
                            changed = true;
                        }
                        if (entry.maxTokens === undefined && disc.maxTokens !== undefined) {
                            copy.maxTokens = disc.maxTokens;
                            changed = true;
                        }
                        return copy;
                    });
                    const backfillApi = settingsApi(ctx);
                    if (changed && backfillApi !== undefined) {
                        await backfillApi.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }]);
                        backfilled = next.reduce((n, e, i) => n + (e.contextWindow !== models[i]?.contextWindow || e.maxTokens !== models[i]?.maxTokens ? 1 : 0), 0);
                    }
                }
                const settings = settingsApi(ctx);
                if (settings === undefined)
                    return;
                await settings.mutate(NS, [
                    { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...result, id, provider, model, backfilled } },
                    { op: 'unset', path: [PROBE_REQ_FLAG] },
                ]);
            }
            catch {
                // Result slot left unset; the client times out and reports.
            }
            finally {
                probing = false;
            }
        };
        const handler = (payload) => {
            // `settings/updated` also fires for other namespaces; only ours matters.
            if (typeof payload === 'string' && payload !== NS)
                return;
            sync();
            void fill();
            void probe();
        };
        const disposer = events.on('settings/updated', handler);
        // The namespace may not be registered yet at activation; poll briefly
        // (like dsh-models-dev-reasoning does) and then rely on the event.
        const run = async () => {
            for (let i = 0; i < 50 && !cancelled; i++) {
                if (readSection(ctx) !== undefined) {
                    sync();
                    void fill();
                    void probe();
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        };
        void run();
        return () => {
            cancelled = true;
            disposer();
            state.resolver = undefined;
        };
    }, 'dsh-provider-pro: user-agent resolver + effort auto-fill');
}
