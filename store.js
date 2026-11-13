// Tiny JSON persistence layer. Writes are atomic (temp file + rename) so a
// crash mid-write can never leave a half-written, unparseable data file.
const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return typeof fallback === 'function' ? fallback() : fallback;
    }
}

function writeJSON(file, data) {
    ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function initStorage() {
    ensureDir(config.dataDir);
    if (!fs.existsSync(config.tokensPath)) writeJSON(config.tokensPath, { tokens: [] });
    if (!fs.existsSync(config.statsPath)) writeJSON(config.statsPath, { stats: {} });
    if (!fs.existsSync(config.accessPath)) writeJSON(config.accessPath, { ownerId: config.ownerId, authorizedUsers: [] });
}

module.exports = { ensureDir, readJSON, writeJSON, initStorage };
