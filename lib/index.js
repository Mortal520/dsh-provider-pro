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
        let request;
        try {
            request = new URL(url);
        }
        catch {
            return undefined;
        }
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
            let configured;
            try {
                configured = new URL(base);
            }
            catch {
                continue;
            }
            const basePath = configured.pathname.replace(/\/+$/, '') || '/';
            const pathMatches = request.pathname === basePath || request.pathname.startsWith(`${basePath}/`);
            if (request.origin !== configured.origin || !pathMatches)
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
/** Current revision of our namespace, or undefined when unknown. */
function nsRevision(settings) {
    if (typeof settings.describe !== 'function')
        return undefined;
    try {
        return settings.describe().find((entry) => entry.ns === NS)?.revision;
    }
    catch {
        return undefined;
    }
}
/**
 * CAS settings write with conflict retry. The caller's mutator rebuilds the
 * target value from a FRESH section read inside the queue slot; we then
 * write with the revision read at that same moment as a compare-and-set —
 * if anything changed between the read and the write (an external editor,
 * another plugin), the write throws SettingsConflict and we re-read +
 * rebuild + retry. Bounded, so a pathological writer cannot loop forever.
 */
async function mutateSettingsCAS(ctx, mutator, attempts = 3) {
    const settings = settingsApi(ctx);
    if (settings === undefined)
        return false;
    for (let i = 0; i < attempts; i++) {
        const fresh = readSection(ctx);
        if (fresh === null || fresh === undefined || typeof fresh !== 'object')
            return false;
        const built = mutator(fresh);
        if (built === undefined)
            return false; // nothing to change
        const expected = nsRevision(settings);
        try {
            await settings.mutate(NS, built.ops, expected);
            return true;
        }
        catch (error) {
            // SettingsConflict: retry with a fresh read; any other error surfaces.
            if (!(error instanceof Error) || !/changed since it was read|expected revision/i.test(error.message))
                return false;
        }
    }
    return false;
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
/**
 * Serializes every plugin-issued whole-array mutate (auto-fill, probe
 * backfill/compat, image sync) so two plugin writers can never interleave
 * read-modify-write cycles against each other. External writers (the user,
 * other plugins) remain last-writer-wins — the settings face exposes no
 * expected-revision parameter — but plugin-internal clobbering is gone.
 */
let writeChain = Promise.resolve();
function enqueueWrite(run) {
    const next = writeChain.then(run, run);
    writeChain = next.catch(() => undefined);
    return next;
}
/** Discovery cache — one GET /v1/models per baseURL+credential per 60s window. */
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
/** POST one minimal chat-completions request; never throws.
 * Header/body phase separation: `fetch` resolves on HEADERS, so the abort
 * signal must only gate the header phase. A gateway that answers HTTP at
 * all (any status, even 5xx) is ALIVE — a slow body is a live model burning
 * tokens, not a hang. Only a transport-level silence (status 0) is the
 * "no evidence of life" signal that justifies a fast fail and a hang
 * verdict. */
async function wirePost(baseURL, apiKey, body, parentSignal, 
/** Header-phase budget: how long we wait for the upstream to answer HTTP
 * before declaring it hung. Slower than the old flat 10s body budget, so
 * models that answer headers promptly are never misread as dead. */
headerMs = 8000) {
    const timeoutSignal = AbortSignal.timeout(headerMs);
    const signal = parentSignal === undefined
        ? timeoutSignal
        : AbortSignal.any([parentSignal, timeoutSignal]);
    const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
            },
            body: JSON.stringify(body),
            // Aborts the header wait; the body read below is NOT signal-gated, so
            // a slow-but-alive body finishes naturally.
            signal,
        });
        // Optional: cap the body read so a model that answers HTTP headers but
        // never finishes the body doesn't pin the probe forever. 20s is well
        // past any healthy first-completion latency yet bounded.
        const text = await Promise.race([
            response.text(),
            new Promise((resolve) => setTimeout(() => resolve(''), 20000)),
        ]).catch(() => '');
        return { status: response.status, ok: response.ok, body: text.slice(0, 400) };
    }
    catch (error) {
        return { status: 0, ok: false, body: error instanceof Error ? error.message : String(error) };
    }
}
async function runFullProbe(ctx, provider, profile, baseURL, model, control = { signal: new AbortController().signal, isCurrent: () => true }) {
    const startedAt = Date.now();
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.stream !== 'function') {
        return { ok: false, mode: 'full', error: 'LLM runtime not available' };
    }
    // 1. Discovery — declared capacity listing. Raced with a 10s cap that
    // ABORTS the underlying request (not just the wait), and cached per
    // baseURL+credential for 60s: a "probe all" pass over N models would
    // otherwise re-fetch the same listing N times in quick succession, and
    // two routes sharing an endpoint with different credentials must not
    // share one listing.
    let discovered = [];
    let discoveryError;
    if (typeof llm.discoverModels === 'function' && baseURL !== undefined) {
        const cacheKey = `${baseURL}\n${typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : ''}`;
        const cached = discoveryCache.get(cacheKey);
        if (cached !== undefined && Date.now() - cached.at < 60000) {
            discovered = cached.list;
        }
        else {
            const controller = new AbortController();
            const onParentAbort = () => controller.abort();
            control.signal.addEventListener('abort', onParentAbort, { once: true });
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                discovered = await llm.discoverModels('llm-pi-ai', { provider, baseURL }, controller.signal);
                discoveryCache.set(cacheKey, { at: Date.now(), list: discovered });
            }
            catch (error) {
                discoveryError = error instanceof Error ? error.message : String(error);
            }
            finally {
                clearTimeout(timer);
                control.signal.removeEventListener('abort', onParentAbort);
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
    // Per-stage wall-clock timings, published with the verdict so the user
    // can see WHERE the time went (and trust the result is evidence-based).
    const stages = {};
    const canWire = baseURL !== undefined && api === 'openai-completions' && entry !== undefined;
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
        }, control.signal);
        // Baseline: a plain user message must pass or the rest is meaningless.
        // Hang classification is the efficiency crux: 9/13 models in the live
        // measurement never answered HTTP at all (status 0) — each burned the
        // full 10s wire timeout, and the old code retried them once for 20s
        // apiece. A transport-level silence is almost always a genuinely dead
        // upstream (cooldown, queue wedge, backend down); a model that merely
        // THINKS slowly answers headers promptly. So: status 0 gets ONE fast
        // retry at half the budget (4s) — a transient scheduler stall recovers
        // in seconds, a dead queue does not — then hard-fails. Any HTTP status
        // (even 5xx) is authoritative evidence the upstream is alive.
        let baseline = await send('user');
        if (baseline.status === 0) {
            // Transport silence: one quick retry at half budget, then hang verdict.
            const retried = await wirePost(baseURL, apiKey, {
                model,
                messages: [
                    { role: 'user', content: 'Reply OK' },
                    { role: 'user', content: 'Reply OK' },
                ],
                max_tokens: 4,
            }, control.signal, 2000);
            baseline = { ...retried, ms: (baseline.ms ?? 0) + (retried.ms ?? 0) };
        }
        else if (!baseline.ok && (baseline.status === 429 || baseline.status >= 500)) {
            // Transient HTTP failure (rate limit / upstream 5xx): one retry at
            // full budget; the next scheduler tick may succeed.
            baseline = await send('user');
        }
        stages.baselineMs = baseline.ms ?? 0;
        if (!baseline.ok) {
            baselineError = baseline.status === 0
                ? (/^(?:abort|this operation was aborted|the operation was aborted(?: due to timeout)?|timeouterror|fetch failed)?$/i.test(baseline.body.trim())
                    // Bare abort/timeout text carries zero information for the user —
                    // say what actually happened: the gateway never answered HTTP.
                    ? 'unreachable: transport silence — no HTTP response within 8s (retried once at 2s); upstream hung, cooling down, or gateway overloaded'
                    : `unreachable: ${baseline.body}`)
                : `baseline ${baseline.status}: ${baseline.body}`;
        }
        else {
            // Role admission. Only evidence SPECIFIC to role handling writes a
            // compat fix: an explicit role-shaped error message (GLM 1214
            // 角色信息不正确, "developer role", "role.*not support*"), or a 400/422
            // whose body names roles. 401/403/404/quota/5xx are NOT role
            // evidence — they previously produced persistent bogus
            // `supportsDeveloperRole: false` writes for auth/quota failures.
            // A gateway-wrapped 5xx with a role-named body still counts; a bare
            // 5xx does not (inconclusive → untouched).
            const compat = (entry.compat ?? {});
            if (compat.supportsDeveloperRole === false) {
                roleFix = 'already';
            }
            else {
                const dev = await send('developer');
                stages.devMs = dev.ms ?? 0;
                if (dev.ok) {
                    roleFix = 'admitted';
                }
                else if (dev.status === 400 || dev.status === 422 || dev.status >= 500) {
                    const roleShaped = /role|角色|1214/i.test(dev.body) &&
                        !/quota|insufficient|unauthorized|forbidden|not_found|no such model|api key|billing/i.test(dev.body);
                    if (roleShaped) {
                        const sys = await send('system');
                        stages.sysMs = sys.ms ?? 0;
                        roleFix = sys.ok ? 'fixed' : 'failed';
                    }
                    // else: 4xx/5xx without role-named body — inconclusive, untouched.
                }
                // else: ambiguous (timeout/0, 429, other 4xx) — untouched.
            }
        }
    }
    // Combined write: capacity backfill + compat fix in one models-array
    // mutate, only when something actually changed. DSH 2.0.10's settings
    // service exposes expectedRevision CAS, so this is a true compare-and-set:
    // the merge runs against a fresh read, writes with that revision, and on
    // a conflict (an external edit or another plugin wrote between read and
    // write) re-reads and retries — no lost update. The no-change check keeps
    // listing-only passes from touching the document at all.
    let applied = false;
    let backfilled = 0;
    const compatChanged = roleFix === 'fixed';
    if ((discovered.length > 0 || compatChanged) && models !== undefined) {
        try {
            await enqueueWrite(async () => {
                if (!control.isCurrent())
                    return;
                const ok = await mutateSettingsCAS(ctx, (freshSection) => {
                    const list = freshSection?.providers?.[provider]?.models;
                    if (!Array.isArray(list))
                        return undefined;
                    let wrote = false;
                    const next = list.map((m) => {
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
                    return wrote ? { ops: [{ op: 'set', path: ['providers', provider, 'models'], value: next }] } : undefined;
                });
                applied = ok;
            });
        }
        catch {
            applied = false;
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
        const streamT0 = Date.now();
        const controller = new AbortController();
        const onParentAbort = () => controller.abort();
        control.signal.addEventListener('abort', onParentAbort, { once: true });
        try {
            const stream = llm.stream({
                provider,
                model,
                messages: [{ role: 'user', content }],
                maxTokens: 8,
                // pi-ai accepts an abort signal on stream options; when the probe
                // budget expires or a newer probe supersedes this one, the pending
                // iterator.next() and its underlying wire request are cancelled,
                // not merely abandoned.
                signal: controller.signal,
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
                    // proves the upstream consumed it. An error/aborted finish is not;
                    // when the failure names the image, it is explicit rejection evidence
                    // (some providers encode refusal as an error finish rather than a
                    // throw — previously this left imageVerdict unset forever).
                    if (firstTokenMs === null && !/^(error|aborted)/.test(reason)) {
                        firstTokenMs = Date.now() - startedAt;
                    }
                    if (imageProbe && /^(error|aborted)/.test(reason)) {
                        if (/not support|does not support|unsupported|not enabled|no vision|vision.*(?:not|unavail)|multimodal.*(?:not|unavail)|without vision|non-vision/i.test(reason)) {
                            // Capability refusal: the model has no image input at all.
                            imageVerdict = 'unsupported';
                        }
                        else if (/image|media|vision|multimodal/i.test(reason)) {
                            // Rejection: vision-capable model refused THIS image request.
                            imageVerdict = 'rejected';
                        }
                    }
                    break;
                }
                // Any streamed chunk (text delta, reasoning delta, tool call, role
                // preamble) proves the wire accepted the request — not just text.
                if (firstTokenMs === null && chunk.type !== 'error') {
                    firstTokenMs = Date.now() - startedAt;
                }
            }
            // Close the iterator deterministically and wait for the underlying
            // teardown instead of fire-and-forget; a rejecting `return()` becomes
            // an unhandled rejection if ignored.
            controller.abort();
            await iterator.return?.().catch(() => undefined);
            if (imageProbe && firstTokenMs !== null && imageVerdict === undefined)
                imageVerdict = 'accepted';
        }
        catch (error) {
            streamError = error instanceof Error ? error.message : String(error);
            if (imageProbe && imageVerdict === undefined) {
                if (/not support|does not support|unsupported|not enabled|no vision|vision.*(?:not|unavail)|multimodal.*(?:not|unavail)|without vision|non-vision/i.test(streamError)) {
                    // Capability refusal: the model has no image input at all.
                    imageVerdict = 'unsupported';
                }
                else if (/image|media|vision|multimodal|unsupported.*(?:content|type|image)/i.test(streamError)) {
                    // Rejection: vision-capable model refused THIS image request.
                    imageVerdict = 'rejected';
                }
            }
        }
        finally {
            controller.abort();
            control.signal.removeEventListener('abort', onParentAbort);
            stages.streamMs = Date.now() - streamT0;
        }
    } // end if (!wireDead)
    // 5. Declaration sync — the image-input checkbox is a declaration DSH
    // acts on, so a measured acceptance checks it and a measured rejection
    // clears it. Only the `image` modality is added or removed; every other
    // declared modality (e.g. audio) survives untouched. CAS with conflict
    // retry (DSH 2.0.10 revision), same as the combined write; written only
    // when the declaration disagrees with the measurement; never touched
    // when no verdict was reached.
    let imageSynced = false;
    if (imageVerdict !== undefined && control.isCurrent()) {
        try {
            await enqueueWrite(async () => {
                if (!control.isCurrent())
                    return;
                const ok = await mutateSettingsCAS(ctx, (freshSection) => {
                    const models = freshSection?.providers?.[provider]?.models;
                    if (!Array.isArray(models))
                        return undefined;
                    const current = models.find((m) => m.id === model);
                    const declared = current !== undefined && Array.isArray(current.input) && current.input.includes('image');
                    // `unsupported` is ALSO a declaration fix: a non-vision model that
                    // still declares image input is misconfigured — clear it too.
                    const shouldDeclare = imageVerdict === 'accepted';
                    if (declared === shouldDeclare)
                        return undefined;
                    const next = models.map((m) => {
                        if (m.id !== model)
                            return m;
                        const copy = { ...m };
                        const existing = Array.isArray(copy.input) ? copy.input.filter((v) => typeof v === 'string') : undefined;
                        if (shouldDeclare) {
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
                    return { ops: [{ op: 'set', path: ['providers', provider, 'models'], value: next }] };
                });
                imageSynced = ok;
            });
        }
        catch {
            // best-effort sync — the verdict is still reported
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
            stages,
            imageProbe,
            imageSupported: imageVerdict === 'rejected' || imageVerdict === 'unsupported' ? false : undefined,
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
        stages,
        firstTokenMs,
        finishReason: finishReason || 'stop',
        imageProbe,
        imageVerdict,
        imageSupported: imageVerdict === 'rejected' || imageVerdict === 'unsupported' ? false : undefined,
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
    const initial = settings.section(NS);
    if (initial === null || typeof initial !== 'object')
        return;
    if (initial[AUTO_REASONING_FLAG] === false)
        return;
    // Read → build → write runs as ONE enqueueWrite slot with CAS: the
    // auto-fill pass can no longer interleave its whole-array write with a
    // concurrent probe backfill/compat/image-sync write and clobber it, and
    // a conflict with an external editor re-reads and retries.
    await enqueueWrite(async () => {
        await mutateSettingsCAS(ctx, (freshSection) => {
            if (freshSection === null || typeof freshSection !== 'object')
                return undefined;
            if (freshSection[AUTO_REASONING_FLAG] === false)
                return undefined;
            const liveProviders = freshSection.providers;
            if (liveProviders === undefined || typeof liveProviders !== 'object')
                return undefined;
            const ops = [];
            for (const [route, profile] of Object.entries(liveProviders)) {
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
            return ops.length === 0 ? undefined : { ops };
        });
    });
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
        /** Abort controller of the most recent probe run — aborted on
         * disposal so a hung in-flight probe is cancelled with the plugin. */
        let activeController;
        /** Probe generation: bumped whenever a newer request arrives, the
         * 100s budget trips, or the effect disposes. A superseded probe may
         * still be running (the budget guard does not reach into
         * runFullProbe), so every late write checks isCurrent() first and
         * must never clobber the request/result slots of a newer probe. */
        let generation = 0;
        /** Last request id CONSUMED. Only recorded after the result is
         * published — a request whose write failed or whose probe was
         * superseded stays eligible for re-delivery instead of being
         * permanently suppressed. */
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
        /** Id of the request currently queued or running. A periodic recheck
         * consumes the slot ONLY for ids that are neither the last published
         * (lastProbeId) nor in flight (activeProbeId) — making the consumer
         * idempotent AND unstrandable: a missed settings/updated event can no
         * longer leave a written request sitting forever (client TIMEOUT). */
        let activeProbeId = '';
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
            if (id === lastProbeId || id === activeProbeId)
                return;
            activeProbeId = id;
            // A newer request supersedes any still-running older probe: bump
            // the generation so the old run's late writes are no-ops.
            generation++;
            // Abort the previous in-flight probe immediately so its wire
            // requests release the network connection and the settings lock
            // fast — without this, a hung old probe blocks the UI toggle
            // write (stale lock) for up to 100s.
            activeController?.abort();
            const myGeneration = generation;
            const controller = new AbortController();
            activeController = controller;
            const isCurrent = () => !cancelled && generation === myGeneration;
            probeChain = probeChain.then(async () => {
                const writeResult = async (value) => {
                    // Guard every publication: a superseded/disposed probe must not
                    // write its (stale) result or unset a NEWER request.
                    if (!isCurrent())
                        return;
                    const settings = settingsApi(ctx);
                    if (settings === undefined)
                        return;
                    // Serialize through enqueueWrite so the probe's CAS write
                    // doesn't block a concurrent UI toggle (auto-reasoning switch)
                    // or other settings mutations.
                    await enqueueWrite(async () => {
                        if (!isCurrent())
                            return;
                        await settings.mutate(NS, [
                            { op: 'set', path: [PROBE_RESULT_FLAG], value: { ...value, id, provider, model } },
                            { op: 'unset', path: [PROBE_REQ_FLAG] },
                        ]);
                    });
                    if (isCurrent())
                        lastProbeId = id;
                };
                try {
                    if (cancelled || !isCurrent())
                        return;
                    const providers = (readSection(ctx)?.providers ?? {});
                    const profile = providers[provider];
                    const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined;
                    let budget;
                    const result = await Promise.race([
                        runFullProbe(ctx, provider, profile, baseURL, model, { signal: controller.signal, isCurrent }),
                        new Promise((_, reject) => {
                            budget = setTimeout(() => reject(new Error('probe budget (100s) exceeded — a probe stage hung beyond every per-stage cap')), 100000);
                        }),
                    ]);
                    if (budget !== undefined)
                        clearTimeout(budget);
                    await writeResult(result);
                }
                catch (error) {
                    // Never leave the client waiting blind: a failure (including the
                    // budget guard itself) is published as the probe result. This
                    // catch also covers ANY unexpected throw in the link body —
                    // a request can no longer be consumed and stranded silently.
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
                finally {
                    // A stale budget timer would otherwise keep the event loop alive
                    // for the full 100s and (in tests) hang the process. Clear only
                    // OUR controller — a newer probe may have replaced it already.
                    if (activeController === controller)
                        activeController = undefined;
                    if (activeProbeId === id)
                        activeProbeId = '';
                    controller.abort();
                }
            }).catch(() => undefined);
        };
        // Safety-net recheck: consume any request that is neither published
        // nor in flight. If the debounced settings/updated handler ever misses
        // (event dropped, transient read failure, callback throw), the request
        // would otherwise sit in the slot forever and the client would show a
        // 110s TIMEOUT. The recheck makes the consumer self-healing.
        const recheck = setInterval(() => {
            if (cancelled)
                return;
            probe();
        }, 5000);
        // Debounce: 500ms quiet window before fill()+probe() fire. The handler
        // fires on every `settings/updated`, including rapid writes from
        // session-controller.saveSelection() on model switch. Without a
        // debounce, probe() immediately grabs the settings lock (up to 110s
        // budget), and the NEXT saveSelection() queues behind it — the UI
        // freezes until probe completes. The 500ms gap lets all writes in a
        // rapid burst finish before the plugin reads/writes again.
        let debounceTimer;
        const handler = (payload) => {
            if (typeof payload === 'string' && payload !== NS)
                return;
            sync(); // fast read — no lock, safe to run immediately
            if (debounceTimer !== undefined)
                clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                debounceTimer = undefined;
                if (cancelled)
                    return;
                void fill();
                void probe();
            }, 500);
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
            generation++;
            // Cancel any in-flight probe's stream/wire requests with the plugin.
            activeController?.abort();
            // Clear pending debounce so a queued fill()+probe() never fires after disposal.
            if (debounceTimer !== undefined)
                clearTimeout(debounceTimer);
            // Stop the safety-net recheck — an interval left running would keep
            // the event loop (and tests) alive forever.
            clearInterval(recheck);
            disposer();
            state.resolver = undefined;
        };
    }, 'dsh-provider-pro: user-agent resolver + effort auto-fill');
}
