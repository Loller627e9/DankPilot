// Custom emoji lookup with a unicode fallback.
//
// Custom emoji strings are only valid in the server/context where they were
// uploaded, so the raw string is only handed out when the caller says it is in
// that context (inGuild = true). Everywhere else the plain unicode fallback is
// used, which means embeds never render a broken ":name:" placeholder.
const fs = require('fs');
const config = require('./config');

const FALLBACK = {
    dk_coin: '💰',
    dk_sparkle: '✨',
    dk_paw: '🐾',
    dk_gift: '🎁',
    dk_cmds: '⚡',
    dk_fail: '❌',
    dk_on: '🟢',
    dk_off: '⚫',
    dk_farm: '🚜'
};

function load() {
    try {
        const data = JSON.parse(fs.readFileSync(config.emojisPath, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

let custom = load();

function reload() {
    custom = load();
}

function get(name, inGuild = true) {
    if (inGuild && custom[name]) return custom[name];
    return FALLBACK[name] || '';
}

function unicode(name) {
    return FALLBACK[name] || '';
}

function hasCustom(name) {
    return Boolean(custom[name]);
}

module.exports = { get, unicode, hasCustom, reload, FALLBACK };
