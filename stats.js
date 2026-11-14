// Stats accounting.
//
// Kept separate from the Discord clients so the numbers can be tested without a
// gateway connection.
//
// Two bugs from the original are fixed here:
//   1. It read the whole stats file, then awaited Discord network calls, then
//      wrote the stale copy back — so concurrent replies clobbered each other
//      and counts went backwards. Every mutation here is read-modify-write in
//      one synchronous step.
//   2. `stats.stats[token].failures++` was not guarded. When a send failed for
//      a token with no stats entry yet, that threw a TypeError inside a catch
//      block, which crashed the account's whole message handler.
const store = require('./store');
const parsing = require('./parsing');

function ensure(token, username) {
    const data = store.loadStats();
    const existing = data.stats[token];
    if (!existing) {
        data.stats[token] = store.blankStats(username || maskToken(token));
        store.saveStats(data);
        return data.stats[token];
    }
    if (username && existing.name !== username) {
        existing.name = username;
        store.saveStats(data);
    }
    return existing;
}

function maskToken(token) {
    if (!token) return 'unknown';
    const s = String(token);
    if (s.length <= 8) return '***';
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function recordCommand(token) {
    const data = store.loadStats();
    const entry = data.stats[token];
    if (!entry) return;
    entry.commands = (entry.commands || 0) + 1;
    store.saveStats(data);
}

function recordFailure(token) {
    const data = store.loadStats();
    // Create the entry rather than dereferencing undefined: a failed send for a
    // brand-new account used to throw here and take the handler down with it.
    if (!data.stats[token]) data.stats[token] = store.blankStats(maskToken(token));
    data.stats[token].failures = (data.stats[token].failures || 0) + 1;
    store.saveStats(data);
}

// A read-only copy of one account's counters, for before/after logging.
function snapshot(token) {
    const entry = store.loadStats().stats[token];
    return entry ? Object.assign({}, entry) : {};
}

// Folds one Dank Memer reply into the token's totals. `kind` is 'hunt'/'dig'
// when the command is known, otherwise the reply wording decides.
function applyReply(token, kind, content) {
    const data = store.loadStats();
    if (!data.stats[token]) {
        data.stats[token] = store.blankStats(maskToken(token));
    }
    const entry = data.stats[token];

    // A cooldown / refusal is not a result: count it as a failure and change
    // nothing else, so error text cannot inflate the numbers. A hunt/dig miss
    // is checked first, because "nothing" wording can also look like a refusal.
    const lootKind = kind === 'hunt' || kind === 'dig';
    const missed = lootKind && parsing.isMiss(content);
    if (!missed && parsing.isFailure(content)) {
        entry.failures = (entry.failures || 0) + 1;
        store.saveStats(data);
        return entry;
    }

    if (parsing.hasBalanceMarkers(content)) {
        const { wallet, bank, extras } = parsing.parseBalance(content);
        const total = wallet + bank;
        if (extras && Object.keys(extras).length) {
            entry.extras = Object.assign({}, entry.extras, extras);
        }
        if (total > (entry.lastTotal || 0)) {
            // High-water mark: coins earned is the highest balance ever seen. It
            // only rises, so spending cannot make a later rise re-count coins
            // that were already tallied.
            entry.coins = (entry.coins || 0) + (total - (entry.lastTotal || 0));
            entry.lastTotal = total;
        } else if (total > 0) {
            // Keep the mark in step even when the balance fell.
            entry.lastTotal = Math.max(entry.lastTotal || 0, total);
        }
    }

    if (kind === 'hunt' || kind === 'dig') {
        const loot = parsing.parseLoot(content, kind);
        // "You found nothing while digging" is an outcome, not an error: it is
        // the only way to count attempts that caught nothing.
        if (loot.missed) {
            entry.misses = (entry.misses || 0) + 1;
        } else if (kind === 'hunt') {
            entry.animals = (entry.animals || 0) + loot.animals.length;
            entry.catches = (entry.catches || 0) + loot.animals.length;
        } else {
            entry.items = (entry.items || 0) + loot.items.length;
            entry.catches = (entry.catches || 0) + loot.items.length;
        }
    }

    store.saveStats(data);
    return entry;
}

function resetStats() {
    const tokens = store.loadTokens();
    const stats = { stats: {} };
    for (const t of tokens.tokens) {
        stats.stats[t.token] = store.blankStats(maskToken(t.token));
    }
    return store.saveStats(stats);
}

function exportStats() {
    const fs = require('fs');
    const path = require('path');
    const stats = store.loadStats();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(store.DATA_DIR, `stats_export_${stamp}.json`);
    try {
        fs.mkdirSync(store.DATA_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(stats, null, 2));
        return file;
    } catch {
        return null;
    }
}

function getAllStats() {
    return store.loadStats();
}

module.exports = {
    ensure,
    recordCommand,
    recordFailure,
    applyReply,
    snapshot,
    resetStats,
    exportStats,
    getAllStats,
    maskToken,
};
