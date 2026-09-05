import { FILL_REASONING_EFFORTS, INPUT_WITH_IMAGE, LEGACY_REASONING_EFFORTS, matchesEfforts, PROBE_REQ_FLAG, PROBE_RESULT_FLAG, } from './shared.js';
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
/** Read-only credential resolution, mirroring how pi-ai resolves apiKeyEnv. */
async function resolveProviderKey(ctx, apiKeyEnv) {
    if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0)
        return undefined;
    const credentials = ctx.get('credentials');
    if (credentials === undefined || typeof credentials.resolve !== 'function')
        return undefined;
    try {
        const hit = await credentials.resolve(apiKeyEnv);
        const value = hit?.value;
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** POST one minimal chat-completions request; never throws. */
async function wirePost(baseURL, apiKey, body) {
    const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
            },
            body: JSON.stringify(body),
            // 10s per wire request: a healthy relay answers in 2-3s; anything
            // slower is treated as refused so the whole probe stays inside the
            // client's 60s wait cap even when several requests stall.
            signal: AbortSignal.timeout(10000),
        });
        const text = await response.text().catch(() => '');
        return { status: response.status, ok: response.ok, body: text.slice(0, 400) };
    }
    catch (error) {
        return { status: 0, ok: false, body: error instanceof Error ? error.message : String(error) };
    }
}
/**
 * Full per-model probe — one button, everything measured:
 *
 * 1. context window/maxTokens — `discoverModels` (GET /v1/models), the
 *    gateway's declared listing; missing values are backfilled.
 * 2. message-role admission — pi-ai's OpenAI-completions compat defaults
 *    `supportsDeveloperRole` to true, so a reasoning-capable model makes
 *    pi-ai send its system prompt as `developer`, which some upstreams
 *    (GLM relay, error 1214 角色信息不正确) refuse. One developer POST +
 *    one system baseline settles it; a refusal with a passing `system`
 *    writes `compat.supportsDeveloperRole: false`.
 * 3. reasoning-effort levels — each of low/medium/high/max gets one minimal
 *    request carrying the declared wire spelling; refused levels are
 *    dropped and the validated `reasoningEfforts` dict is written back
 *    (all levels refused → the entry becomes a non-reasoning model,
 *    `reasoningEfforts: false`).
 * 4. image admission — a real stream carrying a 1×1 PNG through the LLM
 *    runtime measures first-token latency and whether the wire accepted
 *    the image (run last, after any role fix, so it exercises the exact
 *    configuration the chat will use).
 *
 * Everything lands in ONE models-array mutate (backfill + compat + efforts)
 * before the stream, so results can never clobber each other.
 */
