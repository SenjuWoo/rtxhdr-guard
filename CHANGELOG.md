# Changelog

## v1.1.1 — 2026-11-25

**Disabling the plugin now really gives your overlay settings back.**

- 1.1.0 saved and read your previous overlay values with `BdApi.Data.setData` / `getData`, which
  BetterDiscord does not have (its `Data` API is `save` / `load` / `delete`). The calls went through
  optional chaining, so nothing was saved, nothing was logged, and disabling the plugin left the
  overlay off. The plugin now uses `save` / `load` and logs an error if the API is missing.
- The saved pair is deleted after it is restored. Without that, a fixed save would have revived an
  old value: restore once, switch the overlay off yourself, enable and disable the plugin again,
  and the overlay came back on.
- Tests: the BetterDiscord stub now has only the real `Data` methods (the old one offered
  `setData` / `getData`, which is why the test passed), a new check covers the second cycle, and
  every check prints an `ok` line.
- README rebuilt with a status panel guide, troubleshooting table and test output.

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
