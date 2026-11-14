const { Client } = require('discord.js-selfbot-v13');
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');

const LOG_PATH = path.join(config.dataDir, 'sent_commands.log');
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const DANK_MEMER_ID = '270904126974590976';
const DEBUG_STATS = process.env.DEBUG_STATS === 'true';

const activeClients = new Map(); // token -> selfbot client
const loginLocks = new Set();    // tokens currently logging in
const restartLocks = new Set();  // tokens currently being restarted
const restartAttempts = new Map(); // token -> consecutive restart count
let watchdogTimer = null;

const sleep = ms => new Promise(res => setTimeout(res, ms));

// Spread a fixed interval by a random amount so the cadence is not perfectly
// regular (a regular cadence is both a bot signal and easy to rate-limit).
function jittered(base, spread) {
    const extra = spread > 0 ? Math.floor(Math.random() * spread) : 0;
    return base + extra;
}

// Exponential backoff with a small jitter, capped so a permanently dead token
// does not retry forever at a high rate.
function backoffDelay(attempt) {
    const base = Math.min(config.maxBackoff, 5000 * 2 ** Math.max(0, attempt - 1));
    return base + Math.floor(Math.random() * 3000);
}

function logToFile(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        // Keep the file bounded on hosts with a small disk quota.
        if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) {
            fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
        }
        fs.appendFileSync(LOG_PATH, line);
    } catch {
        // Logging must never take the bot down.
    }
    console.log(message);
}

function maskToken(token) {
    if (!token) return 'INVALID_TOKEN';
    if (token.length <= 10) return '***';
    return token.slice(0, 4) + '...' + token.slice(-4);
}

function loadTokens() {
    return store.readJSON(config.tokensPath, { tokens: [] });
}

function loadStats() {
    return store.readJSON(config.statsPath, { stats: {} });
}

function saveStats(stats) {
    store.writeJSON(config.statsPath, stats);
}

function blankStats(name) {
    return {
        name: name || '',
        commands: 0,
        coins: 0,
        lastTotal: 0,
        catches: 0,
        items: 0,
        animals: 0,
        failures: 0
    };
}

