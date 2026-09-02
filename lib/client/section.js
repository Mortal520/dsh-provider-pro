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
import { FILL_REASONING_EFFORTS, LEGACY_REASONING_EFFORTS, INPUT_WITH_IMAGE, matchesEfforts } from '../shared.js';
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
.dpp-model-row {
  display: flex; align-items: center; gap: 10px; padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 13px;
}
.dpp-model-row:last-child { border-bottom: none; }
.dpp-model-id { font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dpp-model-cb { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.dpp-model-cb input { width: 14px; height: 14px; accent-color: var(--dsw-alias-button-primary-fill); margin: 0; }
.dpp-model-cb-label { color: var(--dsw-alias-label-secondary); }
.dpp-probe-btn {
  background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  padding: 2px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dpp-probe-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dpp-probe-result { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 4px 0 2px; line-height: 18px; }
.dpp-probe-ok { color: var(--dsw-alias-state-success-primary); }
.dpp-probe-fail { color: var(--dsw-alias-state-error-primary); }
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
/* -------------------------------------------------------- model row (image input + probe) */
function ModelRow(props) {
    const { route, profile, modelIndex, revision, api, t, probeApi, probeResult: probeAllResult, onMutated } = props;
    const model = profile.models?.[modelIndex];
    if (!model)
        return null;
    const hasImage = Array.isArray(model.input) && model.input.includes('image');
    const [probeResult, setProbeResult] = useState();
    const [probeBusy, setProbeBusy] = useState(false);
    // Merge: per-model probe result takes priority over probe-all result
    const displayResult = probeResult ?? probeAllResult;
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
        if (!probeApi)
            return;
        setProbeBusy(true);
        setProbeResult(undefined);
        try {
            const response = await probeApi.probe({ provider: route, model: model.id });
            if (response.ok)
                setProbeResult(response.value);
            else
                setProbeResult({ status: 'failure', provider: route, model: model.id, failure: { code: 'RPC', message: response.error?.message ?? 'Unknown error' } });
        }
        catch (error) {
            setProbeResult({ status: 'failure', provider: route, model: model.id, failure: { code: 'EXCEPTION', message: String(error) } });
        }
        finally {
            setProbeBusy(false);
        }
    };
    return (_jsxs("div", { className: "dpp-model-row", children: [_jsx("span", { className: "dpp-model-id", title: model.id, children: model.id }), _jsxs("label", { className: "dpp-model-cb", children: [_jsx("input", { type: "checkbox", checked: hasImage, onChange: (e) => void toggleImage(e.target.checked) }), _jsx("span", { className: "dpp-model-cb-label", children: t('imageInput') })] }), probeApi ? (_jsx("button", { type: "button", className: "dpp-probe-btn", disabled: probeBusy, onClick: () => void runProbe(), children: probeBusy ? t('probing') : t('probe') })) : null, displayResult ? (_jsx("span", { className: 'dpp-probe-result ' + (displayResult.status === 'success' ? 'dpp-probe-ok' : 'dpp-probe-fail'), children: displayResult.status === 'success'
                    ? `${displayResult.firstTokenMs ?? '—'}ms / ${displayResult.totalMs ?? '—'}ms / ${displayResult.finishReason ?? '—'}`
                    : `${displayResult.failure?.code ?? 'ERR'}: ${displayResult.failure?.message ?? ''}` })) : null] }));
}
/* --------------------------------------------------------- provider (UA) card */
function ProviderCard(props) {
    const { route, profile, revision, api, t, probeApi, onSaved } = props;
    const [ua, setUa] = useState(profile.userAgent ?? '');
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState();
    const [saved, setSaved] = useState(false);
    const [probeAllResults, setProbeAllResults] = useState(new Map());
    const [probeAllBusy, setProbeAllBusy] = useState(false);
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
        if (!probeApi || !profile.models?.length)
            return;
        setProbeAllBusy(true);
        setProbeAllResults(new Map());
        const results = new Map();
        for (const model of profile.models) {
            try {
                const response = await probeApi.probe({ provider: route, model: model.id });
                results.set(model.id, response.ok ? response.value : { status: 'failure', provider: route, model: model.id, failure: { code: 'RPC', message: response.error?.message ?? 'Unknown' } });
            }
            catch (error) {
                results.set(model.id, { status: 'failure', provider: route, model: model.id, failure: { code: 'EXCEPTION', message: String(error) } });
            }
            setProbeAllResults(new Map(results));
        }
        setProbeAllBusy(false);
    };
    return (_jsxs("div", { className: "dpp-card", role: "group", "aria-label": displayName, children: [_jsxs("div", { className: "dpp-card-header", children: [_jsx("span", { className: "dpp-provider", children: displayName }), _jsx("code", { className: "dpp-code", children: route }), _jsx("span", { className: "dpp-muted", children: baseURLMeta })] }), _jsxs("div", { className: "dpp-field", children: [_jsx("label", { className: "dpp-label", htmlFor: `ua-${route}`, children: t('userAgent') }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("input", { id: `ua-${route}`, className: "dpp-input", type: "text", value: ua, placeholder: t('userAgentPlaceholder'), disabled: busy, onChange: (event) => {
                                    setUa(event.target.value);
                                    setDirty(true);
                                    setSaved(false);
                                } }), dirty && ua.trim().length > 0 ? (_jsx("button", { type: "button", className: "dpp-btn", disabled: busy, onClick: () => {
                                    setUa('');
                                    setDirty(true);
                                }, children: t('resetUa') })) : null] }), _jsx("span", { className: "dpp-muted", children: t('userAgentHint') }), _jsxs("div", { className: "dpp-foot", children: [_jsx("button", { type: "button", className: "dpp-primary", disabled: busy || !dirty, onClick: () => void save(), children: busy ? t('saving') : t('save') }), saved ? (_jsx("span", { className: "dpp-ok", role: "status", children: t('saved') })) : null, failure !== undefined ? (_jsx("span", { className: "dpp-error", role: "status", children: failure })) : null] })] }), Array.isArray(profile.models) && profile.models.length > 0 ? (_jsxs("div", { className: "dpp-models", children: [_jsxs("div", { className: "dpp-models-title", children: [_jsxs("span", { children: [t('models'), "\uFF08", modelCount, "\uFF09"] }), probeApi ? (_jsx("button", { type: "button", className: "dpp-probe-btn", disabled: probeAllBusy, onClick: () => void probeAll(), children: probeAllBusy ? t('probing') : t('probeAll') })) : null] }), _jsx("div", { className: "dpp-models-scroll", children: profile.models.map((model, idx) => (_jsx(ModelRow, { route: route, profile: profile, modelIndex: idx, revision: revision, api: api, t: t, probeApi: probeApi, probeResult: probeAllBusy || probeAllResults.size > 0 ? probeAllResults.get(model.id) : undefined, onMutated: onSaved }, model.id))) })] })) : null] }));
}
/* ---------------------------------------------------------------- root UI */
export function ProviderProSection(props) {
    const { api, t, events, probeApi } = props;
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
    return (_jsxs("div", { className: "dpp-root", children: [_jsxs("div", { className: "dpp-header", children: [_jsxs("div", { children: [_jsx("h2", { className: "dpp-title", children: t('title') }), _jsx("p", { className: "dpp-desc", children: t('description') })] }), _jsx("button", { type: "button", className: "dpp-btn", onClick: reload, children: t('refresh') })] }), loadError !== undefined ? (_jsx("span", { className: "dpp-error", role: "status", children: loadError })) : null, api === undefined ? (_jsx("span", { className: "dpp-muted", children: t('rpcUnavailable') })) : view === undefined ? (_jsx("span", { className: "dpp-muted", children: t('loadFailed') })) : section === undefined ? (_jsx("span", { className: "dpp-muted", children: t('nsUnavailable') })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "dpp-switch", children: [_jsx("input", { className: "dpp-checkbox", type: "checkbox", checked: autoOn, disabled: flipBusy, onChange: (event) => void flipAuto(event.target.checked) }), _jsxs("span", { className: "dpp-switch-body", children: [_jsx("span", { className: "dpp-switch-label", children: t('autoReasoning') }), _jsx("span", { className: "dpp-muted dpp-switch-hint", children: t('autoReasoningHint') }), flipFailure !== undefined ? (_jsx("span", { className: "dpp-error dpp-switch-hint", role: "status", children: flipFailure })) : null, flipSaved ? (_jsx("span", { className: "dpp-ok dpp-switch-hint", role: "status", children: t('saved') })) : null] })] }), routes.length === 0 ? (_jsx("span", { className: "dpp-muted", children: t('noProviders') })) : (routes.map((route) => (_jsx(ProviderCard, { route: route, profile: providers[route] ?? {}, revision: view.revision, api: api, t: t, probeApi: probeApi, onSaved: reload }, route))))] }))] }));
}
