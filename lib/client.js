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
.dpp-switch-label { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpp-switch-hint { margin-top: 4px; }
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
		function ProviderCard(props) {
			const { route, profile, revision, api, t, onSaved } = props;
			const [ua, setUa] = (0, react.useState)(profile.userAgent ?? "");
			const [dirty, setDirty] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)();
			const [saved, setSaved] = (0, react.useState)(false);
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dpp-card",
				role: "group",
				"aria-label": displayName,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dpp-card-header",
					children: [
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
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
				})]
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
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
						] })]
					}), routes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dpp-muted",
						children: t("noProviders")
					}) : routes.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
						route,
						profile: providers[route] ?? {},
						revision: view.revision,
						api,
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
			autoReasoningHint: "开启（默认）：所有自定义模型在对话的模型选择器里出现推理等级切换（Off/Low/Medium/High/Max），初始档位为「Default」（请求不带思考参数、由供应方决定），随时可在聊天里切换。关闭：移除自动补全的档位回到供应方默认；你自己手动设过的等级不受影响。",
			nsUnavailable: "llm-pi-ai 命名空间不可用：当前组合未启用自定义供应方（模型页的“手动添加供应方”功能）。",
			loadFailed: "读取设置失败",
			rpcUnavailable: "设置 RPC 不可用：本插件需要 DSH Desktop 2.0+ 的 remote.settings 接口。",
			noProviders: "还没有自定义供应方。请先在「设置 → 模型 → 手动添加」中创建一个供应方。",
			route: "路由",
			baseUrl: "Base URL",
			userAgent: "User-Agent",
			userAgentPlaceholder: "例如 Mozilla/5.0 (compatible; MyBot/1.0)",
			userAgentHint: "发往该供应方 baseURL 前缀的请求会带上这个 User-Agent（覆盖内置 attribution 头）；留空保存则清除覆盖。",
			resetUa: "清空",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			saveFailed: "保存失败："
		};
		const en = {
			nav: "Model Enhance",
			title: "Model Enhance",
			description: "Two upgrades for custom providers: a request-level User-Agent override, and official-channel-style reasoning-level switching (switched in the chat model picker — no per-model configuration needed).",
			refresh: "Refresh",
			autoReasoning: "Enable reasoning-level switching for all custom models",
			autoReasoningHint: "On (default): every custom model gets reasoning-level switching in the chat model picker (Off/Low/Medium/High/Max), starting at \"Default\" (no thinking parameter sent; the provider decides) — switch any time in chat. Off: auto-filled levels are stripped back to provider defaults; levels you set manually are untouched.",
			nsUnavailable: "The llm-pi-ai namespace is unavailable: this deployment does not compose custom providers.",
			loadFailed: "Failed to load settings",
			rpcUnavailable: "Settings RPC unavailable: this plugin requires the remote.settings face (DSH Desktop 2.0+).",
			noProviders: "No custom providers yet. Create one under Settings → Models → custom provider.",
			route: "Route",
			baseUrl: "Base URL",
			userAgent: "User-Agent",
			userAgentPlaceholder: "e.g. Mozilla/5.0 (compatible; MyBot/1.0)",
			userAgentHint: "Requests to this provider’s baseURL prefix carry this User-Agent (overriding the built-in attribution header). Empty + save clears the override.",
			resetUa: "Clear",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			saveFailed: "Save failed: "
		};
		//#endregion
		//#region src/client/index.ts
		const NS_LOCALE = "dsh-provider-pro";
		/**
		* Required services (cordis fiber inject). The slot registration defers on
		* `slots.inject()`, so activation order against ui-settings is not a concern.
		* The settings wire face is read lazily off the remote service (DSH 2.0.x
		* shape) rather than injected: an absent face degrades to a clear message in
		* the section instead of blocking plugin activation.
		*/
		const inject = [
			"slots",
			"locale",
			"remote"
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