// Coin/bank totals. Dank Memer has changed this format over time, so several
// shapes are accepted: "Wallet: 1,234", "1,234 wallet", and the legacy
// "<:Coin:1> 1,234 <:Bank:2> 5,678".
function parseNumber(raw) {
    if (raw == null) return 0;
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

function findLabelAmount(text, labels) {
    for (const label of labels) {
        // "Wallet: 1,234" - the label must not be part of an emoji (<:Name:id>).
        const after = new RegExp(`(?<!<:)${label}\\s*[:\\-]?\\s*\\**\\s*([\\d,]+)`, 'i');
        const a = text.match(after);
        if (a) return parseNumber(a[1]);
        // "1,234 wallet"
        const before = new RegExp(`([\\d,]+)\\s*\\**\\s*${label}`, 'i');
        const b = text.match(before);
        if (b) return parseNumber(b[1]);
    }
    return 0;
}

function findEmojiAmount(text, names) {
    for (const name of names) {
        const re = new RegExp(`<a?:${name}:\\d+>\\s*\\**\\s*([\\d,]+)`, 'i');
        const m = text.match(re);
        if (m) return parseNumber(m[1]);
    }
    return 0;
}

function parseCoins(content) {
    const text = String(content || '');
    const wallet = findLabelAmount(text, ['wallet', 'cash', 'purse']) || findEmojiAmount(text, ['coin', 'coins', 'cash', 'wallet']);
    const bank = findLabelAmount(text, ['bank']) || findEmojiAmount(text, ['bank']);
    return { wallet, bank };
}

// Loot lines look like "**12 <:Rabbit:123> Rabbit**" or "**12 Rabbit**".
function parseLoot(content) {
    const result = { animals: [], items: [] };
    const text = String(content || '');
    const isAnimal = /caught|hunting|hunt/i.test(text);
    const regex = /\*\*\s*\d+\s+(?:<a?:[A-Za-z0-9_]+:\d+>\s*)?([^*\n]+?)\s*\*\*/g;
    for (const match of text.matchAll(regex)) {
        const name = match[1].replace(/\s+/g, ' ').trim();
        if (!name) continue;
        (isAnimal ? result.animals : result.items).push(name);
    }
    return result;
}

// Which command a Dank Memer reply belongs to. Prefer the reply link to the
// message we sent, then fall back to the response text.
function classifyReply(command, content) {
    const c = String(command || '').toLowerCase();
    if (c.includes('bal')) return 'balance';
    if (c.includes('hunt')) return 'hunt';
    if (c.includes('dig') || c.includes('search') || c.includes('fish')) return 'dig';
    const t = String(content || '').toLowerCase();
    if (/wallet|bank|cash|coins? you have/.test(t)) return 'balance';
    if (/caught|hunting/.test(t)) return 'hunt';
    if (/found|dug|digging/.test(t)) return 'dig';
    return 'other';
}

function applyStats(token, kind, content) {
    const stats = loadStats();
    const entry = stats.stats[token];
    if (!entry) return;

    if (kind === 'balance') {
        const { wallet, bank } = parseCoins(content);
        const total = wallet + bank;
        // Track the high-water mark so a spend/drop does not reduce earnings.
        if (total > (entry.lastTotal || 0)) entry.coins += total - entry.lastTotal;
        if (total > 0) entry.lastTotal = total;
    } else if (kind === 'hunt') {
        const { animals } = parseLoot(content);
        entry.animals += animals.length;
        entry.catches += animals.length;
    } else if (kind === 'dig') {
        const { items } = parseLoot(content);
        entry.items += items.length;
        entry.catches += items.length;
    }

    saveStats(stats);
    if (DEBUG_STATS) {
        logToFile(`[stats] ${maskToken(token)} ${kind}: ${JSON.stringify({ coins: entry.coins, animals: entry.animals, items: entry.items })}`);
    }
}

function initializeStats(token, username) {
    const stats = loadStats();
    const existing = stats.stats[token];
    if (!existing) {
        stats.stats[token] = blankStats(username || maskToken(token));
        saveStats(stats);
    } else if (username && existing.name !== username) {
        existing.name = username;
        saveStats(stats);
    }
}

async function sendCommand(client, channelId, command) {
    const token = client._farmToken;
    const stats = loadStats();
    const entry = stats.stats[token];
    if (entry) {
        entry.commands++;
        saveStats(stats);
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error('Channel not found');
        const sent = await channel.send(command);
        client._lastSent = { id: sent.id, command, at: Date.now() };
        logToFile(`[${maskToken(token)}] Sent command: ${command}`);
        return true;
    } catch (err) {
        logToFile(`[${maskToken(token)}] Command failed: ${err.message}`);
        const s = loadStats();
        const e = s.stats[token];
        if (e) {
            e.failures++;
            saveStats(s);
        }
        return false;
    }
}

async function runCommandCycle(client, channelId) {
    const token = client._farmToken;

    // A stopped client must not keep running; a not-yet-ready client is fine,
    // it simply skips this cycle and is rescheduled below.
    if (!activeClients.has(token)) return;
    client._lastCycleAt = Date.now();

    if (client.isReady()) {
        for (const cmd of config.farmCommands) {
            if (!activeClients.has(token)) return;
            if (!client.isReady()) break;
            await sendCommand(client, channelId, cmd);
            await sleep(jittered(config.commandInterval, config.commandJitter));
        }
        client._lastCycleAt = Date.now();
    }

    // Always reschedule while the account is meant to be running. Previously a
    // single disconnect mid-cycle returned early and never set the next timer,
    // so farming stopped for good while the UI still showed the account online.
    if (activeClients.has(token)) {
        clearCycleTimer(client);
        client._cycleTimer = setTimeout(() => {
            runCommandCycle(client, channelId).catch(err =>
                logToFile(`Cycle error (${maskToken(token)}): ${err.message}`)
            );
        }, jittered(config.cycleInterval, config.cycleJitter));
    }
}

function clearCycleTimer(client) {
    if (client._cycleTimer) {
        clearTimeout(client._cycleTimer);
        client._cycleTimer = null;
    }
}

function setActiveFlag(token, active) {
    const tokensData = loadTokens();
    const entry = tokensData.tokens.find(t => t.token === token);
    if (!entry || entry.active === active) return;
    entry.active = active;
    store.writeJSON(config.tokensPath, tokensData);
}

// Returns { ok, status } where status is 'started' | 'already' | 'in_progress' | 'failed'.
async function startClient(token, channelId) {
    if (activeClients.has(token)) return { ok: true, status: 'already' };
    if (loginLocks.has(token)) return { ok: false, status: 'in_progress' };

    loginLocks.add(token);
    const client = new Client({
        checkUpdate: false,
        readyStatus: false,
        syncStatus: false,
        // The library pins an outdated Discord client identity; IDENTIFY spreads
        // options.ws straight into the payload, so override the stale fields.
        ws: {
            properties: {
                client_build_number: config.clientBuildNumber,
                client_version: config.clientVersion
            }
        }
    });
    client._farmToken = token;
    client._reconnecting = false;
    client._lastCycleAt = 0;

    client.on('ready', () => {
        logToFile(`Logged in as ${client.user.tag} (${maskToken(token)})`);
        initializeStats(token, client.user.username);
        restartAttempts.delete(token);
        client._reconnecting = false;
        // 'ready' can fire again after a reconnect; drop any pending cycle so we
        // do not end up with two loops racing on the same account.
        clearCycleTimer(client);
        runCommandCycle(client, channelId).catch(err =>
            logToFile(`Cycle error (${maskToken(token)}): ${err.message}`)
        );
    });

    // The gateway drops and Discord can close the session; without these the
    // client just went quiet and the account looked online forever.
    client.on('shardDisconnect', event => {
        logToFile(`Disconnected (${maskToken(token)}) - code ${event?.code ?? '?'}`);
    });
    client.on('shardReconnecting', () => {
        client._reconnecting = true;
        logToFile(`Reconnecting (${maskToken(token)})...`);
    });
    client.on('invalidated', () => {
        logToFile(`Session invalidated (${maskToken(token)}) - restarting.`);
        handleDrop(token, channelId);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.id !== DANK_MEMER_ID) return;
        if (message.channel.id !== channelId) return;

        // Only count replies to a command this client actually sent.
        const last = client._lastSent;
        if (!last) return;
        let command = null;
        if (message.reference?.messageId) {
            if (message.reference.messageId !== last.id) return;
            command = last.command;
        } else if (Date.now() - last.at > 15000) {
            return;
        } else {
            command = last.command;
        }

        try {
            let text = message.content || '';
            for (const embed of message.embeds) {
                if (embed.description) text += ' ' + embed.description;
                if (embed.title) text += ' ' + embed.title;
                for (const field of embed.fields || []) {
                    text += ' ' + field.name + ' ' + field.value;
                }
            }
            const kind = classifyReply(command, text);
            if (DEBUG_STATS) logToFile(`[stats] ${maskToken(token)} reply to "${command}" -> ${kind}`);
            applyStats(token, kind, text);
        } catch (err) {
            logToFile(`Message parse error (${maskToken(token)}): ${err.message}`);
        }
    });

    client.on('error', err => {
        logToFile(`Client error (${maskToken(token)}): ${err.message}`);
    });

    try {
        // Retry transient login failures (network blips, temporary rate limits)
        // with backoff instead of giving up on the account for good.
        let lastErr;
        for (let attempt = 1; attempt <= config.loginRetries; attempt++) {
            try {
                await client.login(token);
                lastErr = null;
                break;
            } catch (e) {
                lastErr = e;
                if (attempt < config.loginRetries) {
                    const wait = backoffDelay(attempt);
                    logToFile(`Login attempt ${attempt} failed for ${maskToken(token)} (${e.message}); retrying in ${Math.round(wait / 1000)}s`);
                    await sleep(wait);
                }
            }
        }
        if (lastErr) throw lastErr;

        activeClients.set(token, client);
        setActiveFlag(token, true);
        return { ok: true, status: 'started' };
    } catch (e) {
        logToFile(`Login failed for ${maskToken(token)} - ${e.message}`);
        clearCycleTimer(client);
        try { client.destroy(); } catch { /* already gone */ }
        return { ok: false, status: 'failed', error: e.message };
    } finally {
        loginLocks.delete(token);
    }
}

