// Shared test helpers.
//
// Tests point DATA_DIR at a throwaway directory *before* requiring any project
// module, so config/store resolve their paths inside it and the real storage
// files are never touched.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDataDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dankfarm-test-'));
    process.env.DATA_DIR = dir;
    return dir;
}

// Clears the module cache so each test re-reads config with the new DATA_DIR.
function resetModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}node_modules${path.sep}`)) continue;
        delete require.cache[key];
    }
}

function load() {
    resetModules();
    return {
        config: require('../config'),
        store: require('../store'),
        stats: require('../stats'),
        parsing: require('../parsing'),
        ui: require('../ui'),
        emojis: require('../emojis'),
        grinder: require('../grinder'),
        handlers: require('../handlers'),
    };
}

module.exports = { freshDataDir, resetModules, load };
