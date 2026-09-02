# Changelog

All notable changes to dsh-provider-pro.

## [0.2.0] - 2026-09-02

### Compatibility
- Verified surface-by-surface against **DSH Desktop 2.0.4** (harness
  `0.1.2-alpha.1`, cordis `4.0.1`): the `settings.section` slot, the
  ModuleLoader client-bundle protocol (now hosted by `dsh-client-modules`),
  the settings service (`get`/`section`/`mutate` + `settings/updated`), the
  client RPC surface (`settings.describe`/`settings.mutate`, forwarded
  `settings/document-updated`/`llm/adapters-updated`), all 13 design tokens,
  and the pi-ai `reasoningEfforts` → `thinkingLevelMap` semantics are
  unchanged. No code change was required.
- Attribution handling in 2.0.x moved to `@deepseek-ai/dsh-llm`
  (`attributionHeaders()`); pi-ai's header merge still strips
  case-insensitive collisions from user headers, so the fetch-level UA
  replacement remains both necessary and effective.

### Changed
- Removed the stale `@deepseek-ai/dsh-client-runtime` reference from
  `dsh.client.inject` — the package no longer ships with DSH Desktop 2.0.x
  (the module system now lives in `dsh-client-modules`). The bundle only ever
  required `react`/`react/jsx-runtime` seed modules, so loading was never
  affected; this is a manifest cleanup.
- Updated the tsdown externals allow-list to the current DSH 2.0.x platform
  surface (`dsh-client-runtime/client` dropped).
- `prepare`/`prepack` now invoke `tsc`/`tsdown` directly instead of
  `npm run build`, so git installs work under any package manager.
- README: bilingual compatibility note + LINUX DO community link.

## [0.1.0] - 2026-08-20

### Added
- **Request-level User-Agent override** per custom provider (stored as
  `llm-pi-ai.providers.<route>.userAgent`). The host half patches
  `globalThis.fetch` with a baseURL-prefix matcher and replaces the
  `User-Agent` header on matching requests — the DSH built-in attribution
  header is overridden, not appended.
- **Official-channel-style reasoning-level switching** for custom models.
  A background filler gives every hand-declared custom model without a
  `reasoningEfforts` dictionary the full seven-level set, so the chat model
  picker shows the same reasoning-level row as the official channels, with
  the effective `defaultEffort` unset (the picker's "Default" entry is
  preselected; no thinking parameter is sent unless the user switches).
- **Settings → 模型增强 section** (`settings.section` slot, id `provider-pro`,
  order 15): a master switch
  (`llm-pi-ai.dshProviderProAutoReasoning`, absent = on) for the auto fill —
  turning it off strips only byte-identical auto-filled dictionaries and
  returns those models to provider defaults — plus one User-Agent input per
  provider. Styled with the platform design tokens (theme-following).
- Offline validation (`npm run check`) and a host-side smoke test
  (`npm run smoke`) covering the UA patch, the filler, and the master switch.

### Notes
- Effort-level names inside the model picker are hardcoded English in
  `dsh-llm-pi-ai` and cannot be localized by a third-party plugin; the
  Chinese labels live in this plugin's own settings section only.
- The filler touches only hand-declared `models[]` under the `llm-pi-ai`
  namespace; it never touches `modelOverrides` or catalog (official) models.