// Tears down a client that dropped unexpectedly and starts it again, unless it
// was stopped on purpose or is already being restarted.
async function handleDrop(token, channelId) {
    if (restartLocks.has(token)) return;
    // Only accounts the user asked to keep running are restarted.
    const entry = loadTokens().tokens.find(t => t.token === token);
    if (!entry || !entry.active) return;

    restartLocks.add(token);
    try {
        const client = activeClients.get(token);
        if (client) {
            clearCycleTimer(client);
            activeClients.delete(token);
            try { client.destroy(); } catch { /* already gone */ }
        }

        const attempt = (restartAttempts.get(token) || 0) + 1;
        restartAttempts.set(token, attempt);
        const wait = backoffDelay(attempt);
        logToFile(`Restarting ${maskToken(token)} in ${Math.round(wait / 1000)}s (attempt ${attempt})`);
        await sleep(wait);

        if (activeClients.has(token) || loginLocks.has(token)) return;
        const stillActive = loadTokens().tokens.find(t => t.token === token)?.active;
        if (!stillActive) return;

        const res = await startClient(token, channelId);
        if (!res.ok && res.status !== 'in_progress' && res.status !== 'already') {
            // Keep retrying with growing backoff rather than giving up silently.
            scheduleRestart(token, channelId);
        }
    } finally {
        restartLocks.delete(token);
    }
}

