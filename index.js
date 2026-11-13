const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const store = require('./store');
const grinder = require('./grinder');
const handlers = require('./handlers');
const keepAlive = require('./keepalive');
const emojiSync = require('./upload-emojis');

process.on('unhandledRejection', reason => {
    console.error('Unhandled Rejection:', reason);
});

async function initializeBot() {
    store.initStorage();

    const errors = config.validate();
    if (errors.length) {
        errors.forEach(e => console.error(`❌ ${e}`));
        console.error('Set BOT_TOKEN and OWNER_ID as environment variables (or in config.json).');
        process.exit(1);
    }

    // Keep the access file in sync with the configured owner.
    const access = store.readJSON(config.accessPath, { ownerId: config.ownerId, authorizedUsers: [] });
    access.ownerId = config.ownerId;
    if (!Array.isArray(access.authorizedUsers)) access.authorizedUsers = [];
    store.writeJSON(config.accessPath, access);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ]
    });

    client.once('ready', async () => {
        console.log(`✅ Logged in as ${client.user.tag}`);
        console.log(`🔧 Owner ID: ${config.ownerId}`);
        console.log(`📝 Prefix: ${handlers.PREFIX}`);
        client.user.setActivity('the Dank Farm', { type: 3 }); // 3 = WATCHING

        // Upload any missing custom emojis. A fresh Render deploy has an empty
        // storage dir and no shell, so this restores the custom set on boot.
        try {
            const { uploaded, total } = await emojiSync.sync();
            if (uploaded) console.log(`🎨 Uploaded ${uploaded} custom emoji(s) (${total} total)`);
        } catch (err) {
            console.error('Emoji sync failed (continuing with unicode):', err.message);
        }

        try {
            const started = await grinder.startAllClients();
            console.log(`✅ Started ${started} farming client(s)`);
        } catch (err) {
            console.error('Failed to auto-start farming clients:', err.message);
        }
    });

    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        if (!message.content.startsWith(handlers.PREFIX)) return;
        try {
            await handlers.handleCommand(message);
        } catch (err) {
            console.error('Command handling failed:', err.message);
        }
    });

    client.on('error', err => console.error('Discord client error:', err.message));
    client.on('warn', warning => console.warn('Discord client warning:', warning));

    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n🛑 Received ${signal}, shutting down...`);
        try {
            const stopped = await grinder.stopAllClients();
            console.log(`✅ Stopped ${stopped} farming client(s)`);
        } catch (err) {
            console.error('Error stopping clients:', err.message);
        }
        client.destroy();
        console.log('✅ Shutdown complete');
        process.exit(0);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', err => {
        console.error('Uncaught Exception:', err);
        process.exit(1);
    });

    await client.login(config.botToken);
    return client;
}

console.log('🤖 Starting Dank Farm bot...');

// Start the web server first so Render's health check passes while Discord logs in.
keepAlive.start();

initializeBot().catch(err => {
    console.error('❌ Failed to start bot:', err.message);
    process.exit(1);
});
