// Configuration loader.
//
// Values come from the environment first (what every host uses), then from
// config.json (the local convenience file the original bot used). Environment
// wins so a host's dashboard settings are never silently overridden by a stale
// file, and so no token ever has to be committed to the repository.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfigFile() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return {};
    }
}

const file = readConfigFile();
const env = process.env;

function pick(envKey, fileKey) {
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') return String(fromEnv).trim();
    return file[fileKey];
}

function number(envKey, fallback) {
    const value = Number(env[envKey]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const config = {
    botToken: pick('BOT_TOKEN', 'botToken'),
    ownerId: pick('OWNER_ID', 'ownerId') !== undefined ? String(pick('OWNER_ID', 'ownerId')) : '',
    prefix: pick('COMMAND_PREFIX', 'prefix') || '$',

    commandInterval: number('COMMAND_INTERVAL', 3000),
    cycleInterval: number('CYCLE_INTERVAL', 45000),
    commands: String(pick('FARM_COMMANDS', 'commands') || 'pls beg,pls hunt,pls dig,pls bal')
        .split(',')
        .map(c => c.trim())
        .filter(Boolean),
    // Extra ids treated as Dank Memer, in case a reply arrives from a second id.
    extraBotIds: String(pick('EXTRA_BOT_IDS', 'extraBotIds') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),

    // Accounts re-registered on every boot, as "token:channelId" pairs. Free
    // hosts wipe the working directory, so without this the registered accounts
    // vanish on restart and nothing is farmed.
    farmAccounts: (pick('FARM_ACCOUNTS', 'farmAccounts') || '')
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean),

    dataDir: pick('DATA_DIR', 'dataDir') || 'storage',
    brandName: pick('BRAND_NAME', 'brandName') || 'DANK FARM',
};

// Where the JSON state lives. Absolute, so the process can be started from any
// working directory.
config.dataDirPath = path.isAbsolute(config.dataDir)
    ? config.dataDir
    : path.join(__dirname, config.dataDir);

const PLACEHOLDERS = new Set([
    'YOUR_BOT_TOKEN_HERE',
    'YOUR_OWNER_ID_HERE',
    'your_discord_bot_token_here',
    'your_discord_user_id_here',
]);

// Returns a list of human-readable problems; empty means the config is usable.
function validate() {
    const problems = [];
    if (!config.botToken || PLACEHOLDERS.has(config.botToken)) {
        problems.push('BOT_TOKEN is not set (set the env var, or botToken in config.json)');
    }
    if (!config.ownerId || PLACEHOLDERS.has(config.ownerId)) {
        problems.push('OWNER_ID is not set (set the env var, or ownerId in config.json)');
    }
    if (!/^\d+$/.test(config.ownerId || '')) {
        problems.push('OWNER_ID must be a numeric Discord user id');
    }
    return problems;
}

module.exports = { ...config, validate, CONFIG_PATH };
