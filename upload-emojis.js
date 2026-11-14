// Uploads ./emojis/* as *application emojis* of the admin bot and writes the
// ready-to-use strings to storage/emojis.json. Run once:
//
//     node upload-emojis.js
//
// Re-running is safe: emojis already on the application are skipped.
const fs = require('fs');
const path = require('path');
const { REST } = require('discord.js');
const config = require('./config');
const store = require('./store');

const DIR = path.join(__dirname, 'emojis');
const OUT = path.join(store.DATA_DIR, 'emojis.json');
const MIME = { gif: 'image/gif', png: 'image/png' };

(async () => {
    if (!config.botToken) {
        console.error('BOT_TOKEN is not set — cannot upload emojis.');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(config.botToken);

    // The application-emoji routes reject the "@me" shorthand with
    // 400 "Value \"@me\" is not snowflake", so the real id is resolved first.
    // /users/@me does accept @me, and for a bot the user id *is* the app id.
    const me = await rest.get('/users/@me');
    const route = `/applications/${me.id}/emojis`;

    const existing = (await rest.get(route)).items || [];
    const map = {};
    for (const e of existing) {
        map[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
    }

    for (const file of fs.readdirSync(DIR)) {
        const ext = path.extname(file).slice(1).toLowerCase();
        if (!MIME[ext]) continue;
        const name = path.basename(file, `.${ext}`);
        if (map[name]) {
            console.log(`skip   ${name} (already uploaded)`);
            continue;
        }
        const body = {
            name,
            image: `data:${MIME[ext]};base64,${fs.readFileSync(path.join(DIR, file)).toString('base64')}`,
        };
        const e = await rest.post(route, { body });
        map[name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
        console.log(`upload ${name} -> ${map[name]}`);
    }

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
    console.log(`\nSaved ${Object.keys(map).length} emoji(s) to ${path.relative(__dirname, OUT)}`);
})().catch(err => {
    console.error('Upload failed:', err.message);
    process.exit(1);
});
