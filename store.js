// JSON persistence with atomic writes.
//
// The original bot used fs.writeFileSync directly, so a crash mid-write could
// leave a truncated file that failed to parse forever after. Writes here go to
// a temp file and are then renamed into place, which is atomic on every
// platform we target.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = config.dataDirPath;
const TOKENS_PATH = path.join(DATA_DIR, 'tokens.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const ACCESS_PATH = path.join(DATA_DIR, 'access.json');

function ensureDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        return true;
    } catch {
        return false;
    }
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    if (!ensureDir()) return false;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
        return true;
    } catch {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        return false;
    }
}

function blankStats(name) {
    return {
        name,
        commands: 0,
        coins: 0,
        lastTotal: 0,
        catches: 0,
        items: 0,
        animals: 0,
        failures: 0,
    };
}

// -- tokens -----------------------------------------------------------------
function loadTokens() {
    const data = readJson(TOKENS_PATH, { tokens: [] });
    if (!data || !Array.isArray(data.tokens)) return { tokens: [] };
    return data;
}

function saveTokens(data) {
    return writeJson(TOKENS_PATH, data);
}

// -- stats ------------------------------------------------------------------
function loadStats() {
    const data = readJson(STATS_PATH, { stats: {} });
    if (!data || typeof data.stats !== 'object' || data.stats === null) return { stats: {} };
    return data;
}

function saveStats(data) {
    return writeJson(STATS_PATH, data);
}

// -- access -----------------------------------------------------------------
function loadAccess() {
    const data = readJson(ACCESS_PATH, null);
    const ownerId = (data && data.ownerId) || config.ownerId || '';
    const users = data && Array.isArray(data.authorizedUsers) ? data.authorizedUsers : [];
    // Normalise to strings: ids arrive as strings from chat input, and a mixed
    // number/string list is what made grants silently fail to match before.
    return { ownerId: String(ownerId), authorizedUsers: users.map(String) };
}

function saveAccess(data) {
    return writeJson(ACCESS_PATH, data);
}

module.exports = {
    DATA_DIR,
    TOKENS_PATH,
    STATS_PATH,
    ACCESS_PATH,
    ensureDir,
    readJson,
    writeJson,
    blankStats,
    loadTokens,
    saveTokens,
    loadStats,
    saveStats,
    loadAccess,
    saveAccess,
};
