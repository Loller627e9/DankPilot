// Animated-emoji lookup.
//
// Falls back to plain unicode emojis when storage/emojis.json is missing, so a
// fresh clone (or a wiped data directory) still renders a readable embed
// instead of literal ":name:" placeholders.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const FALLBACK = {
    dk_coin: '💰',
    dk_sparkle: '✨',
    dk_paw: '🐾',
    dk_gift: '🎁',
    dk_cmds: '⚡',
    dk_fail: '❌',
    dk_on: '🟢',
    dk_off: '⚫',
    dk_farm: '🚜',
};

const MAP_PATH = path.join(store.DATA_DIR, 'emojis.json');

function load() {
    const data = store.readJson(MAP_PATH, null);
    if (!data || typeof data !== 'object') return {};
    return data;
}

const custom = load();

// `has_any` lets callers tell "no custom emojis uploaded" from "uploaded".
function hasAny() {
    return Object.keys(custom).length > 0;
}

// The proxy only supplies emoji names. Anything already on the target (the
// helpers below) is returned as-is, otherwise the get trap would shadow them
// with an empty string.
const base = { hasAny, MAP_PATH, FALLBACK };
const E = new Proxy(base, {
    get: (target, key) => {
        if (key in target) return target[key];
        return custom[key] || FALLBACK[key] || '';
    },
});

module.exports = E;
