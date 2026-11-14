// Farming-account lifecycle.
//
// Owns the selfbot clients: logging them in, running the command loop,
// matching Dank Memer's replies back to the command that caused them, and
// restarting with backoff when a session dies.
const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');
const config = require('./config');
const store = require('./store');
const stats = require('./stats');
const parsing = require('./parsing');
const reader = require('./reader');

const DANK_MEMER_ID = reader.DANK_MEMER_ID;
const LOG_PATH = path.join(__dirname, 'sent_commands.log');

// token -> { client, channelId, timer, pending: Map<messageId, command> }
const accounts = new Map();
let stopping = false;

function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    console.log(message);
    try {
        fs.appendFileSync(LOG_PATH, line);
    } catch {
        // A read-only filesystem must not stop the bot.
    }
}

function maskToken(token) {
    return stats.maskToken(token);
}

function isReady(token) {
    const acct = accounts.get(token);
    return Boolean(acct && acct.client && acct.client.isReady());
}

function runningTokens() {
    return new Set([...accounts.keys()].filter(isReady));
}

// -- command loop -----------------------------------------------------------
function scheduleCycle(token, channelId, delay) {
    const acct = accounts.get(token);
    if (!acct || stopping) return;
    // Track the timer so stopClient can cancel it. The original never cleared
    // it, so a stopped account kept re-scheduling itself forever.
    acct.timer = setTimeout(() => runCycle(token, channelId).catch(err => log(`Cycle error (${maskToken(token)}): ${err.message}`)), delay);
}

