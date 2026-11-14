// Central configuration. Reads environment variables first (Render / any host),
// then falls back to config.json so the bot still works when run locally.
const fs = require('fs');
const path = require('path');

// Local development convenience: load a .env file if Node supports it.
// On Render the variables are injected by the platform, so this is a no-op.
try {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(path.join(__dirname, '.env'));
    }
} catch {
    // No .env file present - that is fine.
}

const CONFIG_PATH = path.join(__dirname, 'config.json');

function readFileConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return {};
    }
}

const fileConfig = readFileConfig();

const PLACEHOLDERS = new Set([
    'YOUR_BOT_TOKEN_HERE',
    'YOUR_OWNER_ID_HERE',
    'your_discord_bot_token_here',
    'your_discord_user_id_here'
]);

function firstReal(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0 && !PLACEHOLDERS.has(value)) {
            return value;
        }
    }
    return '';
}

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const dataDir = path.resolve(__dirname, process.env.DATA_DIR || 'storage');

const config = {
    botToken: firstReal(process.env.BOT_TOKEN, fileConfig.botToken),
    ownerId: firstReal(process.env.OWNER_ID, fileConfig.ownerId),

    // Where tokens.json / stats.json / access.json / emojis.json live.
    dataDir,
    tokensPath: path.join(dataDir, 'tokens.json'),
    statsPath: path.join(dataDir, 'stats.json'),
    accessPath: path.join(dataDir, 'access.json'),
    emojisPath: path.join(dataDir, 'emojis.json'),

    // Farming cadence (milliseconds). Tune with env vars if needed.
    commandInterval: toInt(process.env.COMMAND_INTERVAL, 3000),
    cycleInterval: toInt(process.env.CYCLE_INTERVAL, 45000),

    // Random extra delay added on top of each interval. A perfectly regular
    // cadence is both a bot signal and easy to rate-limit, so spread it out.
    commandJitter: toInt(process.env.COMMAND_JITTER, 1500),
    cycleJitter: toInt(process.env.CYCLE_JITTER, 15000),

    // Liveness watchdog: how often to check clients, and how long a client may
    // stay disconnected before it is torn down and restarted.
    watchdogInterval: toInt(process.env.WATCHDOG_INTERVAL, 60000),
    stallMs: toInt(process.env.STALL_MS, 90000),

    // Login retry/backoff.
    loginRetries: toInt(process.env.LOGIN_RETRIES, 3),
    maxBackoff: toInt(process.env.MAX_BACKOFF, 300000),

    // Discord client identity sent on IDENTIFY. The library pins an old build
    // number; override it here so the session does not look stale.
    clientBuildNumber: toInt(process.env.CLIENT_BUILD_NUMBER, 455964),
    clientVersion: process.env.CLIENT_VERSION || '1.0.9210',

    // Commands sent each cycle, in order. Response parsing keys off the command
    // name, so keep "bal" (coins), "hunt" (animals) and "dig" (items).
    farmCommands: (process.env.FARM_COMMANDS || 'pls beg,pls hunt,pls dig,pls bal')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),

    // Keep-alive web server so a Render free Web Service does not idle-sleep.
    keepAlive: process.env.KEEP_ALIVE !== 'false',
    port: toInt(process.env.PORT, 3000),
    selfUrl: firstReal(process.env.RENDER_EXTERNAL_URL, process.env.SELF_URL),
    selfPingMs: toInt(process.env.SELF_PING_MS, 10 * 60 * 1000),

    commandPrefix: process.env.COMMAND_PREFIX || '$'
};

function validate() {
    const errors = [];
    if (!config.botToken) {
        errors.push('BOT_TOKEN is missing (set the env var or config.json "botToken").');
    }
    if (!config.ownerId) {
        errors.push('OWNER_ID is missing (set the env var or config.json "ownerId").');
    }
    return errors;
}

module.exports = { ...config, validate };
