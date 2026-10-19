/**
 * @name RTXHDRGuard
 * @author SenjuWoo
 * @description Keeps Discord's overlay out of your game's swapchain so RTX HDR stays on. Forces the out-of-process overlay and turns off the in-process hook.
 * @version 1.0.0
 */

/*
 * WHY THIS EXISTS
 * RTX HDR is a driver-level SDR->HDR pass on the game's final presented frame. Discord's in-process
 * overlay (discord_hook -> DXGI Present hook) wraps that swapchain, so the driver stops converting
 * and the game goes flat until it restarts.
 *
 * Discord picks the method itself (OverlayRenderStore / OverlayRenderUtils, verified in the 1.0.9262
 * bundle): true exclusive FULLSCREEN can only be overlaid by the in-process hook, every other mode
 * (windowed / maximized / borderless) uses the out-of-process overlay window, which never touches the
 * game's swapchain. The two switches live in the local "OverlayStore6" store, and the
 * OVERLAY_SET_ENABLED action re-applies them to running games live.
 *
 * So: legacy hook off, out-of-process on. Exclusive fullscreen then gets no overlay at all (RTX HDR
 * safe), borderless gets the normal overlay without the hook.
 */

const NAME = "RTXHDRGuard";

module.exports = class RTXHDRGuard {
    constructor(meta) {
        this.meta = meta;
    }

    /* ---------- Discord internals (all looked up at runtime, all optional) ---------- */

    // OverlayStore6: the two global overlay switches. Static getters + update()/serialize() are unique to it.
    store() {
        return BdApi.Webpack.getModule(m => m
            && typeof m.update === "function"
            && typeof m.serialize === "function"
            && "legacyEnabled" in m
            && "oopEnabled" in m, { searchExports: true });
    }

    dispatcher() {
        return BdApi.Webpack.getByKeys("dispatch", "subscribe", "register", { searchExports: true });
    }

    // RunningGameStore: the games Discord currently sees.
    games() {
        const s = BdApi.Webpack.getModule(m =>
            typeof m?.getRunningGames === "function" && typeof m?.getOverlayEnabledForGame === "function",
            { searchExports: true });
        return s?.getRunningGames?.() ?? [];
    }

    // OverlayRenderStore: what Discord actually decided for each running game (and why).
    render() {
        return BdApi.Webpack.getModule(m =>
            typeof m?.getGlobalEnabledStatus === "function" && typeof m?.getGameOverlayStatus === "function",
            { searchExports: true });
    }

    // OverlayRenderUtils: turns the method/fullscreen enums into English.
    labels() {
        return BdApi.Webpack.getModule(m =>
            typeof m?.gK === "function" && typeof m?.wR === "function", { searchExports: true });
    }

    /* ---------- the fix ---------- */

    // Turns off the in-process hook and keeps the out-of-process overlay. Idempotent unless forced.
    apply(quiet = false, force = false) {
        const store = this.store();
        const dispatch = this.dispatcher();
        if (!store || !dispatch) {
            BdApi.Logger.error(NAME, "overlay settings store not found - Discord internals moved");
            return null;
        }

        const before = { legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled };
        if (!force && before.legacyEnabled === false && before.oopEnabled === true) {
            return { before, after: before, changed: false };
        }

        // Remember the user's own values so stop() can put them back. Only a non-guard state counts,
        // so a forced re-apply never overwrites the original with our own values.
        if (before.legacyEnabled !== false || before.oopEnabled !== true) {
            BdApi.Data?.setData?.(NAME, "previous", before);
        }

        // Persist first: this works even at boot, before Discord's overlay store has registered its
        // action handlers (it re-reads OverlayStore6 on CONNECTION_OPEN).
        store.update({ legacyEnabled: false, oopEnabled: true });

        // Then the same action Discord's own overlay toggle dispatches: retracks running games, so
        // it takes effect without restarting the game.
        dispatch.dispatch({ type: "OVERLAY_SET_ENABLED", legacyEnabled: false, oopEnabled: true });

        const after = { legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled };
        BdApi.Logger.info(NAME, "overlay guard applied", { before, after });

        if (!quiet) {
            const ok = after.legacyEnabled === false && after.oopEnabled === true;
            BdApi.UI.showToast(ok
                ? "RTX HDR guard: in-process overlay hook disabled"
                : "RTX HDR guard: Discord ignored the change", { type: ok ? "success" : "error" });
        }
        return { before, after, changed: true };
    }

    /* ---------- lifecycle ---------- */

    start() {
        this.apply();
    }

    // Put the user's overlay settings back if they are still the ones we set.
    stop() {
        const prev = BdApi.Data?.getData?.(NAME, "previous");
        const store = this.store();
        const dispatch = this.dispatcher();
        if (!prev || !store || !dispatch) return;
        if (store.legacyEnabled !== false || store.oopEnabled !== true) return;
        store.update({ legacyEnabled: prev.legacyEnabled, oopEnabled: prev.oopEnabled });
        dispatch.dispatch({ type: "OVERLAY_SET_ENABLED", legacyEnabled: prev.legacyEnabled, oopEnabled: prev.oopEnabled });
        BdApi.Logger.info(NAME, "overlay guard removed, settings restored", prev);
    }

    /* ---------- settings panel: live state, no guessing ---------- */

    getSettingsPanel() {
        const root = document.createElement("div");
        root.style.cssText = "padding:8px 0;font-size:14px;line-height:1.5;";

        const title = document.createElement("div");
        title.style.cssText = "font-weight:600;margin-bottom:6px;";
        title.textContent = "RTX HDR guard";

        const state = document.createElement("div");
        state.style.cssText = "font-weight:600;";

        const list = document.createElement("pre");
        list.style.cssText = "margin:8px 0;font-size:12px;white-space:pre-wrap;color:var(--text-muted,#999);font-family:var(--font-code,monospace);";

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px;color:var(--text-muted,#999);margin-bottom:10px;";
        note.textContent = "Exclusive fullscreen can't be overlaid out-of-process, so Discord drops the overlay there instead of hooking the game. Run games borderless to keep the overlay and RTX HDR together.";

        const button = document.createElement("button");
        button.textContent = "Apply now";
        button.style.cssText = "padding:6px 12px;border-radius:3px;border:none;background:var(--brand-experiment,#5865f2);color:#fff;cursor:pointer;font-size:13px;";
        button.onclick = () => { this.apply(false, true); render(); };

        const render = () => {
            const store = this.store();
            if (!store) {
                state.textContent = "Overlay settings store not found (Discord update?).";
                state.style.color = "var(--text-danger,#f23f43)";
                list.textContent = "";
                return;
            }
            const safe = store.legacyEnabled === false && store.oopEnabled === true;
            state.textContent = `In-process hook: ${store.legacyEnabled ? "ON (breaks RTX HDR)" : "off"} · Out-of-process: ${store.oopEnabled ? "on" : "OFF"}`;
            state.style.color = safe ? "var(--text-positive,#2dc770)" : "var(--text-danger,#f23f43)";

            const renderStore = this.render();
            const labels = this.labels();
            const games = this.games();
            list.textContent = games.length
                ? games.map(game => {
                    const status = renderStore?.getGameOverlayStatus?.(game);
                    const name = game.name ?? game.exePath?.split(/[\\/]/).pop() ?? `pid ${game.pid}`;
                    if (!status) return `${name} [${game.pid}] — not tracked`;
                    const method = labels ? labels.gK(status.overlayMethod) : status.overlayMethod;
                    return `${name} [${game.pid}] — ${method}, legacy=${status.enabledLegacy}, oop=${status.enabledOOP}`;
                }).join("\n")
                : "No game running.";
        };

        render();
        // Refresh while the panel is open, stop once BD closes the modal.
        const timer = setInterval(() => (root.isConnected ? render() : clearInterval(timer)), 2000);

        root.append(title, state, list, note, button);
        return root;
    }
};
