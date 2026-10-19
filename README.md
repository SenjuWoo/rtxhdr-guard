<p align="center">
  <img src="assets/mark.svg" width="72" height="72" alt="RTX HDR Guard mark">
</p>

<h1 align="center">RTX HDR Guard</h1>

<p align="center"><strong>A BetterDiscord plugin that stops Discord's overlay from killing RTX HDR.</strong></p>

<p align="center">
  Discord's in-process overlay hooks your game's DXGI swapchain.<br>
  RTX HDR converts that same frame. Only one of them wins.
</p>

<p align="center">
  <a href="https://github.com/SenjuWoo/rtxhdr-guard/actions/workflows/ci.yml"><img src="https://github.com/SenjuWoo/rtxhdr-guard/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ff3ea5?labelColor=0d0f11" alt="MIT License"></a>
  <a href="https://github.com/SenjuWoo/rtxhdr-guard/releases/tag/v1.0.0"><img src="https://img.shields.io/badge/release-v1.0.0-8f9aa6?labelColor=0d0f11" alt="v1.0.0"></a>
  <img src="https://img.shields.io/badge/BetterDiscord-1.14%2B-5865f2?labelColor=0d0f11" alt="BetterDiscord 1.14+">
  <img src="https://img.shields.io/badge/platform-Windows-8f9aa6?labelColor=0d0f11" alt="Windows">
</p>

<p align="center">
  <a href="#the-problem">Problem</a>
  ·
  <a href="#what-discord-actually-allows">The wall</a>
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

RTX HDR is a driver-level SDR→HDR pass applied to the frame your game presents. Discord's
**in-process** overlay (`discord_hook`) injects into the game and hooks `IDXGISwapChain::Present`,
so the driver stops converting and the image goes flat — usually until the game is restarted.

Straight from `%APPDATA%\discord\logs\discord_hook.log`:

```text
Starting graphics hook in process ...\PlateUp.exe
Hooked DXGI
Hooked OpenGL
Color space tracked at CDXGISwapChain+168
```

A webcam tile, a notification, the overlay drawing anything at all — that's enough to flip RTX HDR
off mid-session.

## What Discord actually allows

Discord has two overlay implementations: the in-process **Hook** and an **out-of-process (V3)**
window that never touches the game's swapchain. `OverlayRenderStore` picks between them per
fullscreen type (read out of the Discord 1.0.9262 bundle):

| Game window | Overlay method | Hooks the game? |
|---|---|---|
| `FULLSCREEN` (exclusive) | in-process Hook only | yes → kills RTX HDR |
| `BORDERLESS_FULLSCREEN` | out-of-process window | no |
| `WINDOWED` / `MAXIMIZED` | out-of-process window | no |
| `UNKNOWN` / `MINIMIZED` | overlay disabled | — |

The fullscreen branch of the method decider is literally:

```js
case aI.FULLSCREEN: {
  let e = (0, N.O4)(n), t = e.enabledLegacy && b;
  return { ...e, overlayMethod: t ? e.overlayMethod : m.Ue.Disabled };
}
```

There is no out-of-process option for exclusive fullscreen. That's the wall: **you cannot have the
overlay over exclusive fullscreen without the hook**, and the hook is what breaks RTX HDR.

## What the plugin does

It removes the hook from the equation instead of fighting it:

- forces the two global overlay switches in Discord's local `OverlayStore6` store —
  `legacyEnabled: false`, `oopEnabled: true`;
- dispatches `OVERLAY_SET_ENABLED`, the same action Discord's own overlay toggle fires, which
  persists the change and **retracks running games** so it applies without a game restart;
- re-applies at every Discord start, before any game is tracked;
- restores your previous values when you disable the plugin (unless you changed them yourself in
  the meantime);
- exposes a settings panel with the live state and what Discord actually decided per running game.

Result:

| You run the game | Overlay | RTX HDR |
|---|---|---|
| Exclusive fullscreen | not shown (Discord disables it there) | **stays on** |
| Borderless fullscreen / windowed | normal overlay, out-of-process | stays on, swapchain untouched |

If you want the webcam overlay *and* HDR at the same time, play borderless. That is the only
combination Discord supports.

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
In-process hook: off · Out-of-process: on
PlateUp [4242] — Out of Process, legacy=false, oop=true
```

`Hook` there means the game is still being injected — press **Apply now**, or restart the game.
Independent proof: `%APPDATA%\discord\logs\discord_hook.log` should stop printing
`Starting graphics hook in process` for that game.

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
  boot-order race where Discord hasn't registered its handler yet, restore-on-disable, panel
  rendering. CI runs it on every push.
- **Not tested:** a live Discord session inside this repo's CI (it needs a running Discord client
  and a game). The panel and `discord_hook.log` are the verification surface for that.
- **Known limit:** exclusive fullscreen loses the overlay entirely. That is Discord's design, not a
  bug here.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © [SenjuWoo](https://github.com/SenjuWoo). Not affiliated with Discord or NVIDIA.
