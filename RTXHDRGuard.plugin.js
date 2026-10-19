/**
 * @name RTXHDRGuard
 * @author SenjuWoo
 * @description Keeps Discord's game overlay switched off so RTX HDR never drops. Re-applies itself when Discord or the overlay toggle turns it back on.
 * @version 1.1.0
 */

/*
 * WHY THIS EXISTS
 * RTX HDR is a driver-level SDR->HDR pass on the frame the game presents. Discord's overlay takes
 * that frame away from the driver, and HDR stays off until the game restarts.
 *
 * Both overlay implementations break it:
 *   - in-process Hook -> discord_hook injects into the game and hooks IDXGISwapChain::Present
 *   - out-of-process  -> a separate always-on-top window composites over the game
 * Evidence from this machine, 2026-10-19: at 14:50:50 the OOP overlay window opened over Risk of
 * Rain 2 with no discord_hook injection logged at all, and RTX HDR died. At 14:55:10 this plugin
 * applied and Discord unmounted the overlay window - but the game kept the broken HDR state,
 * because RTX HDR does not re-engage until the game restarts.
 *
 * There is no overlay mode that keeps HDR alive: exclusive fullscreen forces the Hook
 * (OverlayRenderUtils only allows OOP for windowed/borderless), borderless uses the OOP window.
 * Either way a Discord surface ends up over the game.
 *
 * So the plugin does the only thing that works: keeps the overlay off, and keeps it off when
 * Discord or the user turns it back on.
 */

const NAME = "RTXHDRGuard";
const SAFE = { legacyEnabled: false, oopEnabled: false };

module.exports = class RTXHDRGuard {
    constructor(meta) {
        this.meta = meta;
        this.applying = false;      // guards the dispatch -> subscriber -> dispatch loop
        this.lastRevert = 0;
        this.lastToast = 0;
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

    isSafe(state) {
        return state.legacyEnabled === false && state.oopEnabled === false;
    }

    // Switches both overlay paths off. Idempotent unless forced.
    apply(quiet = false, force = false) {
        const store = this.store();
        const dispatch = this.dispatcher();
        if (!store || !dispatch) {
            BdApi.Logger.error(NAME, "overlay settings store not found - Discord internals moved");
            return null;
        }

        const before = { legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled };
        if (!force && this.isSafe(before)) return { before, after: before, changed: false };

        // Remember the user's own values so stop() can put them back. Only a non-guard state counts,
        // so a forced re-apply never overwrites the original with our own values.
        if (!this.isSafe(before)) BdApi.Data?.setData?.(NAME, "previous", before);

        this.applying = true;
        try {
            // Persist first: works even at boot, before Discord's overlay store has registered its
            // action handlers (it re-reads OverlayStore6 on CONNECTION_OPEN).
            store.update(SAFE);
            // Then the action Discord's own overlay toggle dispatches: retracks running games, so it
            // takes effect without restarting Discord.
            dispatch.dispatch({ type: "OVERLAY_SET_ENABLED", ...SAFE });
        } finally {
            this.applying = false;
        }

        const after = { legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled };
        BdApi.Logger.info(NAME, "overlay guard applied", { before, after });

        if (!quiet) {
            BdApi.UI.showToast(this.isSafe(after)
                ? "RTX HDR guard: Discord overlay switched off"
                : "RTX HDR guard: Discord ignored the change", { type: this.isSafe(after) ? "success" : "error" });
        }
        return { before, after, changed: true };
    }

    // Discord's own overlay toggle sets both switches to true. Anything that re-enables the overlay
    // gets reverted, otherwise the guard would only last until the next toggle.
    onOverlayChanged(action) {
        if (this.applying) return;
        if (!action || (action.legacyEnabled === false && action.oopEnabled === false)) return;
        if (Date.now() - this.lastRevert < 1000) return;

        this.lastRevert = Date.now();
        BdApi.Logger.info(NAME, "overlay re-enabled elsewhere, re-applying guard", action);
        this.apply(true, true);

        if (Date.now() - this.lastToast > 60000) {
            this.lastToast = Date.now();
            BdApi.UI.showToast("Discord overlay turned back on - RTX HDR Guard switched it off again", { type: "warning" });
        }
    }

    /* ---------- lifecycle ---------- */

    start() {
        this.apply();
        this.unsub?.();             // a second start (plugin reload) must not stack subscriptions
        this.unsub = this.dispatcher()?.subscribe?.("OVERLAY_SET_ENABLED", action => this.onOverlayChanged(action));
    }

    // Put the user's overlay settings back if they are still the ones we set.
    stop() {
        this.unsub?.();
        this.unsub = null;

        const prev = BdApi.Data?.getData?.(NAME, "previous");
        const store = this.store();
        const dispatch = this.dispatcher();
        if (!prev || !store || !dispatch) return;
        if (!this.isSafe({ legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled })) return;

        this.applying = true;
        try {
            store.update(prev);
            dispatch.dispatch({ type: "OVERLAY_SET_ENABLED", ...prev });
        } finally {
            this.applying = false;
        }
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
        note.textContent = "Discord's overlay and RTX HDR can't run together: the in-process hook owns the swapchain in exclusive fullscreen, and the out-of-process window composites over the game in borderless. Both drop HDR until the game restarts. This plugin keeps the overlay off. Want the overlay instead? Disable the plugin.";

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
            const safe = this.isSafe({ legacyEnabled: store.legacyEnabled, oopEnabled: store.oopEnabled });
            state.textContent = `In-process hook: ${store.legacyEnabled ? "ON (breaks RTX HDR)" : "off"} · Out-of-process: ${store.oopEnabled ? "ON (breaks RTX HDR)" : "off"}`;
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
