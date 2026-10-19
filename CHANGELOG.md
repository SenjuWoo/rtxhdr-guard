# Changelog

## v1.0.0 — 2026-10-19

First release.

- Forces Discord's overlay to the out-of-process path (`legacyEnabled: false`, `oopEnabled: true`)
  so the in-process DXGI hook is never injected into the game, which is what breaks RTX HDR.
- Applies at every Discord start and dispatches `OVERLAY_SET_ENABLED` to retrack running games
  without a game restart.
- Restores the previous overlay settings when the plugin is disabled.
- Settings panel shows live state plus Discord's own per-game decision
  (`Hook` / `Out of Process` / `Disabled`) and its reason string.
- Verified against Discord 1.0.9262 and BetterDiscord 1.14.3.