// Schedules one more restart attempt for an active account, using the current
// backoff. Timers are unref'd so they never hold the process open.
function scheduleRestart(token, channelId) {
    const attempt = (restartAttempts.get(token) || 0) + 1;
    restartAttempts.set(token, attempt);
    const timer = setTimeout(() => {
        handleDrop(token, channelId).catch(err =>
            logToFile(`Restart error (${maskToken(token)}): ${err.message}`)
        );
    }, backoffDelay(attempt));
    if (timer.unref) timer.unref();
}

// Periodically restarts any active account whose session has gone quiet, and
// reconciles accounts that are flagged active but have no live client (for
// example a login that failed at boot).
function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        const now = Date.now();

        for (const [token, client] of [...activeClients]) {
            const lastSeen = Math.max(client._lastCycleAt || 0, client.readyTimestamp || 0);
            if (now - lastSeen <= config.stallMs) continue;
            if (client._reconnecting) continue;
            logToFile(`Watchdog: ${maskToken(token)} stalled for ${Math.round((now - lastSeen) / 1000)}s`);
            const entry = loadTokens().tokens.find(t => t.token === token);
            handleDrop(token, entry?.channelId).catch(err =>
                logToFile(`Watchdog restart error (${maskToken(token)}): ${err.message}`)
            );
        }

        for (const t of loadTokens().tokens) {
            if (!t.active) continue;
            if (activeClients.has(t.token) || loginLocks.has(t.token) || restartLocks.has(t.token)) continue;
            logToFile(`Watchdog: ${maskToken(t.token)} is active but not running - starting`);
            handleDrop(t.token, t.channelId).catch(err =>
                logToFile(`Watchdog start error (${maskToken(t.token)}): ${err.message}`)
            );
        }
    }, config.watchdogInterval);
    if (watchdogTimer.unref) watchdogTimer.unref();
}

function stopWatchdog() {
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }
}

async function stopClient(token) {
    if (!activeClients.has(token)) {
        setActiveFlag(token, false);
        restartAttempts.delete(token);
        return false;
    }
    const client = activeClients.get(token);
    clearCycleTimer(client);
    try {
        client.destroy();
    } catch {
        // Already gone - nothing to do.
    }
    activeClients.delete(token);
    restartAttempts.delete(token);
    setActiveFlag(token, false);
    logToFile(`Stopped client for ${maskToken(token)}`);
    if (!activeClients.size) stopWatchdog();
    return true;
}

// Starts only the accounts flagged active (used on boot).
async function startActiveClients() {
    const tokensData = loadTokens();
    let started = 0;
    for (const t of tokensData.tokens) {
        if (!t.active) continue;
        const res = await startClient(t.token, t.channelId);
        if (res.ok) started++;
    }
    if (activeClients.size) startWatchdog();
    return started;
}

