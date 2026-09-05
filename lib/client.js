window.__ModuleLoader__.load({
	id: "dsh-provider-pro",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/types.ts
		/** The pi-ai adapter's settings namespace (custom providers), read-only view. */
		const NS = "llm-pi-ai";
		//#endregion
		//#region src/shared.ts
		const FILL_REASONING_EFFORTS = {
			off: null,
			low: "low",
			medium: "medium",
			high: "high",
			max: "max"
		};
		/**
		* The auto-fill shape written by 0.1.0–0.2.0 (all seven levels). Recognized
		* byte-for-byte so those earlier writes migrate down to the five-level set
		* (host) and strip cleanly when the master switch turns off (client).
		*/
		const LEGACY_REASONING_EFFORTS = {
			off: null,
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max"
		};
		/**
		* True when `value` is byte-for-byte `dict`: every level mapped exactly as
		* declared and no extra keys. A dictionary that differs in any way (custom
		* subset, different wire value, extra level) is a hand-written one and is
		* never treated as ours.
		*/
		function matchesEfforts(value, dict) {
			if (value === null || typeof value !== "object") return false;
			const entries = value;
			for (const [level, wire] of Object.entries(dict)) if (entries[level] !== wire) return false;
			return Object.keys(entries).length === Object.keys(dict).length;
		}
		/** The value written to a model's `input` field when the user enables image support. */
		const INPUT_WITH_IMAGE = ["text", "image"];
		/** Client → host probe request slot (llm-pi-ai user layer). */
		const PROBE_REQ_FLAG = "dshProviderProProbe";
		/** Host → client probe result slot (llm-pi-ai user layer). */
		const PROBE_RESULT_FLAG = "dshProviderProProbeResult";
		//#endregion
		//#region src/client/section.tsx
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
		/** Top-level flag in the `llm-pi-ai` user layer controlling the auto-fill. */
		const AUTO_REASONING_FLAG = "dshProviderProAutoReasoning";
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
.dpp-provider-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; border-radius: 9px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
.dpp-provider-badge.up { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); border-color: transparent; }
.dpp-provider-badge.down { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); border-color: transparent; }
`;
		let styleInjected = false;
		function ensureStyle() {
			if (styleInjected) return;
			styleInjected = true;
			const el = document.createElement("style");
			el.setAttribute("data-dsh-provider-pro", "");
			el.textContent = css;
			document.head.appendChild(el);
		}
		function userSectionOf(view) {
			const user = view.user;
			if (user !== null && typeof user === "object") return user;
			const value = view.value;
			if (value !== null && typeof value === "object") return value;
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
			if (!Array.isArray(models)) return void 0;
			let changed = false;
			const next = models.map((entry) => {
				if (!isAutoFilled(entry.reasoningEfforts)) return entry;
				changed = true;
				const { reasoningEfforts: _removed, ...rest } = entry;
				return rest;
			});
			return changed ? next : void 0;
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
			const nsView = (await api.describe().then((r) => r.ok ? r.value : void 0).catch(() => void 0))?.namespaces.find((entry) => entry.ns === NS);
			if (nsView === void 0) return {
				status: "failure",
				provider,
				model,
				failure: {
					code: "NO_NS",
					message: "llm-pi-ai namespace not readable"
				}
			};
			const write = await api.mutate(NS, [{
				op: "set",
				path: [PROBE_REQ_FLAG],
				value: {
					id,
					provider,
					model,
					mode
				}
			}], nsView.revision);
			if (!write.ok) return {
				status: "failure",
				provider,
				model,
				failure: {
					code: "WRITE_FAIL",
					message: write.error?.message ?? "probe request write failed"
				}
			};
			/** Read the probe-result slot from the freshest settings view. */
			const readSlot = async () => {
				const ns = (await api.describe().then((r) => r.ok ? r.value : void 0).catch(() => void 0))?.namespaces.find((entry) => entry.ns === NS);
				const slot = (ns?.user ?? ns?.value ?? {})[PROBE_RESULT_FLAG];
				if (slot === void 0 || typeof slot !== "object") return void 0;
				const result = slot;
				return result.id === id ? result : void 0;
			};
			const answer = await new Promise((resolve) => {
				let settled = false;
				let timer;
				let disposer;
				const done = (value) => {
					if (settled) return;
					settled = true;
					if (timer !== void 0) clearTimeout(timer);
					disposer?.();
					resolve(value);
				};
				disposer = events.on(() => {
					readSlot().then(done);
				});
				timer = setTimeout(() => done(void 0), 6e4);
				readSlot().then((value) => {
					if (value !== void 0) done(value);
				});
			});
			if (answer === void 0) {
				const freshNs = (await api.describe().then((r) => r.ok ? r.value : void 0).catch(() => void 0))?.namespaces.find((entry) => entry.ns === NS);
				if (freshNs !== void 0) api.mutate(NS, [{
					op: "unset",
					path: [PROBE_REQ_FLAG]
				}], freshNs.revision).catch(() => void 0);
				return {
					status: "failure",
					provider,
					model,
					failure: {
						code: "TIMEOUT",
						message: "probe timed out (host probe did not respond)"
					}
				};
			}
			if (!answer.ok) {
				const compactWireError = (raw) => {
					const code = raw.match(/"code"\s*:\s*"([^"]+)"/)?.[1];
					const message = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
					const reset = raw.match(/"reset_time"\s*:\s*"([^"]+)"/)?.[1];
					if (code !== void 0 || message !== void 0) return [
						code,
						message?.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).slice(0, 120),
						reset !== void 0 ? `reset ${reset}` : void 0
					].filter(Boolean).join(" — ");
					return raw;
				};
				const base = compactWireError(answer.error ?? (answer.imageSupported === false ? "model does not accept image input" : "probe failed"));
				const note = answer.roleFix === "fixed" ? " (role-fix: developer rejected → compat written, retry)" : answer.roleFix === "failed" ? " (role-fix attempted but write failed)" : void 0;
				return {
					status: "failure",
					provider,
					model,
					totalMs: answer.totalMs,
					failure: {
						code: answer.imageSupported === false ? "IMAGE_UNSUPPORTED" : "PROBE_FAIL",
						message: note !== void 0 ? base + note : base
					}
				};
			}
			if (answer.mode === "full") {
				const parts = [];
				if (answer.contextWindow !== void 0) parts.push(`ctx: ${answer.contextWindow}`);
				if (answer.maxTokens !== void 0) parts.push(`max: ${answer.maxTokens}`);
				if (answer.roleFix === "admitted") parts.push("role: developer");
				else if (answer.roleFix === "already") parts.push("role: system");
				else if (answer.roleFix === "fixed") parts.push("role: system (fixed)");
				else if (answer.roleFix === "failed") parts.push("role: unresolved");
				if (answer.levels !== void 0 && answer.levels.length > 0) parts.push(`efforts: ${answer.levels.join("/")}`);
				else if (answer.declaredNonReasoning === true) parts.push("efforts: non-reasoning");
				else parts.push("efforts: none");
				if (answer.unsupported !== void 0 && answer.unsupported.length > 0) parts.push(`rejected: ${answer.unsupported.join("/")}`);
				if (answer.unknown !== void 0 && answer.unknown.length > 0) parts.push(`flaky: ${answer.unknown.join("/")}`);
				if (answer.imageProbe) parts.push("image: accepted");
				else if (answer.imageSupported === false) parts.push("image: rejected");
				if (answer.firstTokenMs !== void 0 && answer.firstTokenMs !== null) parts.push(`first-token: ${answer.firstTokenMs}ms`);
				if (answer.changed) parts.push("written");
				if (answer.backfilled !== void 0 && answer.backfilled > 0) parts.push(`backfilled: ${answer.backfilled}`);
				return {
					status: "success",
					provider,
					model,
					totalMs: answer.totalMs,
					firstTokenMs: answer.firstTokenMs,
					finishReason: parts.join(" · "),
					usage: {}
				};
			}
			if (answer.mode === "capabilities") {
				const caps = [];
				if (answer.contextWindow !== void 0) caps.push(`ctx: ${answer.contextWindow}`);
				if (answer.maxTokens !== void 0) caps.push(`max: ${answer.maxTokens}`);
				if (caps.length === 0) caps.push("no capacity info");
				if (answer.backfilled !== void 0 && answer.backfilled > 0) caps.push(`backfilled: ${answer.backfilled}`);
				return {
					status: "success",
					provider,
					model,
					totalMs: answer.totalMs,
					firstTokenMs: answer.firstTokenMs,
					finishReason: caps.join(" · "),
					usage: {}
				};
			}
			return {
				status: "failure",
				provider,
				model,
				failure: {
					code: "PROBE_FAIL",
					message: `unknown probe mode: ${String(answer.mode)}`
				}
			};
		}
		function ModelRow(props) {
			const { route, profile, modelIndex, revision, api, events, t, probeResult: probeAllResult, onMutated } = props;
			const model = profile.models?.[modelIndex];
			if (!model) return null;
			const hasImage = Array.isArray(model.input) && model.input.includes("image");
			const [probeResult, setProbeResult] = (0, react.useState)();
			const [probeBusy, setProbeBusy] = (0, react.useState)(false);
			const displayResult = probeResult ?? probeAllResult;
			const fmtTokens = (n) => {
				if (n % 1024 === 0) return `${n / 1024}k`;
				if (n % 1e3 === 0) return `${n / 1e3}k`;
				return String(n);
			};
			const declaredCaps = [model.contextWindow, model.maxTokens].filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
			const capsTitle = [model.contextWindow !== void 0 ? `ctx ${model.contextWindow}` : void 0, model.maxTokens !== void 0 ? `max ${model.maxTokens}` : void 0].filter(Boolean).join(" · ");
			const toggleImage = async (next) => {
				const models = (profile.models ?? []).map((entry, idx) => {
					if (idx !== modelIndex) return entry;
					const copy = { ...entry };
					if (next) copy.input = [...INPUT_WITH_IMAGE];
					else delete copy.input;
					return copy;
				});
				const op = {
					op: "set",
					path: [
						"providers",
						route,
						"models"
					],
					value: models
				};
				if ((await api.mutate("llm-pi-ai", [op], revision)).ok) onMutated();
			};
			const runProbe = async () => {
				setProbeBusy(true);
				setProbeResult(void 0);
				try {
					setProbeResult(await sendProbeRequest(api, route, model.id, events, "full"));
				} catch (error) {
					const err = error;
					setProbeResult({
						status: "failure",
						provider: route,
						model: model.id,
						totalMs: 0,
						failure: {
							code: "ERROR",
							message: err.message ?? String(error)
						}
					});
				} finally {
					setProbeBusy(false);
				}
			};
			const aliveStatus = displayResult === void 0 ? "unknown" : displayResult.status === "success" ? "up" : "down";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dpp-model-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-alive-dot " + aliveStatus,
						title: aliveStatus
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-model-id",
						title: model.id,
						children: model.id
					}),
					declaredCaps.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-model-caps",
						title: capsTitle,
						children: declaredCaps.map((n, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dpp-caps-chip",
							children: fmtTokens(n)
						}, i))
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dpp-model-cb",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: hasImage,
							onChange: (e) => void toggleImage(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dpp-model-cb-label",
							children: t("imageInput")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dpp-probe-btn",
						disabled: probeBusy,
						title: t("probeHint"),
						onClick: () => void runProbe(),
						children: probeBusy ? t("probing") : t("probe")
					}),
					displayResult ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-probe-result " + (displayResult.status === "success" ? "dpp-probe-ok" : "dpp-probe-fail"),
						children: displayResult.status === "success" ? displayResult.finishReason ?? "" : `${displayResult.failure?.code ?? "ERR"}: ${displayResult.failure?.message ?? ""}`
					}) : null
				]
			});
		}
		function ProviderCard(props) {
			const { route, profile, revision, api, events, t, onSaved } = props;
			const [ua, setUa] = (0, react.useState)(profile.userAgent ?? "");
			const [dirty, setDirty] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)();
			const [saved, setSaved] = (0, react.useState)(false);
			const [probeAllResults, setProbeAllResults] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [probeAllBusy, setProbeAllBusy] = (0, react.useState)(false);
			const [modelsExpanded, setModelsExpanded] = (0, react.useState)(false);
			const save = async () => {
				setBusy(true);
				setFailure(void 0);
				try {
					const ops = [ua.trim().length === 0 ? {
						op: "unset",
						path: [
							"providers",
							route,
							"userAgent"
						]
					} : {
						op: "set",
						path: [
							"providers",
							route,
							"userAgent"
						],
						value: ua.trim()
					}];
					const response = await api.mutate(NS, ops, revision);
					if (!response.ok) {
						setFailure(t("saveFailed") + (response.error?.message ?? ""));
						return;
					}
					setDirty(false);
					setSaved(true);
					onSaved();
				} catch (error) {
					setFailure(t("saveFailed") + String(error));
				} finally {
					setBusy(false);
				}
			};
			const displayName = profile.displayName ?? route;
			const baseURLMeta = profile.baseURL ?? "—";
			const modelCount = profile.models?.length ?? 0;
			const probeAll = async () => {
				if (!profile.models?.length) return;
				setProbeAllBusy(true);
				setProbeAllResults(/* @__PURE__ */ new Map());
				const results = /* @__PURE__ */ new Map();
				for (const model of profile.models) {
					results.set(model.id, await sendProbeRequest(api, route, model.id, events, "full"));
					setProbeAllResults(new Map(results));
				}
				setProbeAllBusy(false);
			};
			const providerAlive = (() => {
				if (probeAllResults.size === 0) return "unknown";
				return [...probeAllResults.values()].some((r) => r.status === "success") ? "up" : "down";
			})();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dpp-card",
				role: "group",
				"aria-label": displayName,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dpp-card-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dpp-provider-badge " + providerAlive,
								title: providerAlive,
								children: providerAlive === "up" ? "✓" : providerAlive === "down" ? "✗" : "·"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dpp-provider",
								children: displayName
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: "dpp-code",
								children: route
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dpp-muted",
								children: baseURLMeta
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dpp-field",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: "dpp-label",
								htmlFor: `ua-${route}`,
								children: t("userAgent")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									flexWrap: "wrap",
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: `ua-${route}`,
									className: "dpp-input",
									type: "text",
									value: ua,
									placeholder: t("userAgentPlaceholder"),
									disabled: busy,
									onChange: (event) => {
										setUa(event.target.value);
										setDirty(true);
										setSaved(false);
									}
								}), dirty && ua.trim().length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dpp-btn",
									disabled: busy,
									onClick: () => {
										setUa("");
										setDirty(true);
									},
									children: t("resetUa")
								}) : null]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dpp-muted",
								children: t("userAgentHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dpp-foot",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dpp-primary",
										disabled: busy || !dirty,
										onClick: () => void save(),
										children: busy ? t("saving") : t("save")
									}),
									saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dpp-ok",
										role: "status",
										children: t("saved")
									}) : null,
									failure !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dpp-error",
										role: "status",
										children: failure
									}) : null
								]
							})
						]
					}),
					Array.isArray(profile.models) && profile.models.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dpp-models",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dpp-models-title",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dpp-toggle-btn",
									onClick: () => setModelsExpanded((v) => !v),
									children: modelsExpanded ? "▼" : "▶"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("models"),
									"（",
									modelCount,
									"）"
								] }),
								modelsExpanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dpp-probe-btn",
									disabled: probeAllBusy,
									onClick: () => void probeAll(),
									children: probeAllBusy ? t("probing") : t("probeAll")
								}) : null
							]
						}), modelsExpanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dpp-models-scroll",
							children: profile.models.map((model, idx) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
								route,
								profile,
								modelIndex: idx,
								revision,
								api,
								events,
								t,
								probeResult: probeAllBusy || probeAllResults.size > 0 ? probeAllResults.get(model.id) : void 0,
								onMutated: onSaved
							}, model.id))
						}) : null]
					}) : null
				]
			});
		}
		function ProviderProSection(props) {
			const { api, t, events } = props;
			ensureStyle();
			const [view, setView] = (0, react.useState)();
			const [loadError, setLoadError] = (0, react.useState)();
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			/** Current master-switch on/off (absent flag = on). */
			const [autoOn, setAutoOn] = (0, react.useState)(true);
			const [flipBusy, setFlipBusy] = (0, react.useState)(false);
			const [flipFailure, setFlipFailure] = (0, react.useState)();
			const [flipSaved, setFlipSaved] = (0, react.useState)(false);
			const reload = () => setReloadKey((current) => current + 1);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setLoadError(void 0);
				if (api === void 0) return;
				(async () => {
					try {
						const response = await api.describe();
						if (!response.ok) {
							if (!cancelled) setLoadError(response.error?.message ?? t("loadFailed"));
							return;
						}
						const found = response.value.namespaces.find((entry) => entry.ns === NS);
						if (!cancelled && found !== void 0) {
							setView(found);
							const section = userSectionOf(found);
							setAutoOn(section?.[AUTO_REASONING_FLAG] !== false);
						}
					} catch (error) {
						if (!cancelled) setLoadError(String(error));
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [
				api,
				reloadKey,
				t
			]);
			(0, react.useEffect)(() => events.on(reload), [events]);
			const section = view === void 0 ? void 0 : userSectionOf(view);
			const providers = section?.providers ?? {};
			const routes = Object.keys(providers);
			/** Flip the master switch: on is one flag write; off also reverts models
			* whose dictionary is byte-for-byte one of our auto-filled shapes. */
			const flipAuto = async (next) => {
				if (api === void 0 || view === void 0 || flipBusy) return;
				setFlipBusy(true);
				setFlipFailure(void 0);
				try {
					const ops = [{
						op: "set",
						path: [AUTO_REASONING_FLAG],
						value: next
					}];
					if (!next) for (const route of routes) {
						const nextModels = withoutAutoFilled(providers[route]?.models);
						if (nextModels !== void 0) ops.push({
							op: "set",
							path: [
								"providers",
								route,
								"models"
							],
							value: nextModels
						});
					}
					const response = await api.mutate(NS, ops, view.revision);
					if (!response.ok) {
						setFlipFailure(t("saveFailed") + (response.error?.message ?? ""));
						return;
					}
					setAutoOn(next);
					setFlipSaved(true);
					reload();
				} catch (error) {
					setFlipFailure(t("saveFailed") + String(error));
				} finally {
					setFlipBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dpp-root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dpp-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "dpp-title",
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dpp-desc",
							children: t("description")
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dpp-btn",
							onClick: reload,
							children: t("refresh")
						})]
					}),
					loadError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-error",
						role: "status",
						children: loadError
					}) : null,
					api === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-muted",
						children: t("rpcUnavailable")
					}) : view === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-muted",
						children: t("loadFailed")
					}) : section === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-muted",
						children: t("nsUnavailable")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dpp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dpp-checkbox",
							type: "checkbox",
							checked: autoOn,
							disabled: flipBusy,
							onChange: (event) => void flipAuto(event.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dpp-switch-body",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dpp-switch-label",
									children: t("autoReasoning")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dpp-muted dpp-switch-hint",
									children: t("autoReasoningHint")
								}),
								flipFailure !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dpp-error dpp-switch-hint",
									role: "status",
									children: flipFailure
								}) : null,
								flipSaved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dpp-ok dpp-switch-hint",
									role: "status",
									children: t("saved")
								}) : null
							]
						})]
					}), routes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-muted",
						children: t("noProviders")
					}) : routes.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
						route,
						profile: providers[route] ?? {},
						revision: view.revision,
						api,
						events,
						t,
						onSaved: reload
					}, route))] })
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Locale dictionaries for dsh-provider-pro's Settings → 模型增强 section. */
		const zh = {
			nav: "模型增强",
			title: "模型增强",
			description: "自定义供应方的两个增强：请求级 User-Agent 覆盖，以及和官方渠道一样的模型推理等级切换（在聊天中直接切换，无需逐模型配置）。",
			refresh: "刷新",
			autoReasoning: "为全部自定义模型启用推理等级切换",
			autoReasoningHint: "开启：为所有自定义模型在聊天中提供推理等级切换（Off / Low / Medium / High / Max），默认档位 Default（不发送思考参数，由供应方决定）。\n关闭：移除自动补全的档位，恢复供应方默认；手动设置的等级不受影响。",
			nsUnavailable: "llm-pi-ai 命名空间不可用：当前组合未启用自定义供应方（模型页的\"手动添加供应方\"功能）。",
			loadFailed: "读取设置失败",
			rpcUnavailable: "设置 RPC 不可用：本插件需要 DSH Desktop 2.0+ 的 remote.settings 接口。",
			noProviders: "还没有自定义供应方。请先在「设置 → 模型 → 手动添加」中创建一个供应方。",
			userAgent: "User-Agent",
			userAgentPlaceholder: "例如 Mozilla/5.0 (compatible; MyBot/1.0)",
			userAgentHint: "发往该供应方 baseURL 前缀的请求会带上这个 User-Agent（覆盖内置 attribution 头）；留空保存则清除覆盖。",
			resetUa: "清空",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			saveFailed: "保存失败：",
			models: "模型",
			imageInput: "支持图片输入",
			probing: "探测中…",
			probe: "探测",
			probeHint: "一次实测：上下文窗口（网关声明，缺失则回填）+ developer 角色兼容（被拒自动改用 system）+ 推理等级逐档验证（据实写入）+ 图片输入（真实流式请求）。",
			probeAll: "一键探测"
		};
		const en = {
			nav: "Model Enhance",
			title: "Model Enhance",
			description: "Two upgrades for custom providers: a request-level User-Agent override, and official-channel-style reasoning-level switching (switched in the chat model picker — no per-model configuration needed).",
			refresh: "Refresh",
			autoReasoning: "Enable reasoning-level switching for all custom models",
			autoReasoningHint: "On: adds reasoning-level switching (Off / Low / Medium / High / Max) to every custom model in chat, starting at Default (no thinking parameter sent; the provider decides).\nOff: removes auto-filled levels back to provider default; manually set levels are untouched.",
			nsUnavailable: "The llm-pi-ai namespace is unavailable: this deployment does not compose custom providers.",
			loadFailed: "Failed to load settings",
			rpcUnavailable: "Settings RPC unavailable: this plugin requires the remote.settings face (DSH Desktop 2.0+).",
			noProviders: "No custom providers yet. Create one under Settings → Models → custom provider.",
			userAgent: "User-Agent",
			userAgentPlaceholder: "e.g. Mozilla/5.0 (compatible; MyBot/1.0)",
			userAgentHint: "Requests to this provider’s baseURL prefix carry this User-Agent (overriding the built-in attribution header). Empty + save clears the override.",
			resetUa: "Clear",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			saveFailed: "Save failed: ",
			models: "Models",
			imageInput: "Support image input",
			probing: "Probing…",
			probe: "Probe",
			probeHint: "One pass measures: context window (gateway-declared, backfilled when missing) + developer-role compat (auto-falls back to system when refused) + per-level reasoning-effort validation (written as measured) + image input (real streaming request).",
			probeAll: "Probe all"
		};
		//#endregion
		//#region src/client/index.ts
		const NS_LOCALE = "dsh-provider-pro";
		/**
		* Required services (cordis fiber inject). `remote.settings` for reading
		* and writing llm-pi-ai settings.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings"
		];
		const name = "dsh-provider-pro";
		function apply(ctx) {
			const c = ctx;
			c.effect(() => {
				c.locale.register(NS_LOCALE, {
					zh,
					en
				});
			});
			const t = c.locale.bind(NS_LOCALE);
			const listeners = /* @__PURE__ */ new Set();
			const events = { on(fn) {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
				};
			} };
			c.effect(() => {
				const refresh = (ns) => {
					if (ns !== "llm-pi-ai") return;
					for (const listener of [...listeners]) listener();
				};
				const disposers = [c.remote.$on("settings/document-updated", refresh), c.remote.$on("llm/adapters-updated", refresh)];
				return () => {
					for (const disposer of disposers) disposer();
					listeners.clear();
				};
			});
			const injected = () => ({
				api: c.remote.settings,
				t,
				events
			});
			c.slots.inject("settings.section", () => c.slots.register({
				name: "settings.section",
				id: "dsh-provider-pro",
				order: 15,
				label: () => t("nav"),
				locale: NS_LOCALE,
				inject: injected
			}, ProviderProSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map