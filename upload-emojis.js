// One-time helper:  node upload-emojis.js
//
// Uploads every image in ./emojis as an *application emoji* (owned by the bot,
// usable in any server it is in) and writes the ready-to-use strings to
// storage/emojis.json. Re-running skips emojis that already exist.
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');
const store = require('./store');

const EMOJI_DIR = path.join(__dirname, 'emojis');
const VALID_EXT = new Set(['gif', 'png', 'jpg', 'jpeg']);
const MIME = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

async function main() {
    const errors = config.validate();
    if (errors.length) {
        errors.forEach(e => console.error(`❌ ${e}`));
        process.exit(1);
    }
    if (!fs.existsSync(EMOJI_DIR)) {
        console.error(`❌ No emoji folder found at ${EMOJI_DIR}`);
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    const me = await rest.get(Routes.user('@me')); // bot user id === application id
    const route = `/applications/${me.id}/emojis`;

    const map = store.readJSON(config.emojisPath, {});

    let existing = [];
    try {
        existing = (await rest.get(route)).items || [];
    } catch (err) {
        console.warn(`⚠️  Could not list existing emojis (${err.message}); continuing.`);
    }
    for (const e of existing) {
        map[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
    }

    const files = fs.readdirSync(EMOJI_DIR)
        .filter(f => VALID_EXT.has(path.extname(f).slice(1).toLowerCase()));

    if (!files.length) {
        console.error('❌ No emoji images found in ./emojis');
        process.exit(1);
    }

    for (const file of files) {
        const ext = path.extname(file).slice(1).toLowerCase();
        const name = path.basename(file, '.' + ext);
        if (map[name]) {
            console.log(`skip   ${name} (already uploaded)`);
            continue;
        }

        const base64 = fs.readFileSync(path.join(EMOJI_DIR, file)).toString('base64');
        try {
            const created = await rest.post(route, {
                body: { name, image: `data:${MIME[ext]};base64,${base64}` }
            });
            map[name] = `<${created.animated ? 'a' : ''}:${created.name}:${created.id}>`;
            console.log(`upload ${name} -> ${map[name]}`);
        } catch (err) {
            console.error(`fail   ${name}: ${err.message}`);
        }
    }

    store.writeJSON(config.emojisPath, map);
    console.log(`\nSaved ${Object.keys(map).length} emoji(s) to ${path.relative(__dirname, config.emojisPath)}`);
    console.log('Restart the bot (or run $emojis-reload) to pick up the custom set.');
}

main().catch(err => {
    console.error('Upload failed:', err.message);
    process.exit(1);
});