// Starts every registered account, flagging them active (used by $start-all).
async function startAllClients() {
    const tokensData = loadTokens();
    let started = 0;
    for (const t of tokensData.tokens) {
        const res = await startClient(t.token, t.channelId);
        if (res.ok) started++;
    }
    if (activeClients.size) startWatchdog();
    return started;
}

async function stopAllClients() {
    let stopped = 0;
    for (const token of [...activeClients.keys()]) {
        if (await stopClient(token)) stopped++;
    }
    // Also clear the flag on accounts that were active but never logged in.
    const tokensData = loadTokens();
    let changed = false;
    for (const t of tokensData.tokens) {
        if (t.active) { t.active = false; changed = true; }
    }
    if (changed) store.writeJSON(config.tokensPath, tokensData);
    return stopped;
}

// Flips an account's active flag and starts/stops it to match.
// Returns { ok, active, status } so the caller can report the resulting state.
async function toggleToken(index) {
    const tokensData = loadTokens();
    const entry = tokensData.tokens[index];
    if (!entry) return { ok: false, active: false };

    const active = !entry.active;
    entry.active = active;
    store.writeJSON(config.tokensPath, tokensData);

    if (active) {
        const res = await startClient(entry.token, entry.channelId);
        if (!res.ok && res.status !== 'already') {
            // Do not claim an account is active when it never came online.
            setActiveFlag(entry.token, false);
            return { ok: false, active: false, status: res.status, error: res.error };
        }
        return { ok: true, active: true };
    }

    await stopClient(entry.token);
    return { ok: true, active: false };
}

function addToken(token, channelId) {
    const tokensData = loadTokens();
    if (tokensData.tokens.find(t => t.token === token)) return false;
    tokensData.tokens.push({ token, channelId, active: false });
    store.writeJSON(config.tokensPath, tokensData);
    return true;
}

// Confirms a user token is valid before registering it, so a typo is caught
// at add-time instead of silently failing on every start. Uses the bare token
// (no "Bot " prefix) because these are user accounts, not bot accounts.
async function validateToken(token) {
    const rest = new REST({ version: '10', authPrefix: '' }).setToken(token);
    try {
        const me = await rest.get(Routes.user('@me'));
        return { ok: true, user: me };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function removeToken(index) {
    const tokensData = loadTokens();
    const entry = tokensData.tokens[index];
    if (!entry) return false;

    await stopClient(entry.token);
    tokensData.tokens.splice(index, 1);
    store.writeJSON(config.tokensPath, tokensData);

    const stats = loadStats();
    delete stats.stats[entry.token];
    saveStats(stats);
    return true;
}

function resetStats() {
    const tokensData = loadTokens();
    const stats = { stats: {} };
    for (const t of tokensData.tokens) {
        stats.stats[t.token] = blankStats(maskToken(t.token));
    }
    saveStats(stats);
    return true;
}

function exportStats() {
    const stats = loadStats();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `stats_export_${stamp}.json`;
    const exportPath = path.join(config.dataDir, filename);
    store.writeJSON(exportPath, stats);
    return exportPath;
}

function getAllStats() {
    return loadStats();
}

function getActiveCount() {
    return activeClients.size;
}

function getActiveTokens() {
    // Report only clients that are genuinely connected, so the UI never shows a
    // dropped account as running.
    const ready = new Set();
    for (const [token, client] of activeClients) {
        if (client.isReady()) ready.add(token);
    }
    return ready;
}

module.exports = {
    startClient,
    stopClient,
    startActiveClients,
    startAllClients,
    stopAllClients,
    toggleToken,
    addToken,
    removeToken,
    resetStats,
    exportStats,
    getAllStats,
    getActiveCount,
    getActiveTokens,
    maskToken,
    validateToken,
    parseCoins,
    parseLoot,
    classifyReply,
    initializeStats,
    applyStats,
    jittered,
    backoffDelay,
    startWatchdog,
    stopWatchdog,
    handleDrop,
    runCommandCycle,
    // Test-only hooks so the cycle/reschedule invariant can be exercised without
    // a live gateway connection.
    _test: { activeClients, clearCycleTimer }
};
