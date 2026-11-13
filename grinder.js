const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');

const LOG_PATH = path.join(__dirname, 'sent_commands.log');
const DANK_MEMER_ID = '270904126974590976';

const activeClients = new Map(); // token -> selfbot client
const loginLocks = new Set();    // tokens currently logging in

function logToFile(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
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

function parseCoins(content) {
    const walletMatch = content.match(/<:Coin:.*?>\s*([\d,]+)/);
    const bankMatch = content.match(/<:Bank:.*?>\s*([\d,]+)/);
    const wallet = walletMatch ? parseInt(walletMatch[1].replace(/,/g, ''), 10) : 0;
    const bank = bankMatch ? parseInt(bankMatch[1].replace(/,/g, ''), 10) : 0;
    return { wallet, bank };
}

// Matches both custom emoji loot (**12 <:Rabbit:1234> Rabbit) and plain
// unicode loot (**12 Rabbit), so tracking survives emoji format changes.
function parseLoot(content) {
    const result = { animals: [], items: [] };
    const isAnimal = content.includes('caught') || content.includes('hunting');
    const regex = /\*\*\d+\s+(?:<a?:[A-Za-z0-9_]+:\d+>\s*)?([^*\n]+)/g;
    for (const match of content.matchAll(regex)) {
        const name = match[1].replace(/\s+/g, ' ').trim();
        if (!name) continue;
        (isAnimal ? result.animals : result.items).push(name);
    }
    return result;
}

function initializeStats(token, username) {
    const stats = loadStats();
    const existing = stats.stats[token];
    if (!existing) {
        stats.stats[token] = {
            name: username || maskToken(token),
            commands: 0,
            coins: 0,
            lastTotal: 0,
            catches: 0,
            items: 0,
            animals: 0,
            failures: 0
        };
        saveStats(stats);
    } else if (username && existing.name !== username) {
        existing.name = username;
        saveStats(stats);
    }
}

function updateStats(token, content) {
    const stats = loadStats();
    const entry = stats.stats[token];
    if (!entry) return;

    if (content.includes('<:Coin:') && content.includes('<:Bank:')) {
        const { wallet, bank } = parseCoins(content);
        const total = wallet + bank;
        if (total > entry.lastTotal) entry.coins += total - entry.lastTotal;
        entry.lastTotal = total;
    }

    const { animals, items } = parseLoot(content);
    entry.animals += animals.length;
    entry.items += items.length;
    entry.catches += animals.length + items.length;

    saveStats(stats);
}

async function sendCommand(client, channelId, command) {
    const token = client.token;
    const stats = loadStats();
    const entry = stats.stats[token];
    if (entry) {
        entry.commands++;
        saveStats(stats);
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error('Channel not found');
        await channel.send(command);
        logToFile(`[${maskToken(token)}] Sent command: ${command}`);
        return true;
    } catch (err) {
        logToFile(`[${maskToken(token)}] Command failed: ${err.message}`);
        if (entry) {
            entry.failures++;
            saveStats(stats);
        }
        return false;
    }
}

async function runCommandCycle(client, channelId) {
    const token = client.token;
    if (!client.isReady()) return;
    const commands = ['pls beg', 'pls hunt', 'pls dig', 'pls bal'];
    for (const cmd of commands) {
        if (!client.isReady()) return;
        await sendCommand(client, channelId, cmd);
        await new Promise(res => setTimeout(res, config.commandInterval));
    }

    if (client.isReady()) {
        client._cycleTimer = setTimeout(() => {
            runCommandCycle(client, channelId).catch(err =>
                logToFile(`Cycle error (${maskToken(token)}): ${err.message}`)
            );
        }, config.cycleInterval);
    }
}

function clearCycleTimer(client) {
    if (client._cycleTimer) {
        clearTimeout(client._cycleTimer);
        client._cycleTimer = null;
    }
}

// Returns { ok, status } where status is 'started' | 'already' | 'in_progress' | 'failed'.
async function startClient(token, channelId) {
    if (activeClients.has(token)) return { ok: true, status: 'already' };
    if (loginLocks.has(token)) return { ok: false, status: 'in_progress' };

    loginLocks.add(token);
    const client = new Client({ checkUpdate: false, readyStatus: false, syncStatus: false });

    client.on('ready', () => {
        logToFile(`Logged in as ${client.user.tag} (${maskToken(token)})`);
        initializeStats(token, client.user.username);
        runCommandCycle(client, channelId).catch(err =>
            logToFile(`Cycle error (${maskToken(token)}): ${err.message}`)
        );
    });

    client.on('messageCreate', async (message) => {
        if (message.author.id !== DANK_MEMER_ID) return;
        if (message.channel.id !== channelId) return;
        if (!message.reference?.messageId) return;
        try {
            const reply = await message.channel.messages.fetch(message.reference.messageId);
            if (reply?.author.id !== client.user.id) return;

            let text = message.content || '';
            for (const embed of message.embeds) {
                if (embed.description) text += ' ' + embed.description;
                for (const field of embed.fields || []) {
                    text += ' ' + field.name + ' ' + field.value;
                }
            }
            updateStats(token, text);
        } catch (err) {
            logToFile(`Message parse error (${maskToken(token)}): ${err.message}`);
        }
    });

    client.on('error', err => {
        logToFile(`Client error (${maskToken(token)}): ${err.message}`);
    });

    try {
        await client.login(token);
        activeClients.set(token, client);
        return { ok: true, status: 'started' };
    } catch (e) {
        logToFile(`Login failed for ${maskToken(token)} - ${e.message}`);
        clearCycleTimer(client);
        return { ok: false, status: 'failed', error: e.message };
    } finally {
        loginLocks.delete(token);
    }
}

async function stopClient(token) {
    if (!activeClients.has(token)) return false;
    const client = activeClients.get(token);
    clearCycleTimer(client);
    try {
        client.destroy();
    } catch {
        // Already gone - nothing to do.
    }
    activeClients.delete(token);
    logToFile(`Stopped client for ${maskToken(token)}`);
    return true;
}

async function startAllClients(discordMsg = null) {
    const tokensData = loadTokens();
    let started = 0;
    for (const t of tokensData.tokens) {
        if (!t.active) continue;
        const res = await startClient(t.token, t.channelId);
        if (res.ok) {
            started++;
        } else if (discordMsg) {
            await discordMsg.channel.send(`Login failed for ${maskToken(t.token)}`).catch(() => {});
        }
    }
    return started;
}

async function stopAllClients() {
    let stopped = 0;
    for (const token of [...activeClients.keys()]) {
        if (await stopClient(token)) stopped++;
    }
    return stopped;
}

async function toggleToken(index) {
    const tokensData = loadTokens();
    const entry = tokensData.tokens[index];
    if (!entry) return false;

    entry.active = !entry.active;
    store.writeJSON(config.tokensPath, tokensData);

    if (entry.active) {
        await startClient(entry.token, entry.channelId);
    } else {
        await stopClient(entry.token);
    }
    return true;
}

function addToken(token, channelId) {
    const tokensData = loadTokens();
    if (tokensData.tokens.find(t => t.token === token)) return false;
    tokensData.tokens.push({ token, channelId, active: false });
    store.writeJSON(config.tokensPath, tokensData);
    return true;
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
        stats.stats[t.token] = {
            name: maskToken(t.token),
            commands: 0,
            coins: 0,
            lastTotal: 0,
            catches: 0,
            items: 0,
            animals: 0,
            failures: 0
        };
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

module.exports = {
    startClient,
    stopClient,
    startAllClients,
    stopAllClients,
    toggleToken,
    addToken,
    removeToken,
    resetStats,
    exportStats,
    getAllStats,
    getActiveCount,
    maskToken,
    parseCoins,
    parseLoot
};
