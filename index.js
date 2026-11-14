// Entrypoint: the admin bot plus every farming account.
const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const store = require('./store');
const grinder = require('./grinder');
const handlers = require('./handlers');
const health = require('./health');

async function main() {
    store.ensureDir();

    const problems = config.validate();
    if (problems.length) {
        for (const problem of problems) console.error(`Configuration error: ${problem}`);
        console.error('Set the env vars (or config.json) and start again.');
        process.exit(1);
    }

    console.log(`🤖 Starting ${config.brandName}...`);

    // access.json is created from OWNER_ID when missing. The original bot read
    // it without a fallback, so on a fresh clone the owner had no permission
    // and every command was silently refused.
    const access = store.loadAccess();
    if (!store.readJson(store.ACCESS_PATH, null)) {
        store.saveAccess(access);
        console.log(`Created access.json for owner ${access.ownerId}`);
    }

    const seeded = grinder.seedFromEnv();
    if (!seeded && !store.loadTokens().tokens.length) {
        console.warn(
            'No farming accounts are registered — nothing will be farmed. Add them with ' +
            `\`${config.prefix}add-token <token> <channelId>\`, or set FARM_ACCOUNTS so they survive a restart.`
        );
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
    });

    client.once('ready', async () => {
        console.log(`✅ Admin bot ready as ${client.user.tag}`);
        client.user.setActivity('Dank Memer farming', { type: 'WATCHING' });
        try {
            const started = await grinder.startAllClients();
            console.log(`✅ Resumed ${started} farming client(s)`);
        } catch (err) {
            console.error('Failed to resume farming clients:', err.message);
        }
    });

    client.on('messageCreate', async (message) => {
        if (!message || !message.author || message.author.bot) return;
        if (!message.content || !message.content.startsWith(handlers.PREFIX)) return;
        try {
            await handlers.handleCommand(message);
        } catch (err) {
            console.error('Command handler error:', err);
        }
    });

    client.on('error', (err) => console.error('Discord client error:', err.message));
    client.on('warn', (warn) => console.warn('Discord warning:', warn));

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n🛑 ${signal} received, shutting down...`);
        try {
            await grinder.shutdown();
            client.destroy();
        } finally {
            process.exit(0);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Log and keep running: a single bad reply must not take the whole bot down.
    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
    });

    // Bound before the gateway login: hosts that probe for an open port kill
    // the service if nothing is listening soon after boot.
    health.startHealthServer(() => grinder.runningTokens().size);
    health.startSelfPing();

    try {
        await client.login(config.botToken);
    } catch (err) {
        console.error('❌ Failed to log in to Discord:', err.message);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('❌ Failed to start:', err);
    process.exit(1);
});
