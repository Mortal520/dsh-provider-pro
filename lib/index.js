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
/* ----------------------------------------------------------- wire-level probes */
/** Discovery cache — one GET /v1/models per baseURL per 60s window. */
const discoveryCache = new Map();
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
 * Full per-model probe — one button, three measurements:
 *
 * 1. context window/maxTokens — `discoverModels` (GET /v1/models), the
 *    gateway's declared listing; missing values are backfilled.
 * 2. message-role admission — pi-ai's OpenAI-completions compat defaults
 *    `supportsDeveloperRole` to true, so a reasoning-capable model makes
 *    pi-ai send its system prompt as `developer`, which some upstreams
 *    (GLM relay, error 1214 角色信息不正确) refuse. One developer POST +
 *    one system baseline settles it; a refusal with a passing `system`
 *    writes `compat.supportsDeveloperRole: false`.
 * 3. image admission — a real stream carrying a 1×1 PNG through the LLM
 *    runtime measures first-token latency and whether the wire accepted
 *    the image (run last, after any role fix, so it exercises the exact
 *    configuration the chat will use).
 *
 * Everything lands in ONE models-array mutate (backfill + compat) before
 * the stream, so results can never clobber each other.
 */
async function runFullProbe(ctx, provider, profile, baseURL, model) {
    const startedAt = Date.now();
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.stream !== 'function') {
        return { ok: false, mode: 'full', error: 'LLM runtime not available' };
    }
    // 1. Discovery — declared capacity listing. Raced with a 10s cap so a
    // hanging listing request cannot extend the probe without bound, and
    // cached per baseURL for 60s: a "probe all" pass over N models would
    // otherwise re-fetch the same listing N times in quick succession.
    let discovered = [];
    let discoveryError;
    if (typeof llm.discoverModels === 'function' && baseURL !== undefined) {
        const cacheKey = baseURL;
        const cached = discoveryCache.get(cacheKey);
        if (cached !== undefined && Date.now() - cached.at < 60000) {
            discovered = cached.list;
        }
        else {
            try {
                discovered = await Promise.race([
                    llm.discoverModels('llm-pi-ai', { provider, baseURL }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('discovery timed out (10s)')), 10000)),
                ]);
                discoveryCache.set(cacheKey, { at: Date.now(), list: discovered });
            }
            catch (error) {
                discoveryError = error instanceof Error ? error.message : String(error);
            }
        }
    }
    const thisModel = discovered.find((entry) => entry.id === model);
    const api = typeof profile?.api === 'string' ? profile.api : 'openai-completions';
    const models = Array.isArray(profile?.models) ? profile?.models : undefined;
    const entry = models?.find((m) => m.id === model);
    // 2. Wire check (role admission) — openai-completions only.
    let roleFix = 'skipped';
    let baselineError;
    const canWire = baseURL !== undefined && api === 'openai-completions' && entry !== undefined;
    // A genuinely refused request is a 4xx other than 429. Timeouts (0),
    // rate limits, and upstream 5xx are AMBIGUOUS — never evidence of
    // rejection; they get one retry.
    const ambiguous = (probe) => probe.status === 0 || probe.status === 429 || probe.status >= 500;
    if (canWire) {
        const apiKey = await resolveProviderKey(ctx, profile?.apiKeyEnv);
        // Wire shapes mirror what pi-ai actually sends: a system-position
        // message followed by a user message. Single-message probes (a lone
        // system/user/developer) are refused by some relays with a misleading
        // "messages 参数非法" — measured on a GLM relay: user+system passes
        // where single-message shapes fail or misreport.
        const send = (role) => wirePost(baseURL, apiKey, {
            model,
            messages: [
                { role, content: 'Reply OK' },
                { role: 'user', content: 'Reply OK' },
            ],
            // 4, not 1: GLM-style relays reject max_tokens <= 2 outright
            // ("max_tokens must be greater than 2").
            max_tokens: 4,
        });
        // Baseline: a plain user message must pass or the rest is meaningless.
        // One retry for an ambiguous failure (transient relay stall) — but a
        // credential-pool cooldown has a reset measured in hours; retrying
        // seconds later is pointless. A TIMEOUT abort is also not retried:
        // an upstream that hung for 10s will not answer in the next 10, and
        // the retry would double the cost of every hung model.
        let baseline = await send('user');
        const timedOut = baseline.status === 0 && /aborted|timed?\s*out/i.test(baseline.body);
        if (!baseline.ok && ambiguous(baseline) && !timedOut && !baseline.body.includes('model_cooldown')) {
            baseline = await send('user');
        }
        if (!baseline.ok) {
            baselineError = baseline.status === 0
                ? (baseline.body !== ''
                    ? `unreachable: ${baseline.body}`
                    : 'gateway did not respond within 10s (retried once) — relay hung or gateway down')
                : `baseline ${baseline.status}: ${baseline.body}`;
        }
        else {
            // Role admission. A 4xx refusal counts against developer directly;
            // a 5xx is ALSO treated as a candidate refusal when `system` passes —
            // measured on the live gateway: it wraps upstream 4xx refusals
            // (GLM 1214 角色信息不正确) in 500s. The system cross-check keeps
            // genuine upstream outages from writing a bogus compat fix (system
            // would fail too, → 'failed', nothing written).
            const compat = (entry.compat ?? {});
            if (compat.supportsDeveloperRole === false) {
                roleFix = 'already';
            }
            else {
                const dev = await send('developer');
                if (dev.ok) {
                    roleFix = 'admitted';
                }
                else if (dev.status >= 400 && dev.status !== 429) {
                    const sys = await send('system');
                    roleFix = sys.ok ? 'fixed' : 'failed';
                }
                // else: ambiguous developer result (timeout/0) — leave the compat untouched.
            }
        }
    }
    // Combined write: capacity backfill + compat fix in one models-array
    // mutate, only when something actually changed.
    let applied = false;
    let backfilled = 0;
    const compatChanged = roleFix === 'fixed';
    if ((discovered.length > 0 || compatChanged) && models !== undefined) {
        const settings = settingsApi(ctx);
        // Lost-update mitigation: the host settings face has no expected-
        // revision parameter, so instead of writing the stale probe snapshot
        // the merge runs against a FRESH read taken immediately before the
        // mutate — concurrent edits between probe start and here survive.
        // The residual read→write window is microseconds-wide; the no-change
        // check keeps listing-only passes from touching the document at all.
        const readFresh = () => {
            const section = readSection(ctx);
            const list = section?.providers?.[provider]?.models;
            return Array.isArray(list) ? list : undefined;
        };
        const buildNext = (fresh) => {
            let wrote = false;
            const next = fresh.map((m) => {
                const disc = discovered.find((d) => d.id === m.id);
                if (m.id !== model && disc === undefined)
                    return m;
                const copy = { ...m };
                if (disc !== undefined) {
                    if (copy.contextWindow === undefined && disc.contextWindow !== undefined) {
                        copy.contextWindow = disc.contextWindow;
                        wrote = true;
                        backfilled++;
                    }
                    if (copy.maxTokens === undefined && disc.maxTokens !== undefined) {
                        copy.maxTokens = disc.maxTokens;
                        wrote = true;
                        backfilled++;
                    }
                }
                if (m.id === model && compatChanged) {
                    const compat = (copy.compat ?? {});
                    if (compat.supportsDeveloperRole !== false) {
                        copy.compat = { ...compat, supportsDeveloperRole: false };
                        wrote = true;
                    }
                }
                return copy;
            });
            return wrote ? next : undefined;
        };
        if (settings !== undefined) {
            const fresh = readFresh();
            const next = fresh !== undefined ? buildNext(fresh) : undefined;
            if (next !== undefined) {
                try {
                    await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }]);
                    applied = true;
                }
                catch {
                    applied = false;
                }
            }
        }
    }
    // Whether the write actually changed content — a listing-only discovery
    // still mutates (last-writer-wins consistency), but that must not
    // display as "written".
    const changed = compatChanged || backfilled > 0;
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
    let streamTimedOut = false;
    // Efficiency gate: when the wire baseline already established the model
    // is unreachable or hard-refused, a 30s stream can only add a second,
    // slower error on top of the first. Skip the stream entirely — the
    // failure line stays the precise baseline verdict.
    const wireDead = baselineError !== undefined;
    if (!wireDead) {
        try {
            const stream = llm.stream({
                provider,
                model,
                messages: [{ role: 'user', content }],
                maxTokens: 8,
            });
            // 30s overall budget, but a 12s first-token gate: a healthy relay
            // produces SOMETHING (reasoning delta included) in 2-3s; a model that
            // has sent nothing for 12s is hung upstream — burn the remaining
            // budget only when tokens are actually flowing.
            const deadline = Date.now() + 30000;
            const firstTokenGate = Date.now() + 12000;
            const iterator = stream[Symbol.asyncIterator]();
            while (true) {
                const now = Date.now();
                const gateLeft = firstTokenMs === null ? firstTokenGate - now : Infinity;
                const budgetLeft = deadline - now;
                const remaining = Math.min(gateLeft, budgetLeft);
                if (remaining <= 0) {
                    if (firstTokenMs === null)
                        streamTimedOut = true;
                    finishReason = finishReason || (firstTokenMs === null
                        ? 'no first token within 12s — upstream hung'
                        : 'probe budget (30s) exceeded');
                    break;
                }
                const next = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => resolve(undefined), remaining);
                    iterator.next().then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
                });
                if (next === undefined) {
                    if (firstTokenMs === null)
                        streamTimedOut = true;
                    finishReason = finishReason || (firstTokenMs === null
                        ? 'no first token within 12s — upstream hung'
                        : 'probe budget (30s) exceeded');
                    break;
                }
                if (next.done === true)
                    break;
                const chunk = next.value;
                if (chunk.type === 'finish') {
                    const reason = reasonText(chunk.reason);
                    finishReason = reason;
                    // A clean finish is itself acceptance evidence: reasoning models can
                    // burn their whole token cap on thinking and emit ZERO text deltas,
                    // yet the wire accepted the request (and the image) — finish(length)
                    // proves the upstream consumed it. An error/aborted finish is not.
                    if (firstTokenMs === null && !/^(error|aborted)/.test(reason)) {
                        firstTokenMs = Date.now() - startedAt;
                    }
                    break;
                }
                // Any streamed chunk (text delta, reasoning delta, tool call, role
                // preamble) proves the wire accepted the request — not just text.
                if (firstTokenMs === null && chunk.type !== 'error') {
                    firstTokenMs = Date.now() - startedAt;
                }
            }
            void iterator.return?.();
            if (imageProbe && firstTokenMs !== null)
                imageVerdict = 'accepted';
        }
        catch (error) {
            streamError = error instanceof Error ? error.message : String(error);
            if (imageProbe && /image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(streamError)) {
                imageVerdict = 'rejected';
            }
        }
    } // end if (!wireDead)
    // 5. Declaration sync — the image-input checkbox is a declaration DSH
    // acts on, so a measured acceptance checks it and a measured rejection
    // clears it. Only the `image` modality is added or removed; every other
    // declared modality (e.g. audio) survives untouched. Fresh read
    // immediately before the mutate (lost-update mitigation, same as the
    // combined write above); written only when the declaration disagrees
    // with the measurement; never touched when no verdict was reached.
    let imageSynced = false;
    if (imageVerdict !== undefined) {
        const settings = settingsApi(ctx);
        if (settings !== undefined) {
            const section = readSection(ctx);
            const models = section?.providers?.[provider]?.models;
            if (Array.isArray(models)) {
                const current = models.find((m) => m.id === model);
                const declared = current !== undefined && Array.isArray(current.input) && current.input.includes('image');
                const measured = imageVerdict === 'accepted';
                if (declared !== measured) {
                    const next = models.map((m) => {
                        if (m.id !== model)
                            return m;
                        const copy = { ...m };
                        const existing = Array.isArray(copy.input) ? copy.input.filter((v) => typeof v === 'string') : undefined;
                        if (measured) {
                            // add `image`, keep whatever else was declared
                            copy.input = existing !== undefined && existing.length > 0
                                ? [...new Set([...existing, 'image'])]
                                : [...INPUT_WITH_IMAGE];
                        }
                        else if (existing !== undefined && existing.length > 0) {
                            // remove `image`, keep the rest; delete the field only when empty
                            const rest = existing.filter((v) => v !== 'image');
                            if (rest.length > 0)
                                copy.input = rest;
                            else
                                delete copy.input;
                        }
                        else {
                            delete copy.input;
                        }
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
    }
    const changedTotal = changed || imageSynced;
    // A stream error or a stall with no first token is a probe failure —
    // the model did not answer, which is exactly what the alive dot reports.
    // With the wire already dead, the baseline error IS the verdict (the
    // stream was skipped) — same return shape, same precision.
    if (streamError !== undefined || streamTimedOut || baselineError !== undefined) {
        return {
            ok: false,
            mode: 'full',
            totalMs: Date.now() - startedAt,
            imageProbe,
            imageSupported: imageVerdict === 'rejected' ? false : undefined,
            imageVerdict,
            imageSynced,
            roleFix,
            applied,
            changed: changedTotal,
            backfilled,
            contextWindow: thisModel?.contextWindow,
            maxTokens: thisModel?.maxTokens,
            error: streamError
                ?? (streamTimedOut
                    ? 'image stream stalled: no first token within 12s (upstream hung)'
                    : baselineError),
        };
    }
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
        applied,
        changed: changedTotal,
        backfilled,
        contextWindow: thisModel?.contextWindow,
        maxTokens: thisModel?.maxTokens,
        ...(baselineError !== undefined ? { error: baselineError } : {}),
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
        /** Serializes probe runs: every accepted request eventually executes,
         * in arrival order. No boolean guard — a boolean swallowed requests
         * whenever a previous probe outlived the client's patience. */
        let probeChain = Promise.resolve();
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
        /** Consume the probe request slot (if any) and write the result back.
         * Runs are chained so concurrent requests execute in order instead of
         * being silently dropped, and every run is bounded by a hard budget
         * slightly below the client's 110s wait cap — a hung stage can delay
         * the answer but can no longer turn it into a client TIMEOUT. */
        const probe = () => {
            if (cancelled)
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
            probeChain = probeChain.then(async () => {
                if (cancelled)
                    return;
                const providers = (readSection(ctx)?.providers ?? {});
                const profile = providers[provider];
                const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined;
                const writeResult = async (value) => {
                    const settings = settingsApi(ctx);
                    if (settings === undefined)
                        return;
                    await settings.mutate(NS, [
                        { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...value, id, provider, model } },
                        { op: 'unset', path: [PROBE_REQ_FLAG] },
                    ]);
                };
                try {
                    const result = await Promise.race([
                        runFullProbe(ctx, provider, profile, baseURL, model),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('probe budget (100s) exceeded — a probe stage hung beyond every per-stage cap')), 100000)),
                    ]);
                    await writeResult(result);
                }
                catch (error) {
                    // Never leave the client waiting blind: a failure (including the
                    // budget guard itself) is published as the probe result.
                    try {
                        await writeResult({
                            ok: false, mode: 'full',
                            totalMs: 0,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                    catch {
                        // settings unavailable — client will TIMEOUT and clean the slot
                    }
                }
            }).catch(() => undefined);
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
