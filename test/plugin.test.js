/*
 * Behaviour checks for RTXHDRGuard 1.1.0.
 *
 * No Discord here, so BdApi is stubbed with module shapes taken from the real Discord 1.0.9262
 * bundle (OverlayStore6 class, Dispatcher, RunningGameStore, OverlayRenderStore,
 * OverlayRenderUtils) plus decoys that must not be picked. The plugin is loaded exactly as
 * BetterDiscord loads it and exercised end to end, including the re-entrant path where a foreign
 * OVERLAY_SET_ENABLED re-enables the overlay and the guard has to revert it from inside the
 * dispatch.
 *
 * Run: node test/plugin.test.js
 */

const assert = require("assert");
const path = require("path");

/* ---------- fake Discord modules ---------- */

// OverlayStore6: static getters + update/serialize, exactly like the real class.
class OverlayStore {
    static _loaded = null;
    constructor(legacyEnabled, oopEnabled) {
        this.legacyEnabled = legacyEnabled;
        this.oopEnabled = oopEnabled;
    }
    static get legacyEnabled() { return OverlayStore.load().legacyEnabled; }
    static get oopEnabled() { return OverlayStore.load().oopEnabled; }
    static update(patch) {
        const s = OverlayStore.load();
        if (typeof patch.legacyEnabled === "boolean") s.legacyEnabled = patch.legacyEnabled;
        if (typeof patch.oopEnabled === "boolean") s.oopEnabled = patch.oopEnabled;
        s.save();
    }
    save() { OverlayStore._loaded = this; }
    static load() {
        if (!OverlayStore._loaded) OverlayStore._loaded = new OverlayStore(true, true);
        return OverlayStore._loaded;
    }
    static serialize() { const s = OverlayStore.load(); return { legacyEnabled: s.legacyEnabled, oopEnabled: s.oopEnabled }; }
}

const actions = [];
const subscribers = [];
let handlersRegistered = true;
const dispatcher = {
    dispatch(action) {
        actions.push(action);
        if (handlersRegistered && action.type === "OVERLAY_SET_ENABLED") OverlayStore.update(action);
        for (const [type, cb] of subscribers.slice()) if (type === action.type) cb(action);
    },
    subscribe(type, cb) {
        subscribers.push([type, cb]);
        return () => {
            const i = subscribers.findIndex(([t, c]) => t === type && c === cb);
            if (i >= 0) subscribers.splice(i, 1);
        };
    },
    register() {},
};

const runningGames = [
    { pid: 4242, name: "PlateUp", exePath: "C:\\Games\\PlateUp\\PlateUp.exe", id: "1" },
];

const runningGameStore = {
    getRunningGames: () => runningGames,
    getOverlayEnabledForGame: () => true,
    getGameOverlayStatus: () => ({}),
};

const overlayRenderStore = {
    getGlobalEnabledStatus: () => ({ oopEnabled: OverlayStore.oopEnabled, legacyEnabled: OverlayStore.legacyEnabled }),
    getGameOverlayStatus: () => ({
        enabledOOP: OverlayStore.oopEnabled, enabledLegacy: OverlayStore.legacyEnabled, overlayMethod: 0,
        reason: "Fullscreen - legacyEnabled: false, newOverlayMethod: 0",
    }),
};

const overlayRenderUtils = {
    gK: (m) => ({ 0: "Disabled", 1: "Hook", 2: "Out of Process" }[m] ?? m),
    wR: (t) => ({ 4: "Fullscreen" }[t] ?? t),
};

// Decoys that must NOT be picked.
const decoys = [
    { update() {}, serialize() {}, legacyEnabled: true },          // no oopEnabled
    { getRunningGames() {} },                                       // not enough
    { getGlobalEnabledStatus() {} },                                // not enough
    { gK() {} },                                                    // not enough
];

// Real modules as webpack exports them: the overlay store is nested under a key, like {x: () => class}.
const modules = [
    { x: OverlayStore },
    runningGameStore,
    overlayRenderStore,
    overlayRenderUtils,
    ...decoys,
];

const toasts = [];
const data = {};

global.BdApi = {
    Webpack: {
        // Mirrors BD 1.14: test module.exports, then every nested export when searchExports is set.
        getModule(filter, opts = {}) {
            for (const mod of modules) {
                if (filter(mod, { exports: mod }, 1)) return mod;
                if (opts.searchExports) {
                    for (const key of Object.keys(mod)) {
                        const value = mod[key];
                        if (filter(value, { exports: mod }, 1)) return value;
                    }
                }
            }
            return undefined;
        },
        getByKeys(...keys) { return keys.includes("dispatch") ? dispatcher : undefined; },
    },
    Logger: { info() {}, error() {}, warn() {} },
    UI: { showToast: (text, opts) => toasts.push({ text, type: opts?.type }) },
    Data: {
        setData: (plugin, key, value) => { data[`${plugin}.${key}`] = value; },
        getData: (plugin, key) => data[`${plugin}.${key}`],
    },
};

