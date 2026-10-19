<p align="center">
  <img src="assets/mark.svg" width="72" height="72" alt="RTX HDR Guard mark">
</p>

<h1 align="center">RTX HDR Guard</h1>

<p align="center"><strong>A BetterDiscord plugin that keeps Discord's game overlay switched off so RTX HDR never drops.</strong></p>

<p align="center">
  Both of Discord's overlay implementations take the game's presented frame away from the driver.<br>
  There is no overlay mode that keeps RTX HDR alive — this plugin keeps the overlay off, and keeps it off.
</p>

<p align="center">
  <a href="https://github.com/SenjuWoo/rtxhdr-guard/actions/workflows/ci.yml"><img src="https://github.com/SenjuWoo/rtxhdr-guard/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ff3ea5?labelColor=0d0f11" alt="MIT License"></a>
  <a href="https://github.com/SenjuWoo/rtxhdr-guard/releases/latest"><img src="https://img.shields.io/badge/release-v1.1.0-8f9aa6?labelColor=0d0f11" alt="v1.1.0"></a>
  <img src="https://img.shields.io/badge/BetterDiscord-1.14%2B-5865f2?labelColor=0d0f11" alt="BetterDiscord 1.14+">
  <img src="https://img.shields.io/badge/platform-Windows-8f9aa6?labelColor=0d0f11" alt="Windows">
</p>

<p align="center">
  <a href="#the-problem">Problem</a>
  ·
  <a href="#evidence-from-a-real-session">Evidence</a>
  ·
  <a href="#what-the-plugin-does">What it does</a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#verify-it-worked">Verify</a>
  ·
  <a href="#honest-status">Status</a>
</p>

## The problem

RTX HDR is a driver-level SDR→HDR pass applied to the frame your game presents. Discord's overlay
takes that frame away from the driver, and HDR stays off — usually until the game is restarted.

Discord has two overlay implementations, and **both break it**:

| Implementation | What it does to the game |
|---|---|
| in-process **Hook** (`discord_hook`) | injects into the game and hooks `IDXGISwapChain::Present` |
| **out-of-process (V3)** window | a separate always-on-top window composites over the game |

`OverlayRenderStore` picks between them per fullscreen type: exclusive `FULLSCREEN` forces the Hook
(out-of-process is only allowed for `WINDOWED` / `MAXIMIZED` / `BORDERLESS_FULLSCREEN`), borderless
gets the OOP window. Either way a Discord surface ends up over the game.

## Evidence from a real session

From `%APPDATA%\discord\logs\renderer_js.log` and `discord_hook.log` on the machine this was
written for, 2026-10-19, Risk of Rain 2 (borderless — no `discord_hook` injection was logged at all):

```text
14:50:47  [RunningGameStore] Running Games Changed  → Risk of Rain 2 tracked
14:50:50  [PopoutWindowStore] Opening popout window  → OOP overlay appears
14:51:20  [OverlayV3Store] Focused new PID 10356     → overlay on the game, RTX HDR off
14:55:10  [OverlayRenderStore] handleOverlaySetEnabled → plugin applies
14:55:10  [PopoutWindowStore] Unmounting popout window DISCORD_OutOfProcessOverlay
14:55:28  same game session (52a93325…) continues — overlay never comes back
```

The overlay was the out-of-process window, not the hook, and it still killed HDR. The plugin did
remove the overlay at 14:55:10 — but the game kept the broken HDR state, because RTX HDR does not
re-engage until the game restarts.

## What the plugin does

It removes the variable instead of chasing it:

- forces both overlay switches in Discord's local `OverlayStore6` store to `false`
  (`legacyEnabled: false`, `oopEnabled: false`) — no hook, no overlay window;
- dispatches `OVERLAY_SET_ENABLED`, the action Discord's own overlay toggle fires, which persists
  the change and **retracks running games**;
- **reverts drift**: Discord's UI toggle sets both switches back to `true`, so the plugin subscribes
  to that action and re-applies itself. That was the real failure in the first test — the guard had
  applied at 02:50, something turned the overlay back on, and the plugin never noticed;
- restores your previous values when you disable the plugin (unless you changed them yourself).

Result:

| You want | Do this |
|---|---|
| RTX HDR stays on | leave the plugin enabled — Discord never draws over a game |
| Discord's overlay on top of the game | disable the plugin; RTX HDR will drop again when it appears |
| Both | not possible on one display. A window that doesn't overlap the game (second monitor) is the only way |

## Install

**Manual**

1. Download [`RTXHDRGuard.plugin.js`](https://github.com/SenjuWoo/rtxhdr-guard/releases/latest/download/RTXHDRGuard.plugin.js).
2. Drop it in `%APPDATA%\BetterDiscord\plugins\`.
3. `Ctrl+R` in Discord (or restart), then enable **RTX HDR Guard** in BetterDiscord → Plugins.

**From URL**

BetterDiscord → Plugins → *Install from URL* →
`https://raw.githubusercontent.com/SenjuWoo/rtxhdr-guard/main/RTXHDRGuard.plugin.js`

Requirements: Windows, Discord desktop (stable), BetterDiscord 1.14+. Nothing else — no Node
dependencies, no companion app.

## Verify it worked

Open BetterDiscord → Plugins → **RTX HDR Guard** → gear icon. Sample panel output:

```text
In-process hook: off · Out-of-process: off
Risk of Rain 2 [10356] — Disabled, legacy=false, oop=false
```

Green means both paths are off. `Hook` or `Out of Process` in the game line means Discord is still
drawing over that game — press **Apply now**, and restart the game if HDR is already broken.

Independent proof: `%APPDATA%\discord\logs\discord_hook.log` stops printing
`Starting graphics hook in process`, and no `Opening popout window … DISCORD_OutOfProcessOverlay`
appears while a game is focused.

## How it finds Discord's internals

Everything is looked up at runtime through BetterDiscord's webpack API, never by minified name:

| What | Lookup key |
|---|---|
| `OverlayStore6` | class with `update` + `serialize` + static `legacyEnabled` / `oopEnabled` |
| Dispatcher | exports `dispatch`, `subscribe`, `register` |
| `RunningGameStore` | `getRunningGames` + `getOverlayEnabledForGame` |
| `OverlayRenderStore` | `getGlobalEnabledStatus` + `getGameOverlayStatus` |
| `OverlayRenderUtils` | `gK` + `wR` (enum → label) |

If Discord moves any of these, the panel says **"Overlay settings store not found"** instead of
silently doing nothing, and the plugin logs it under `RTXHDRGuard` in the BetterDiscord console.

## Honest status

- **Verified against:** Discord `1.0.9262` (stable, Oct 2026) — the overlay decision logic, the
  `OverlayStore6` shape, the `OVERLAY_SET_ENABLED` handler and its live retrack path were read out
  of that build's bundle.
- **Tested:** `test/plugin.test.js` runs 9 assertions against mock modules built from the real
  bundle shapes — module discovery through nested exports, dispatch payload, idempotency, the
  boot-order race where Discord hasn't registered its handler yet, drift revert from inside the
  dispatch, restore-on-disable, panel rendering. CI runs it on every push.
- **Not tested:** a live Discord session inside CI (it needs a running client and a game). The
  panel and `discord_hook.log` are the verification surface for that.
- **Known limit:** the overlay is off. That is the point — there is no configuration that keeps both.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © [SenjuWoo](https://github.com/SenjuWoo). Not affiliated with Discord or NVIDIA.