async function runFullProbe(ctx, provider, profile, baseURL, model) {
    const startedAt = Date.now();
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.stream !== 'function') {
        return { ok: false, mode: 'full', error: 'LLM runtime not available' };
    }
    // 1. Discovery — declared capacity listing.
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
    const api = typeof profile?.api === 'string' ? profile.api : 'openai-completions';
    const models = Array.isArray(profile?.models) ? profile?.models : undefined;
    const entry = models?.find((m) => m.id === model);
    // 2+3. Wire checks (role admission, effort levels) — openai-completions only.
    let roleFix = 'skipped';
    let levels = [];
    let unsupported = [];
    let unknownLevels = [];
    let declaredNonReasoning = false;
    let baselineError;
    const canWire = baseURL !== undefined && api === 'openai-completions' && entry !== undefined;
    // A genuinely refused request is a 4xx other than 429. Timeouts (0),
    // rate limits, and upstream 5xx are AMBIGUOUS — never evidence of
    // rejection; they get one retry, then stay "unknown".
    const refused = (probe) => probe.status >= 400 && probe.status < 500 && probe.status !== 429;
    const ambiguous = (probe) => probe.status === 0 || probe.status === 429 || probe.status >= 500;
    if (canWire) {
        const apiKey = await resolveProviderKey(ctx, profile?.apiKeyEnv);
        // Wire shapes mirror what pi-ai actually sends: a system-position
        // message followed by a user message. Single-message probes (a lone
        // system/user/developer) are refused by some relays with a misleading
        // "messages 参数非法" — measured on a GLM relay: user+system passes
        // where single-message shapes fail or misreport.
        const send = (role, extra = {}) => wirePost(baseURL, apiKey, {
            model,
            messages: [
                { role, content: 'Reply OK' },
                { role: 'user', content: 'Reply OK' },
            ],
            // 4, not 1: GLM-style relays reject max_tokens <= 2 outright
            // ("max_tokens must be greater than 2").
            max_tokens: 4,
            ...extra,
        });
        // Baseline: a plain user message must pass or the rest is meaningless.
        // One retry for an ambiguous failure (transient relay stall) — but a
        // credential-pool cooldown has a reset measured in hours; retrying
        // seconds later is pointless.
        let baseline = await send('user');
        if (!baseline.ok && ambiguous(baseline) && !baseline.body.includes('model_cooldown')) {
            baseline = await send('user');
        }
        if (!baseline.ok) {
            baselineError = baseline.status === 0 ? `unreachable: ${baseline.body}` : `baseline ${baseline.status}: ${baseline.body}`;
        }
        else {
            // Role admission — only a real 4xx refusal counts against developer.
            const compat = (entry.compat ?? {});
            if (compat.supportsDeveloperRole === false) {
                roleFix = 'already';
            }
            else {
                const dev = await send('developer');
                if (dev.ok) {
                    roleFix = 'admitted';
                }
                else if (refused(dev)) {
                    const sys = await send('system');
                    roleFix = sys.ok ? 'fixed' : 'failed';
                }
                // else: ambiguous developer result — leave the compat untouched.
            }
            // The role pi-ai will actually send: developer only when admitted.
            const probeRole = roleFix === 'admitted' ? 'developer' : 'system';
            // Effort levels — a declared non-reasoning model stays as-is.
            if (entry.reasoningEfforts === false) {
                declaredNonReasoning = true;
            }
            else {
                const declared = (entry.reasoningEfforts !== undefined && typeof entry.reasoningEfforts === 'object' && entry.reasoningEfforts !== null)
                    ? entry.reasoningEfforts
                    : undefined;
                // In parallel: four sequential round-trips on a slow relay pushed
                // the whole probe past the client's wait cap.
                const verdicts = await Promise.all(['low', 'medium', 'high', 'max'].map(async (level) => {
                    const declaredWire = declared?.[level];
                    const wire = typeof declaredWire === 'string' && declaredWire.length > 0 ? declaredWire : level;
                    let probe = await send(probeRole, { reasoning_effort: wire });
                    if (!probe.ok && ambiguous(probe)) {
                        probe = await send(probeRole, { reasoning_effort: wire });
                    }
                    return { level, probe };
                }));
                for (const { level, probe } of verdicts) {
                    if (probe.ok)
                        levels.push(level);
                    else if (refused(probe))
                        unsupported.push(level);
                    else
                        unknownLevels.push(level);
                }
            }
        }
    }
    // Combined write: capacity backfill + compat fix + validated effort dict
    // in one models-array mutate, only when something actually changed AND
    // no level verdict was ambiguous (an unknown must never rewrite config).
    let applied = false;
    let backfilled = 0;
    const effortVerdictClean = unknownLevels.length === 0;
    const nextDict = !effortVerdictClean
        ? undefined
        : levels.length > 0
            ? { off: null, ...Object.fromEntries(levels.map((level) => [level, level])) }
            : (canWire && baselineError === undefined && !declaredNonReasoning ? false : undefined);
    const dictChanged = nextDict !== undefined && JSON.stringify(nextDict) !== JSON.stringify(entry?.reasoningEfforts);
    const compatChanged = roleFix === 'fixed';
    if ((discovered.length > 0 || dictChanged || compatChanged) && models !== undefined) {
        const next = models.map((m) => {
            const disc = discovered.find((d) => d.id === m.id);
            if (m.id !== model && disc === undefined)
                return m;
            const copy = { ...m };
            if (disc !== undefined) {
                if (copy.contextWindow === undefined && disc.contextWindow !== undefined) {
                    copy.contextWindow = disc.contextWindow;
                    backfilled++;
                }
                if (copy.maxTokens === undefined && disc.maxTokens !== undefined) {
                    copy.maxTokens = disc.maxTokens;
                    backfilled++;
                }
            }
            if (m.id === model) {
                if (dictChanged)
                    copy.reasoningEfforts = nextDict;
                if (compatChanged)
                    copy.compat = { ...(m.compat ?? {}), supportsDeveloperRole: false };
            }
            return copy;
        });
        const settings = settingsApi(ctx);
        if (settings !== undefined) {
            try {
                await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }]);
                applied = true;
            }
            catch {
                applied = false;
            }
        }
    }
    // Whether the write actually changed content — a listing-only discovery
    // with a matching dict still mutates (last-writer-wins consistency), but
    // that must not display as "written".
    const changed = dictChanged || compatChanged || backfilled > 0;
    // 4. Image admission + latency — real stream through the LLM runtime,
    // after the role fix, so it exercises the exact post-fix configuration.
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
    let imageVerdict;
    let streamError;
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
        if (imageProbe)
            imageVerdict = 'accepted';
    }
    catch (error) {
        streamError = error instanceof Error ? error.message : String(error);
        if (imageProbe && /image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(streamError)) {
            imageVerdict = 'rejected';
        }
    }
    // 5. Declaration sync — the image-input checkbox is a declaration DSH
    // acts on, so a measured acceptance checks it and a measured rejection
    // clears it. Fresh read + whole-array mutate (same shape as the client
    // toggle), written only when the declaration disagrees with the
    // measurement; never touched when no verdict was reached.
    let imageSynced = false;
    if (imageVerdict !== undefined) {
        const settings = settingsApi(ctx);
        const section = readSection(ctx);
        const models = section?.providers?.[provider]?.models;
        if (settings !== undefined && Array.isArray(models)) {
            const current = models.find((m) => m.id === model);
            const declared = current !== undefined && Array.isArray(current.input) && current.input.includes('image');
            const measured = imageVerdict === 'accepted';
            if (declared !== measured) {
                const next = models.map((m) => {
                    if (m.id !== model)
                        return m;
                    const copy = { ...m };
                    if (measured)
                        copy.input = [...INPUT_WITH_IMAGE];
                    else
                        delete copy.input;
                    return copy;
                });
                try {
                    await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }]);
                    imageSynced = true;
                }
                catch {
                    // best-effort sync — the verdict is still reported
                }
            }
        }
    }
    const changedTotal = changed || imageSynced;
    if (streamError === undefined) {
        return {
            ok: baselineError === undefined && roleFix !== 'failed',
            mode: 'full',
            totalMs: Date.now() - startedAt,
            firstTokenMs,
            finishReason: finishReason || 'stop',
            imageProbe,
            imageVerdict,
            imageSynced,
            roleFix,
            levels,
            unsupported,
            unknown: unknownLevels,
            declaredNonReasoning,
            applied,
            changed: changedTotal,
            backfilled,
            contextWindow: thisModel?.contextWindow,
            maxTokens: thisModel?.maxTokens,
            ...(baselineError !== undefined ? { error: baselineError } : {}),
        };
    }
    return {
        ok: false,
        mode: 'full',
        totalMs: Date.now() - startedAt,
        imageProbe,
        imageSupported: imageVerdict === 'rejected' ? false : undefined,
        imageVerdict,
        imageSynced,
        roleFix,
        levels,
        unsupported,
        unknown: unknownLevels,
        declaredNonReasoning,
        applied,
        changed: changedTotal,
        backfilled,
        contextWindow: thisModel?.contextWindow,
        maxTokens: thisModel?.maxTokens,
        error: streamError,
    };
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
            const { id, provider, model } = req;
            if (typeof id !== 'string' || typeof provider !== 'string' || typeof model !== 'string')
                return;
            if (id === lastProbeId)
                return;
            lastProbeId = id;
            probing = true;
            const providers = (section?.providers ?? {});
            const profile = providers[provider];
            const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined;
            try {
                // One button, one full probe: discovery backfill + role admission
                // + effort levels + image stream, all write-backs inside runFullProbe.
                const result = await runFullProbe(ctx, provider, profile, baseURL, model);
                const settings = settingsApi(ctx);
                if (settings === undefined)
                    return;
                await settings.mutate(NS, [
                    { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...result, id, provider, model } },
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