// Minimal DOM for getSettingsPanel().
const makeEl = () => ({
    style: {}, textContent: "", onclick: null, isConnected: true,
    append(...kids) { this.kids = kids; },
});
global.document = { createElement: makeEl };
const realSetInterval = global.setInterval;
global.setInterval = () => 0;

/* ---------- load the plugin exactly as BetterDiscord does ---------- */

const Plugin = require(path.join(__dirname, "..", "RTXHDRGuard.plugin.js"));
const plugin = new Plugin({ name: "RTXHDRGuard", version: "1.1.0" });

/* ---------- assertions ---------- */

// 1. Lookups find the right modules (including the nested {x: class} export), not the decoys.
assert.strictEqual(plugin.store(), OverlayStore, "store lookup through nested export");
assert.strictEqual(plugin.games(), runningGames, "running games lookup");
assert.strictEqual(plugin.render(), overlayRenderStore, "render store lookup");
assert.strictEqual(plugin.labels(), overlayRenderUtils, "label utils lookup");

// 2. Boot-order race: Discord's overlay store hasn't registered OVERLAY_SET_ENABLED yet.
handlersRegistered = false;
plugin.start();
assert.strictEqual(OverlayStore.legacyEnabled, false, "persisted even with no handler");
assert.strictEqual(OverlayStore.oopEnabled, false, "oop persisted even with no handler");
handlersRegistered = true;
assert.strictEqual(subscribers.length, 1, "subscribed to OVERLAY_SET_ENABLED");

// 3. Normal apply switches both paths off with the real action name and payload.
OverlayStore.update({ legacyEnabled: true, oopEnabled: true });
actions.length = 0;
toasts.length = 0;
plugin.start();
assert.deepStrictEqual(actions, [{ type: "OVERLAY_SET_ENABLED", legacyEnabled: false, oopEnabled: false }], "dispatch payload");
assert.strictEqual(OverlayStore.legacyEnabled, false, "legacy off");
assert.strictEqual(OverlayStore.oopEnabled, false, "oop off");
assert.strictEqual(toasts.at(-1).type, "success", "success toast");

// 4. Idempotent: a second start must not dispatch or toast again.
const count = actions.length, toastCount = toasts.length;
plugin.start();
assert.strictEqual(actions.length, count, "no duplicate dispatch");
assert.strictEqual(toasts.length, toastCount, "no duplicate toast");

// 5. Drift: something re-enables the overlay (Discord's UI toggle) -> guard reverts it, from
//    inside the dispatch, without recursing forever.
dispatcher.dispatch({ type: "OVERLAY_SET_ENABLED", legacyEnabled: true, oopEnabled: true });
assert.strictEqual(OverlayStore.legacyEnabled, false, "drift reverted (legacy)");
assert.strictEqual(OverlayStore.oopEnabled, false, "drift reverted (oop)");
assert.strictEqual(actions.filter(a => a.legacyEnabled === false).length >= 2, true, "revert dispatched");

// 6. Forced apply (the panel's "Apply now") re-dispatches even when already safe.
const beforeForce = actions.length;
plugin.apply(false, true);
assert.strictEqual(actions.length, beforeForce + 1, "force dispatches");

// 7. stop() restores the user's original pair and unsubscribes.
plugin.stop();
assert.strictEqual(subscribers.length, 0, "unsubscribed");
assert.strictEqual(OverlayStore.legacyEnabled, true, "legacy restored");
assert.strictEqual(OverlayStore.oopEnabled, true, "oop restored");
const afterStop = actions.length;
dispatcher.dispatch({ type: "OVERLAY_SET_ENABLED", legacyEnabled: true, oopEnabled: true });
assert.strictEqual(actions.length, afterStop + 1, "no guard reaction after stop");

// 8. Panel builds and renders live state.
const panel = plugin.getSettingsPanel();
assert.strictEqual(panel.kids?.length, 5, "panel has title/state/list/note/button");
const [title, state, list] = panel.kids;
assert.strictEqual(title.textContent, "RTX HDR guard");
assert.ok(state.textContent.includes("ON (breaks RTX HDR)"), `state line: ${state.textContent}`);
assert.ok(list.textContent.includes("PlateUp [4242] — Disabled"), `games line: ${list.textContent}`);

// 9. Panel goes green once the guard is applied.
plugin.apply(true);
const panel2 = plugin.getSettingsPanel();
assert.ok(panel2.kids[1].textContent.includes("In-process hook: off"), `after apply: ${panel2.kids[1].textContent}`);
assert.ok(panel2.kids[1].textContent.includes("Out-of-process: off"), `after apply: ${panel2.kids[1].textContent}`);
assert.ok(panel2.kids[1].style.color.includes("text-positive"), "green when safe");

global.setInterval = realSetInterval;
console.log("all checks passed");
