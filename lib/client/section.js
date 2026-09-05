import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * dsh-provider-pro — Settings → 模型增强 section (`settings.section` slot,
 * id `provider-pro`, order 15, right under the official 模型 page).
 *
 * Minimal by design: the two capabilities this plugin adds to custom providers
 * are (1) a request-level User-Agent override and (2) official-channel-style
 * reasoning-level switching, which is purely data-driven — the host half
 * auto-fills a five-level `reasoningEfforts` set (off/low/medium/high/max)
 * for every hand-declared custom model, and the composer's effort dropdown
 * appears exactly like the official channels'. So this screen only needs a
 * global master switch for that auto behavior plus one User-Agent input per
 * provider; level switching itself happens in the chat model picker, not here.
 */
import { useEffect, useState } from 'react';
import { NS } from './types';
import { FILL_REASONING_EFFORTS, LEGACY_REASONING_EFFORTS, INPUT_WITH_IMAGE, matchesEfforts, PROBE_REQ_FLAG, PROBE_RESULT_FLAG } from '../shared.js';
/** Top-level flag in the `llm-pi-ai` user layer controlling the auto-fill. */
const AUTO_REASONING_FLAG = 'dshProviderProAutoReasoning';
/* ------------------------------------------------------------------ styles */
const css = `
.dpp-root { display: flex; flex-direction: column; gap: 14px; }
.dpp-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dpp-title { font-size: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); margin: 0; line-height: 28px; }
.dpp-desc { font-size: 14px; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; line-height: 24px; }
.dpp-muted { font-size: 13px; color: var(--dsw-alias-label-secondary); line-height: 22px; }
.dpp-error { font-size: 13px; color: var(--dsw-alias-state-error-primary); }
.dpp-ok { font-size: 13px; color: var(--dsw-alias-state-success-primary); }
.dpp-switch {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
}
.dpp-switch-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dpp-switch-label { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); line-height: 20px; }
.dpp-switch-hint { margin-top: 2px; white-space: pre-line; }
.dpp-checkbox {
  width: 18px; height: 18px; margin: 3px 0 0; accent-color: var(--dsw-alias-button-primary-fill); flex: none;
}
.dpp-card {
  display: flex; flex-direction: column; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
}
.dpp-card-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dpp-provider { font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-code { font-family: var(--ds-font-family-code); font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dpp-field { display: flex; flex-direction: column; gap: 6px; }
.dpp-label { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-input {
  box-sizing: border-box; height: 32px; min-width: 16em; flex: 1; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px;
  outline: none;
}
.dpp-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dpp-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dpp-input:disabled { opacity: 0.55; }
.dpp-btn {
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 5px 12px; font-size: 13px; cursor: pointer;
}
.dpp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-primary {
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
  border: none; border-radius: 8px; padding: 6px 15px; font-size: 13px; font-weight: 500; cursor: pointer;
}
.dpp-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-foot { display: flex; align-items: center; gap: 12px; }
.dpp-models { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.dpp-models-scroll { max-height: 280px; overflow-y: auto; }
.dpp-models-title { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.dpp-toggle-btn {
  background: none; border: none; cursor: pointer; font-size: 10px;
  color: var(--dsw-alias-label-secondary); padding: 2px 4px; line-height: 1;
  transition: transform 0.15s;
}
.dpp-model-row {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 13px;
}
.dpp-model-row:last-child { border-bottom: none; }
/* flex: 1 1 auto + a real min-width: with flex: 1 (basis 0) a long probe
   result squeezed the model ID down to zero width — the row rendered
   dot/checkbox/button with no name at all. */
.dpp-model-id { font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-primary); min-width: 140px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.dpp-model-caps { display: inline-flex; gap: 4px; flex: none; }
.dpp-caps-chip {
  font-family: var(--ds-font-family-code); font-size: 11px; line-height: 16px;
  padding: 0 6px; border-radius: 8px; flex: none;
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary);
}
.dpp-model-cb { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.dpp-model-cb input { width: 14px; height: 14px; accent-color: var(--dsw-alias-button-primary-fill); margin: 0; }
.dpp-model-cb-label { color: var(--dsw-alias-label-secondary); }
.dpp-probe-btn {
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  padding: 2px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dpp-probe-btn:disabled { opacity: 0.55; cursor: not-allowed; }
/* Probe results always take their own full-width line below the row. */
.dpp-probe-result { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 4px 0 2px; line-height: 18px; flex: 1 1 100%; word-break: break-all; }
.dpp-probe-ok { color: var(--dsw-alias-state-success-primary); }
.dpp-probe-fail { color: var(--dsw-alias-state-error-primary); }
.dpp-alive-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-border-l2);
}
.dpp-alive-dot.up { background: var(--dsw-alias-state-success-primary); }
.dpp-alive-dot.down { background: var(--dsw-alias-state-error-primary); }
.dpp-alive-dot.unknown { background: var(--dsw-alias-border-l3); }
/* Credential-pool cooldown: not down, just temporarily out of quota. */
.dpp-alive-dot.cooldown { background: var(--dsw-alias-state-warning-primary, #e6a700); }
.dpp-provider-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; border-radius: 9px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
.dpp-provider-badge.cooldown { color: var(--dsw-alias-state-warning-primary, #e6a700); border-color: var(--dsw-alias-state-warning-primary, #e6a700); }
.dpp-provider-badge.up { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); border-color: transparent; }
.dpp-provider-badge.down { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); border-color: transparent; }
`;
let styleInjected = false;
function ensureStyle() {
    if (styleInjected)
        return;
    styleInjected = true;
    const el = document.createElement('style');
    el.setAttribute('data-dsh-provider-pro', '');
    el.textContent = css;
    document.head.appendChild(el);
}
/* ----------------------------------------------------------------- helpers */
function userSectionOf(view) {
    const user = view.user;
    if (user !== null && typeof user === 'object')
        return user;
    const value = view.value;
    if (value !== null && typeof value === 'object')
        return value;
    return undefined;
}
/**
 * True when `reasoningEfforts` is byte-for-byte one of our auto-fill shapes:
 * the current five-level dictionary, or the seven-level dictionary written by
 * 0.1.0–0.2.0 (legacy). A hand-customized dictionary never matches.
 */
