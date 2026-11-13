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
