# Changelog

## v1.1.0 — 2026-10-19

**The out-of-process overlay breaks RTX HDR too, so the plugin now turns the overlay off entirely.**

- Both switches go to `false` (`legacyEnabled: false`, `oopEnabled: false`). v1.0.0 left the
  out-of-process overlay on, which still composites over the game and still drops HDR — confirmed
  by the 14:50:50 log entry in a real Risk of Rain 2 session.
- Subscribes to `OVERLAY_SET_ENABLED` and re-applies the guard when anything re-enables the overlay.
  Discord's own toggle sets both switches to `true`; in the first test that silently undid the guard
  between two Discord starts, so the plugin now reverts it and says so once per minute.
- `start()` is now safe to call twice (a plugin reload no longer stacks dispatcher subscriptions).
- Panel and README state the trade-off plainly: no overlay over the game, or no RTX HDR.

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