function isAutoFilled(value) {
    return matchesEfforts(value, FILL_REASONING_EFFORTS) || matchesEfforts(value, LEGACY_REASONING_EFFORTS);
}
/** Next models array with the auto-filled dictionary removed, or undefined. */
function withoutAutoFilled(models) {
    if (!Array.isArray(models))
        return undefined;
    let changed = false;
    const next = models.map((entry) => {
        if (!isAutoFilled(entry.reasoningEfforts))
            return entry;
        changed = true;
        const { reasoningEfforts: _removed, ...rest } = entry;
        return rest;
    });
    return changed ? next : undefined;
}
/**
 * Ask the host half to run a real probe through DSH's LLM runtime. The host
 * (a) mints a 1×1 PNG attachment, (b) streams a minimal request carrying it,
 * and (c) writes the result back to the `dshProviderProProbeResult` settings
 * slot. The client (this function) writes the request, then waits for the
 * settings event (which fires when the host publishes the result) up to a
 * timeout.
 *
 * IPC path: both halves exchange through the llm-pi-ai user layer — the host
 * listens to `settings/updated`, consumes `PROBE_REQ_FLAG`, and publishes
 * `PROBE_RESULT_FLAG`. The `events` bus re-emits `settings/document-updated`
 * so we wake on the host's write instead of busy-polling `describe()`.
 */