async function runCycle(token, channelId) {
    const acct = accounts.get(token);
    if (!acct || stopping) return;
    const client = acct.client;
    if (!client.isReady()) return;

    for (const command of config.commands) {
        if (!client.isReady() || stopping) return;
        await sendCommand(token, channelId, command);
        await sleep(config.commandInterval);
    }
    scheduleCycle(token, channelId, config.cycleInterval);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendCommand(token, channelId, command) {
    const acct = accounts.get(token);
    if (!acct) return false;
    const client = acct.client;

    // Count the attempt before sending, so a network error still shows up as a
    // command rather than vanishing.
    stats.recordCommand(token);

    try {
        const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
        if (!channel) throw new Error('channel not found');
        const sent = await channel.send(command);
        if (sent && sent.id) {
            // Remember what each command was, so the reply can be classified.
            acct.pending.set(sent.id, command);
            // Bound the map so a reply that never arrives cannot leak memory.
            while (acct.pending.size > 8) {
                acct.pending.delete(acct.pending.keys().next().value);
            }
        }
        log(`[${maskToken(token)}] Sent command: ${command}`);
        return true;
    } catch (err) {
        // recordFailure creates the entry when missing; the original threw a
        // TypeError here for a token with no stats row and killed the handler.
        stats.recordFailure(token);
        log(`[${maskToken(token)}] Command failed: ${err.message}`);
        return false;
    }
}

// -- reply handling ---------------------------------------------------------
function classifyReply(command, text) {
    const cmd = String(command || '').toLowerCase();
    if (cmd.includes('hunt')) return 'hunt';
    if (cmd.includes('dig') || cmd.includes('search') || cmd.includes('fish')) return 'dig';
    if (cmd.includes('bal')) return 'balance';
    const t = String(text || '').toLowerCase();
    if (/wallet|bank|coins? you have/.test(t)) return 'balance';
    if (/caught|hunting/.test(t)) return 'hunt';
    if (/found|dug|digging/.test(t)) return 'dig';
    return 'other';
}

// True when a reply carries something worth recording: a balance, loot, or a
// refusal. Used only to decide whether an unreferenced message belongs to a
// pending command.
function isActionable(text) {
    return parsing.hasBalanceMarkers(text)
        || /caught|found|dug|hunting|digging/i.test(String(text || ''))
        || parsing.isFailure(text);
}

function bindMessageHandler(token, channelId, client) {
    client.on('messageCreate', async (message) => {
        try {
            if (!message || !message.channel) return;
            // Everything in the channel is described and logged, not only what
            // looks like a reply. When tracking reads nothing, this log is the
            // only way to see what actually arrived.
            if (String(message.channel.id) !== String(channelId)) return;
            if (!message.author || message.author.id === (client.user && client.user.id)) return;

            const acct = accounts.get(token);
            if (!acct) return;

            const snapshot = reader.describe(message);
            reader.record(snapshot);
            log(`[${acct.label}] <- ${reader.authorKind(message)} ref=${snapshot.reference || '-'} ${JSON.stringify(snapshot.text.slice(0, 300))}`);

            const hit = reader.attribute(acct, message);
            if (!hit) return;

            acct.pending.delete(hit.key);
            const kind = classifyReply(hit.command, snapshot.text);
            const before = stats.snapshot(token);
            stats.applyReply(token, kind, snapshot.text);
            const after = stats.snapshot(token);
            log(`[${acct.label}] matched "${hit.command}" via ${hit.reason} as ${kind}: ${describeDelta(before, after)}`);
            acct.lastActivity = Date.now();
        } catch (err) {
            // A handler error must never take the account down.
            log(`Reply handler error (${maskToken(token)}): ${err.message}`);
        }
    });
}

// A one-line summary of what a reply changed, so the log shows whether a read
// landed. Returns "no change" when the numbers were untouched.
function describeDelta(before, after) {
    const keys = ['coins', 'animals', 'items', 'catches', 'misses', 'failures'];
    const changed = keys.filter((k) => (before[k] || 0) !== (after[k] || 0))
        .map((k) => `${k} ${before[k] || 0}->${after[k] || 0}`);
    return changed.length ? changed.join(' ') : 'no change';
}

// -- diagnostics -------------------------------------------------------------
// The last N inbound messages, newest first, for the debug command.
function recentInbound(limit) {
    try {
        const raw = fs.readFileSync(reader.INBOUND_LOG, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

// What each account is waiting on and how long since it heard anything.
function accountStatus() {
    const out = [];
    for (const [token, acct] of accounts) {
        out.push({
            label: acct.label,
            ready: !!acct.ready,
            pending: acct.pending.size,
            idleMs: Date.now() - (acct.lastActivity || 0),
        });
    }
    return out;
}

// -- start / stop -----------------------------------------------------------
async function startClient(token, channelId) {
    if (accounts.has(token)) return false;
    if (!token || !channelId) return false;

    const client = new Client({ checkUpdate: false, readyStatus: false, syncStatus: false });
    const record = { client, channelId: String(channelId), timer: null, pending: new Map(), lastActivity: Date.now(), ready: false, label: maskToken(token) };
    accounts.set(token, record);

    bindMessageHandler(token, record.channelId, client);
    bindDropRecovery(token, client);

    client.on('ready', () => {
        record.ready = true;
        record.label = client.user ? (client.user.username || maskToken(token)) : maskToken(token);
        record.lastActivity = Date.now();
        log(`Logged in as ${client.user ? client.user.tag || client.user.username : 'unknown'} (${maskToken(token)})`);
        stats.ensure(token, client.user ? client.user.username : undefined);
        if (record.timer) clearTimeout(record.timer);
        scheduleCycle(token, record.channelId, 0);
    });

    client.on('error', (err) => {
        log(`Client error (${maskToken(token)}): ${err.message}`);
    });

    try {
        await client.login(token);
        return true;
    } catch (err) {
        log(`Login failed for ${maskToken(token)} — ${err.message}`);
        accounts.delete(token);
        try { client.destroy(); } catch { /* already gone */ }
        return false;
    }
}

async function stopClient(token) {
    const acct = accounts.get(token);
    if (!acct) return false;
    accounts.delete(token);
    if (acct.timer) clearTimeout(acct.timer);
    acct.pending.clear();
    try { acct.client.destroy(); } catch { /* already gone */ }
    log(`Stopped client for ${maskToken(token)}`);
    return true;
}

async function startAllClients(discordMessage) {
    const tokens = store.loadTokens().tokens;
    let started = 0;
    for (const entry of tokens) {
        if (!entry.active) continue;
        const ok = await startClient(entry.token, entry.channelId);
        if (ok) started++;
        else if (discordMessage) {
            await discordMessage.channel.send(`❌ Login failed for ${maskToken(entry.token)}`);
        }
    }
    return started;
}

async function stopAllClients() {
    let stopped = 0;
    for (const token of [...accounts.keys()]) {
        if (await stopClient(token)) stopped++;
    }
    return stopped;
}

// -- registry helpers -------------------------------------------------------
// Re-registers FARM_ACCOUNTS entries that are not on disk. Free hosts wipe the
// data directory, so without this the accounts vanish and nothing is farmed.
function seedFromEnv() {
    if (!config.farmAccounts.length) return 0;
    const data = store.loadTokens();
    const known = new Set(data.tokens.map(t => t.token));
    let added = 0;
    for (const item of config.farmAccounts) {
        const idx = item.indexOf(':');
        if (idx <= 0) {
            log('Ignoring malformed FARM_ACCOUNTS entry (expected token:channelId)');
            continue;
        }
        const token = item.slice(0, idx).trim();
        const channelId = item.slice(idx + 1).trim();
        if (!token || !/^\d+$/.test(channelId) || known.has(token)) continue;
        data.tokens.push({ token, channelId, active: true });
        known.add(token);
        added++;
    }
    if (added) {
        store.saveTokens(data);
        log(`Seeded ${added} account(s) from FARM_ACCOUNTS`);
    }
    return added;
}

function addToken(token, channelId) {
    const data = store.loadTokens();
    if (data.tokens.find(t => t.token === token)) return false;
    data.tokens.push({ token, channelId: String(channelId), active: false });
    return store.saveTokens(data);
}

async function removeToken(index) {
    const data = store.loadTokens();
    if (!Number.isInteger(index) || index < 0 || index >= data.tokens.length) return false;
    const { token } = data.tokens[index];
    await stopClient(token);
    data.tokens.splice(index, 1);
    if (!store.saveTokens(data)) return false;
    const s = store.loadStats();
    delete s.stats[token];
    store.saveStats(s);
    return true;
}

async function toggleToken(index) {
    const data = store.loadTokens();
    if (!Number.isInteger(index) || index < 0 || index >= data.tokens.length) return false;
    const entry = data.tokens[index];
    entry.active = !entry.active;
    // Persist first: if the login fails the account still ends up in the state
    // the user asked for, rather than a file that disagrees with memory.
    if (!store.saveTokens(data)) return false;
    if (entry.active) {
        const ok = await startClient(entry.token, entry.channelId);
        if (!ok) {
            entry.active = false;
            store.saveTokens(data);
            return { ok: false, active: false, error: 'login failed' };
        }
        return { ok: true, active: true };
    }
    await stopClient(entry.token);
    return { ok: true, active: false };
}

// Restart an account whose session died, with bounded retries.
async function handleDrop(token, attempt = 1) {
    if (stopping) return;
    const data = store.loadTokens();
    const entry = data.tokens.find(t => t.token === token);
    if (!entry || !entry.active) return;
    if (attempt > 3) {
        log(`Giving up on ${maskToken(token)} after ${attempt - 1} attempt(s)`);
        entry.active = false;
        store.saveTokens(data);
        return;
    }
    const delay = Math.min(300000, 5000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 3000);
    log(`Restarting ${maskToken(token)} in ${Math.round(delay / 1000)}s (attempt ${attempt})`);
    await sleep(delay);
    if (stopping) return;
    const ok = await startClient(token, entry.channelId);
    if (!ok) await handleDrop(token, attempt + 1);
}

function bindDropRecovery(token, client) {
    client.on('disconnect', () => {
        if (stopping || !accounts.has(token)) return;
        accounts.delete(token);
        handleDrop(token).catch(err => log(`Restart error (${maskToken(token)}): ${err.message}`));
    });
}

async function shutdown() {
    stopping = true;
    await stopAllClients();
}

module.exports = {
    startClient,
    stopClient,
    startAllClients,
    stopAllClients,
    addToken,
    removeToken,
    toggleToken,
    seedFromEnv,
    runningTokens,
    isReady,
    maskToken,
    shutdown,
    DANK_MEMER_ID,
    recentInbound,
    accountStatus,
    isActionable,
    _accounts: accounts,
    _bindDropRecovery: bindDropRecovery,
    _bindMessageHandler: bindMessageHandler,
};
