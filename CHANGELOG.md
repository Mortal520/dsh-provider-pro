# Changelog

All notable changes to dsh-provider-pro.

## [0.1.0] - 2025-01-11

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