async function sendProbeRequest(api, provider, model, events, mode) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Freshest revision: the write advances the document, and probe-all walks
    // many models in sequence, so a section-load snapshot goes stale quickly.
    const snapshot = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined);
    const nsView = snapshot?.namespaces.find((entry) => entry.ns === NS);
    if (nsView === undefined) {
        return { status: 'failure', provider, model, failure: { code: 'NO_NS', message: 'llm-pi-ai namespace not readable' } };
    }
    // Clear any stale result for this probe; write the request. The host reacts
    // on the resulting settings/updated, runs the probe, then publishes.
    const write = await api.mutate(NS, [
        { op: 'set', path: [PROBE_REQ_FLAG], value: { id, provider, model, mode } },
    ], nsView.revision);
    if (!write.ok) {
        return { status: 'failure', provider, model, failure: { code: 'WRITE_FAIL', message: write.error?.message ?? 'probe request write failed' } };
    }
    /** Read the probe-result slot from the freshest settings view. */
    const readSlot = async () => {
        const view = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined);
        const ns = view?.namespaces.find((entry) => entry.ns === NS);
        const user = (ns?.user ?? ns?.value ?? {});
        const slot = user[PROBE_RESULT_FLAG];
        if (slot === undefined || typeof slot !== 'object')
            return undefined;
        const result = slot;
        return result.id === id ? result : undefined;
    };
    // Wait on the settings event (host writes the result) with a timeout cap.
    const answer = await new Promise((resolve) => {
        let settled = false;
        let timer;
        let disposer;
        const done = (value) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            disposer?.();
            resolve(value);
        };
        disposer = events.on(() => {
            void readSlot().then(done);
        });
        // The full probe issues up to 7 small wire requests (discovery, role
        // pair, four levels) plus the image stream. The host now bounds every
        // stage: wire requests 10s each, discovery 10s, image stream 30s —
        // worst case ~100s — so the client cap sits just above it. A TIMEOUT
        // past that means the host half is genuinely stuck, not merely slow.
        timer = setTimeout(() => done(undefined), 110000);
        // One immediate read in case the result already landed before we attached.
        void readSlot().then((value) => { if (value !== undefined)
            done(value); });
    });
    if (answer === undefined) {
        // Timeout: likely the host probe never ran (LLM runtime absent) or the
        // request is stuck. Clean the request slot so a retry re-fires.
        const fresh = await api.describe().then((r) => (r.ok ? r.value : undefined)).catch(() => undefined);
        const freshNs = fresh?.namespaces.find((entry) => entry.ns === NS);
        if (freshNs !== undefined) {
            void api.mutate(NS, [{ op: 'unset', path: [PROBE_REQ_FLAG] }], freshNs.revision).catch(() => undefined);
        }
        return { status: 'failure', provider, model, failure: { code: 'TIMEOUT', message: 'probe timed out (host probe did not respond)' } };
    }
    if (!answer.ok) {
        // Relay error bodies arrive as truncated JSON ("baseline 429: {...}").
        // Reduce them to code + message + reset hint so a cooldown reads as
        // one line instead of a JSON dump.
        const compactWireError = (raw) => {
            const code = raw.match(/"code"\s*:\s*"([^"]+)"/)?.[1];
            const message = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
            const reset = raw.match(/"reset_time"\s*:\s*"([^"]+)"/)?.[1];
            if (code !== undefined || message !== undefined) {
                const parts = [code, message?.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).slice(0, 120), reset !== undefined ? `reset ${reset}` : undefined];
                return parts.filter(Boolean).join(' — ');
            }
            return raw;
        };
        const raw = answer.error ?? (answer.imageSupported === false ? 'model does not accept image input' : 'probe failed');
        const base = compactWireError(raw);
        // Credential-pool cooldown: the gateway told us exactly when quota
        // resets. Surface it as its own failure code so the UI can show an
        // amber "cooling" state instead of a red "down".
        const resetSecondsRaw = raw.match(/"reset_seconds"\s*:\s*(\d+)/)?.[1];
        const resetTimeHms = raw.match(/"reset_time"\s*:\s*"(\d+h\d+m\d+s)"/)?.[1];
        const resetSeconds = resetSecondsRaw !== undefined
            ? Number(resetSecondsRaw)
            : resetTimeHms !== undefined
                ? resetTimeHms.split(/[hms]/).filter(Boolean).reduce((acc, part, i) => acc + Number(part) * [3600, 60, 1].at(i), 0)
                : undefined;
        const cooldownUntil = resetSeconds !== undefined && Number.isFinite(resetSeconds) ? Date.now() + resetSeconds * 1000 : undefined;
        // Gateway infrastructure failures (its own DNS, dial, upstream
        // connection) are neither a model problem nor a plugin problem —
        // classify as INFRA with a human hint instead of a raw Go error.
        const infraMatch = raw.match(/(?:lookup\s+([a-z0-9.-]+)|dial\s+tcp[^"]*?([a-z0-9.-]+(?:\.\w+)+)|no such host|connection refused|network is unreachable|TLS handshake timeout|unexpected eof)/i);
        const isInfra = infraMatch !== undefined;
        if (isInfra) {
            const host = infraMatch?.[1] ?? infraMatch?.[2];
            return {
                status: 'failure', provider, model, totalMs: answer.totalMs,
                failure: {
                    code: 'INFRA',
                    message: `网关基础设施故障${host !== undefined ? `（无法解析/连接 ${host}）` : ''} — 模型与插件均无问题；网关上游 DNS/网络恢复后重试`,
                },
            };
        }
        const code = cooldownUntil !== undefined
            ? 'COOLDOWN'
            : answer.imageSupported === false ? 'IMAGE_UNSUPPORTED' : 'PROBE_FAIL';
        // Role-repair note: the deep probe hit a role rejection and the host
        // verified + repaired (or could not repair) the developer-role compat.
        const note = answer.roleFix === 'fixed'
            ? ' (role-fix: developer rejected → compat written, retry)'
            : answer.roleFix === 'failed'
                ? ' (role-fix attempted but write failed)'
                : undefined;
        return {
            status: 'failure', provider, model, totalMs: answer.totalMs,
            failure: {
                code,
                message: note !== undefined ? base + note : base,
                cooldownUntil,
            },
        };
    }
    if (answer.mode === 'full') {
        // One-button probe: capacity + role admission + effort levels + image.
        const parts = [];
        if (answer.contextWindow !== undefined)
            parts.push(`ctx: ${answer.contextWindow}`);
        if (answer.maxTokens !== undefined)
            parts.push(`max: ${answer.maxTokens}`);
        if (answer.roleFix === 'admitted')
            parts.push('role: developer');
        else if (answer.roleFix === 'already')
            parts.push('role: system');
        else if (answer.roleFix === 'fixed')
            parts.push('role: system (fixed)');
        else if (answer.roleFix === 'failed')
            parts.push('role: unresolved');
        if (answer.levels !== undefined && answer.levels.length > 0)
            parts.push(`efforts: ${answer.levels.join('/')}`);
        else if (answer.declaredNonReasoning === true)
            parts.push('efforts: non-reasoning');
        else
            parts.push('efforts: none');
        if (answer.unsupported !== undefined && answer.unsupported.length > 0)
            parts.push(`rejected: ${answer.unsupported.join('/')}`);
        if (answer.unknown !== undefined && answer.unknown.length > 0)
            parts.push(`flaky: ${answer.unknown.join('/')}`);
        if (answer.imageVerdict === 'accepted')
            parts.push('image: accepted');
        else if (answer.imageVerdict === 'rejected')
            parts.push('image: rejected');
        if (answer.imageSynced)
            parts.push('input synced');
        if (answer.firstTokenMs !== undefined && answer.firstTokenMs !== null)
            parts.push(`first-token: ${answer.firstTokenMs}ms`);
        if (answer.changed)
            parts.push('written');
        if (answer.backfilled !== undefined && answer.backfilled > 0)
            parts.push(`backfilled: ${answer.backfilled}`);
        return {
            status: 'success', provider, model, totalMs: answer.totalMs,
            firstTokenMs: answer.firstTokenMs,
            finishReason: parts.join(' · '),
            usage: {},
        };
    }
    if (answer.mode === 'capabilities') {
        // Legacy host (pre-0.5.0) answered a capabilities probe: capacity only.
        const caps = [];
        if (answer.contextWindow !== undefined)
            caps.push(`ctx: ${answer.contextWindow}`);
        if (answer.maxTokens !== undefined)
            caps.push(`max: ${answer.maxTokens}`);
        if (caps.length === 0)
            caps.push('no capacity info');
        if (answer.backfilled !== undefined && answer.backfilled > 0)
            caps.push(`backfilled: ${answer.backfilled}`);
        return {
            status: 'success', provider, model, totalMs: answer.totalMs,
            firstTokenMs: answer.firstTokenMs,
            finishReason: caps.join(' · '),
            usage: {},
        };
    }
    return {
        status: 'failure', provider, model,
        failure: { code: 'PROBE_FAIL', message: `unknown probe mode: ${String(answer.mode)}` },
    };
}
/* -------------------------------------------------------- model row (image input + probe) */
function ModelRow(props) {
    const { route, profile, modelIndex, revision, api, events, t, probeResult: probeAllResult, onMutated } = props;
    const model = profile.models?.[modelIndex];
    if (!model)
        return null;
    const hasImage = Array.isArray(model.input) && model.input.includes('image');
    const [probeResult, setProbeResult] = useState();
    const [probeBusy, setProbeBusy] = useState(false);
    // Merge: per-model probe result takes priority over probe-all result
    const displayResult = probeResult ?? probeAllResult;
    // Declared capacity from the settings entry (hand-set or probe-backfilled).
    // Compact display: 1024-multiples render KiB-style (262144 → 256k),
    // 1000-multiples decimal-style (200000 → 200k), anything else raw.
    const fmtTokens = (n) => {
        if (n % 1024 === 0)
            return `${n / 1024}k`;
        if (n % 1000 === 0)
            return `${n / 1000}k`;
        return String(n);
    };
    const declaredCaps = [model.contextWindow, model.maxTokens].filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
    const capsTitle = [
        model.contextWindow !== undefined ? `ctx ${model.contextWindow}` : undefined,
        model.maxTokens !== undefined ? `max ${model.maxTokens}` : undefined,
    ].filter(Boolean).join(' · ');
    const toggleImage = async (next) => {
        // Build the full models array with the target model's input field updated.
        // Writing the whole array avoids pi-ai path-resolution issues with
        // string-encoded array indices in nested settings paths.
        const models = (profile.models ?? []).map((entry, idx) => {
            if (idx !== modelIndex)
                return entry;
            const copy = { ...entry };
            if (next) {
                copy.input = [...INPUT_WITH_IMAGE];
            }
            else {
                delete copy.input;
            }
            return copy;
        });
        const op = { op: 'set', path: ['providers', route, 'models'], value: models };
        const response = await api.mutate(NS, [op], revision);
        if (response.ok)
            onMutated();
    };
    const runProbe = async () => {
        setProbeBusy(true);
        setProbeResult(undefined);
        try {
            setProbeResult(await sendProbeRequest(api, route, model.id, events, 'full'));
        }
        catch (error) {
            const err = error;
            setProbeResult({ status: 'failure', provider: route, model: model.id, totalMs: 0, failure: { code: 'ERROR', message: err.message ?? String(error) } });
        }
        finally {
            setProbeBusy(false);
        }
    };
    // Alive status: success = up; a credential-pool cooldown failure = its
    // own amber state (gateway reachable, model quota exhausted); other
    // failures = down.
    const aliveStatus = displayResult === undefined
        ? 'unknown'
        : displayResult.status === 'success'
            ? 'up'
            : displayResult.failure?.cooldownUntil !== undefined && displayResult.failure.cooldownUntil > Date.now()
                ? 'cooldown'
                : 'down';
    const cooldownHint = aliveStatus === 'cooldown' && displayResult?.status === 'failure'
        ? (() => {
            const mins = Math.max(1, Math.round((displayResult.failure.cooldownUntil - Date.now()) / 60000));
            return mins >= 60 ? `冷却中 ~${Math.floor(mins / 60)}h${mins % 60}m` : `冷却中 ~${mins}m`;
        })()
        : undefined;
    return (_jsxs("div", { className: "dpp-model-row", children: [_jsx("span", { className: 'dpp-alive-dot ' + aliveStatus, title: cooldownHint ?? aliveStatus }), _jsx("span", { className: "dpp-model-id", title: model.id, children: model.id }), declaredCaps.length > 0 ? (_jsx("span", { className: "dpp-model-caps", title: capsTitle, children: declaredCaps.map((n, i) => _jsx("span", { className: "dpp-caps-chip", children: fmtTokens(n) }, i)) })) : null, _jsxs("label", { className: "dpp-model-cb", children: [_jsx("input", { type: "checkbox", checked: hasImage, onChange: (e) => void toggleImage(e.target.checked) }), _jsx("span", { className: "dpp-model-cb-label", children: t('imageInput') })] }), _jsx("button", { type: "button", className: "dpp-probe-btn", disabled: probeBusy, title: t('probeHint'), onClick: () => void runProbe(), children: probeBusy ? t('probing') : t('probe') }), displayResult ? (_jsx("span", { className: 'dpp-probe-result ' + (displayResult.status === 'success' ? 'dpp-probe-ok' : 'dpp-probe-fail'), children: displayResult.status === 'success'
                    ? displayResult.finishReason ?? ''
                    : `${displayResult.failure?.code ?? 'ERR'}: ${displayResult.failure?.message ?? ''}` })) : null] }));
}
/* --------------------------------------------------------- provider (UA) card */
function ProviderCard(props) {
    const { route, profile, revision, api, events, t, onSaved } = props;
    const [ua, setUa] = useState(profile.userAgent ?? '');
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState();
    const [saved, setSaved] = useState(false);
    const [probeAllResults, setProbeAllResults] = useState(new Map());
    const [probeAllBusy, setProbeAllBusy] = useState(false);
    const [modelsExpanded, setModelsExpanded] = useState(false);
    const save = async () => {
        setBusy(true);
        setFailure(undefined);
        try {
            const ops = [
                ua.trim().length === 0
                    ? { op: 'unset', path: ['providers', route, 'userAgent'] }
                    : { op: 'set', path: ['providers', route, 'userAgent'], value: ua.trim() },
            ];
            const response = await api.mutate(NS, ops, revision);
            if (!response.ok) {
                setFailure(t('saveFailed') + (response.error?.message ?? ''));
                return;
            }
            setDirty(false);
            setSaved(true);
            onSaved();
        }
        catch (error) {
            setFailure(t('saveFailed') + String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const displayName = profile.displayName ?? route;
    const baseURLMeta = profile.baseURL ?? '—';
    const modelCount = profile.models?.length ?? 0;
    const probeAll = async () => {
        if (!profile.models?.length)
            return;
        setProbeAllBusy(true);
        // Models with a known, still-active credential cooldown are skipped —
        // the gateway answered authoritatively for hours; re-hitting it adds
        // nothing. Their previous result stays on display.
        const previous = probeAllResults;
        const now = Date.now();
        const results = new Map();
        for (const model of profile.models) {
            const priorCooldown = previous.get(model.id)?.failure?.cooldownUntil;
            if (priorCooldown !== undefined && priorCooldown > now) {
                results.set(model.id, previous.get(model.id));
                continue;
            }
            results.set(model.id, await sendProbeRequest(api, route, model.id, events, 'full'));
            setProbeAllResults(new Map(results));
        }
        setProbeAllResults(new Map(results));
        setProbeAllBusy(false);
    };
    // Provider-level alive badge: aggregated from per-model results. Any
    // success = up; every model cooling = cooling; all hard failures = down;
    // none run yet = untested.
    const providerAlive = (() => {
        if (probeAllResults.size === 0)
            return 'unknown';
        const values = [...probeAllResults.values()];
        if (values.some((r) => r.status === 'success'))
            return 'up';
        if (values.every((r) => r.status === 'failure' && (r.failure?.cooldownUntil === undefined || r.failure.cooldownUntil > Date.now()))
            && values.some((r) => r.failure?.cooldownUntil !== undefined))
            return 'cooldown';
        return 'down';
    })();
    const badgeMark = providerAlive === 'up' ? '✓' : providerAlive === 'down' ? '✗' : providerAlive === 'cooldown' ? '◷' : '·';
    return (_jsxs("div", { className: "dpp-card", role: "group", "aria-label": displayName, children: [_jsxs("div", { className: "dpp-card-header", children: [_jsx("span", { className: 'dpp-provider-badge ' + providerAlive, title: providerAlive, children: badgeMark }), _jsx("span", { className: "dpp-provider", children: displayName }), _jsx("code", { className: "dpp-code", children: route }), _jsx("span", { className: "dpp-muted", children: baseURLMeta })] }), _jsxs("div", { className: "dpp-field", children: [_jsx("label", { className: "dpp-label", htmlFor: `ua-${route}`, children: t('userAgent') }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("input", { id: `ua-${route}`, className: "dpp-input", type: "text", value: ua, placeholder: t('userAgentPlaceholder'), disabled: busy, onChange: (event) => {
                                    setUa(event.target.value);
                                    setDirty(true);
                                    setSaved(false);
                                } }), dirty && ua.trim().length > 0 ? (_jsx("button", { type: "button", className: "dpp-btn", disabled: busy, onClick: () => {
                                    setUa('');
                                    setDirty(true);
                                }, children: t('resetUa') })) : null] }), _jsx("span", { className: "dpp-muted", children: t('userAgentHint') }), _jsxs("div", { className: "dpp-foot", children: [_jsx("button", { type: "button", className: "dpp-primary", disabled: busy || !dirty, onClick: () => void save(), children: busy ? t('saving') : t('save') }), saved ? (_jsx("span", { className: "dpp-ok", role: "status", children: t('saved') })) : null, failure !== undefined ? (_jsx("span", { className: "dpp-error", role: "status", children: failure })) : null] })] }), Array.isArray(profile.models) && profile.models.length > 0 ? (_jsxs("div", { className: "dpp-models", children: [_jsxs("div", { className: "dpp-models-title", children: [_jsx("button", { type: "button", className: "dpp-toggle-btn", onClick: () => setModelsExpanded(v => !v), children: modelsExpanded ? '▼' : '▶' }), _jsxs("span", { children: [t('models'), "\uFF08", modelCount, "\uFF09"] }), modelsExpanded ? (_jsx("button", { type: "button", className: "dpp-probe-btn", disabled: probeAllBusy, onClick: () => void probeAll(), children: probeAllBusy ? t('probing') : t('probeAll') })) : null] }), modelsExpanded ? (_jsx("div", { className: "dpp-models-scroll", children: profile.models.map((model, idx) => (_jsx(ModelRow, { route: route, profile: profile, modelIndex: idx, revision: revision, api: api, events: events, t: t, probeResult: probeAllBusy || probeAllResults.size > 0 ? probeAllResults.get(model.id) : undefined, onMutated: onSaved }, model.id))) })) : null] })) : null] }));
}
/* ---------------------------------------------------------------- root UI */
export function ProviderProSection(props) {
    const { api, t, events } = props;
    ensureStyle();
    const [view, setView] = useState();
    const [loadError, setLoadError] = useState();
    const [reloadKey, setReloadKey] = useState(0);
    /** Current master-switch on/off (absent flag = on). */
    const [autoOn, setAutoOn] = useState(true);
    const [flipBusy, setFlipBusy] = useState(false);
    const [flipFailure, setFlipFailure] = useState();
    const [flipSaved, setFlipSaved] = useState(false);
    const reload = () => setReloadKey((current) => current + 1);
    useEffect(() => {
        let cancelled = false;
        setLoadError(undefined);
        if (api === undefined)
            return;
        void (async () => {
            try {
                const response = await api.describe();
                if (!response.ok) {
                    if (!cancelled)
                        setLoadError(response.error?.message ?? t('loadFailed'));
                    return;
                }
                const found = response.value.namespaces.find((entry) => entry.ns === NS);
                if (!cancelled && found !== undefined) {
                    setView(found);
                    const section = userSectionOf(found);
                    setAutoOn(section?.[AUTO_REASONING_FLAG] !== false);
                }
            }
            catch (error) {
                if (!cancelled)
                    setLoadError(String(error));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [api, reloadKey, t]);
    useEffect(() => events.on(reload), [events]);
    const section = view === undefined ? undefined : userSectionOf(view);
    const providers = section?.providers ?? {};
    const routes = Object.keys(providers);
    /** Flip the master switch: on is one flag write; off also reverts models
     * whose dictionary is byte-for-byte one of our auto-filled shapes. */
    const flipAuto = async (next) => {
        if (api === undefined || view === undefined || flipBusy)
            return;
        setFlipBusy(true);
        setFlipFailure(undefined);
        try {
            const ops = [{ op: 'set', path: [AUTO_REASONING_FLAG], value: next }];
            if (!next) {
                for (const route of routes) {
                    const nextModels = withoutAutoFilled(providers[route]?.models);
                    if (nextModels !== undefined) {
                        ops.push({ op: 'set', path: ['providers', route, 'models'], value: nextModels });
                    }
                }
            }
            const response = await api.mutate(NS, ops, view.revision);
            if (!response.ok) {
                setFlipFailure(t('saveFailed') + (response.error?.message ?? ''));
                return;
            }
            setAutoOn(next);
            setFlipSaved(true);
            reload();
        }
        catch (error) {
            setFlipFailure(t('saveFailed') + String(error));
        }
        finally {
            setFlipBusy(false);
        }
    };
    return (_jsxs("div", { className: "dpp-root", children: [_jsxs("div", { className: "dpp-header", children: [_jsxs("div", { children: [_jsx("h2", { className: "dpp-title", children: t('title') }), _jsx("p", { className: "dpp-desc", children: t('description') })] }), _jsx("button", { type: "button", className: "dpp-btn", onClick: reload, children: t('refresh') })] }), loadError !== undefined ? (_jsx("span", { className: "dpp-error", role: "status", children: loadError })) : null, api === undefined ? (_jsx("span", { className: "dpp-muted", children: t('rpcUnavailable') })) : view === undefined ? (_jsx("span", { className: "dpp-muted", children: t('loadFailed') })) : section === undefined ? (_jsx("span", { className: "dpp-muted", children: t('nsUnavailable') })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "dpp-switch", children: [_jsx("input", { className: "dpp-checkbox", type: "checkbox", checked: autoOn, disabled: flipBusy, onChange: (event) => void flipAuto(event.target.checked) }), _jsxs("span", { className: "dpp-switch-body", children: [_jsx("span", { className: "dpp-switch-label", children: t('autoReasoning') }), _jsx("span", { className: "dpp-muted dpp-switch-hint", children: t('autoReasoningHint') }), flipFailure !== undefined ? (_jsx("span", { className: "dpp-error dpp-switch-hint", role: "status", children: flipFailure })) : null, flipSaved ? (_jsx("span", { className: "dpp-ok dpp-switch-hint", role: "status", children: t('saved') })) : null] })] }), routes.length === 0 ? (_jsx("span", { className: "dpp-muted", children: t('noProviders') })) : (routes.map((route) => (_jsx(ProviderCard, { route: route, profile: providers[route] ?? {}, revision: view.revision, api: api, events: events, t: t, onSaved: reload }, route))))] }))] }));
}
