// Uploads every image in ./emojis as an *application emoji* (owned by the bot,
// usable in any server it is in) and writes the ready-to-use strings to
// storage/emojis.json. Safe to re-run: existing emojis are skipped.
//
// Used two ways:
//   - as a CLI:  node upload-emojis.js
//   - at bot startup (index.js) so a fresh Render deploy picks them up
//     automatically, since the free tier has no shell.
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');
const store = require('./store');

const EMOJI_DIR = path.join(__dirname, 'emojis');
const VALID_EXT = new Set(['gif', 'png', 'jpg', 'jpeg']);
const MIME = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function emojiFiles() {
    if (!fs.existsSync(EMOJI_DIR)) return [];
    return fs.readdirSync(EMOJI_DIR)
        .filter(f => VALID_EXT.has(path.extname(f).slice(1).toLowerCase()));
}

// Uploads any missing emojis and refreshes storage/emojis.json.
// Never throws: a failure here must not stop the bot from logging in.
async function sync({ log = console.log } = {}) {
    const map = store.readJSON(config.emojisPath, {});
    const files = emojiFiles();
    if (!config.botToken || !files.length) return { uploaded: 0, total: Object.keys(map).length };

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    const me = await rest.get(Routes.user('@me'));
    const route = `/applications/${me.id}/emojis`;

    try {
        const existing = (await rest.get(route)).items || [];
        for (const e of existing) {
            map[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
        }
    } catch (err) {
        log(`⚠️  Could not list existing emojis (${err.message}); continuing.`);
    }

    let uploaded = 0;
    for (const file of files) {
        const ext = path.extname(file).slice(1).toLowerCase();
        const name = path.basename(file, '.' + ext);
        if (map[name]) continue;

        const base64 = fs.readFileSync(path.join(EMOJI_DIR, file)).toString('base64');
        try {
            const created = await rest.post(route, {
                body: { name, image: `data:${MIME[ext]};base64,${base64}` }
            });
            map[name] = `<${created.animated ? 'a' : ''}:${created.name}:${created.id}>`;
            uploaded++;
            log(`upload ${name} -> ${map[name]}`);
        } catch (err) {
            log(`fail   ${name}: ${err.message}`);
        }
    }

    store.writeJSON(config.emojisPath, map);
    return { uploaded, total: Object.keys(map).length };
}

async function main() {
    const errors = config.validate();
    if (errors.length) {
        errors.forEach(e => console.error(`❌ ${e}`));
        process.exit(1);
    }
    if (!emojiFiles().length) {
        console.error(`❌ No emoji images found in ${EMOJI_DIR}`);
        process.exit(1);
    }

    const { total } = await sync();
    console.log(`\nSaved ${total} emoji(s) to ${path.relative(__dirname, config.emojisPath)}`);
    console.log('Restart the bot (or run $emojis-reload) to pick up the custom set.');
}

if (require.main === module) {
    main().catch(err => {
        console.error('Upload failed:', err.message);
        process.exit(1);
    });
}

module.exports = { sync };
