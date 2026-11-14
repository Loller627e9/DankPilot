const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshDataDir, load } = require('./helpers');

const dir = freshDataDir();
const { ui, store, emojis } = load();

function flatten(payload) {
    const parts = [];
    for (const embed of payload.embeds) {
        const json = embed.toJSON();
        if (json.title) parts.push(json.title);
        if (json.description) parts.push(json.description);
        if (json.image && json.image.url) parts.push(json.image.url);
        if (json.footer && json.footer.text) parts.push(json.footer.text);
        for (const f of json.fields || []) parts.push(`${f.name} ${f.value}`);
    }
    return parts.join('\n');
}

test('statsPayload works with no accounts at all', () => {
    const payload = ui.statsPayload({ stats: {} }, { tokens: [] });
    assert.strictEqual(payload.embeds.length, 1);
    assert.match(flatten(payload), /No stats yet/i);
    assert.ok(payload.files.length >= 1, 'background is attached');
});

test('statsPayload renders one line per registered account', () => {
    const stats = { stats: { t1: { name: 'alpha', coins: 1500, animals: 2, items: 3, commands: 9, failures: 1 } } };
    const tokens = { tokens: [{ token: 't1', channelId: '1', active: true }] };
    const text = flatten(ui.statsPayload(stats, tokens));
    assert.match(text, /alpha/);
    assert.match(text, /1,500/);
    assert.match(text, /Accounts \*\*1\/1\*\* active/);
});

test('statsPayload totals every account', () => {
    const stats = {
        stats: {
            t1: { name: 'a', coins: 100, animals: 1, items: 1, commands: 1, failures: 0 },
            t2: { name: 'b', coins: 250, animals: 2, items: 2, commands: 2, failures: 1 },
        },
    };
    const text = flatten(ui.statsPayload(stats, { tokens: [] }));
    assert.match(text, /Coins \*\*350\*\*/);
    assert.match(text, /Animals \*\*3\*\*/);
    assert.match(text, /Fails \*\*1\*\*/);
});

test('statsPayload keeps the description inside the 4096 limit', () => {
    const stats = { stats: {} };
    const tokens = { tokens: [] };
    for (let i = 0; i < 300; i++) {
        stats.stats[`t${i}`] = { name: `account-name-number-${i}`, coins: i, animals: 0, items: 0, commands: 0, failures: 0 };
        tokens.tokens.push({ token: `t${i}`, channelId: '1', active: i % 2 === 0 });
    }
    const json = ui.statsPayload(stats, tokens).embeds[0].toJSON();
    assert.ok(json.description.length <= 4096, `description was ${json.description.length}`);
});

test('helpPayload lists every command with the configured prefix', () => {
    const text = flatten(ui.helpPayload());
    for (const cmd of ['help', 'stats', 'add-token', 'remove-token', 'toggle', 'start-all', 'stop-all', 'grant', 'revoke', 'reset-stats', 'export-stats']) {
        assert.ok(text.includes(`$`), 'prefix present');
        assert.ok(text.includes(cmd), `missing ${cmd}`);
    }
});

test('statusPayload colours success and failure differently', () => {
    const ok = ui.statusPayload('success', 'done').embeds[0].toJSON();
    const bad = ui.statusPayload('error', 'nope').embeds[0].toJSON();
    assert.notStrictEqual(ok.color, bad.color);
    assert.match(ok.description, /done/);
    assert.match(bad.description, /nope/);
});

test('accountPayload shows the account and masks its token', () => {
    const text = flatten(ui.accountPayload(0, { token: 'ABCDEFGHIJKLMNOP.secret.SECRET' },
        { name: 'alpha', coins: 10, animals: 0, items: 0, commands: 0, failures: 0 }, true, 3));
    assert.match(text, /alpha/);
    assert.match(text, /Page 1 of 3/);
    assert.ok(!text.includes('secret'), 'token body must not appear');
});

test('every attached asset file actually exists', () => {
    for (const payload of [ui.helpPayload(), ui.statusPayload('success', 'x'), ui.statusPayload('error', 'x'), ui.statsPayload({ stats: {} }, { tokens: [] })]) {
        for (const file of payload.files) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', file.name)), `missing asset ${file.name}`);
        }
    }
});

test('fmt groups thousands and tolerates junk', () => {
    assert.strictEqual(ui.fmt(1234567), '1,234,567');
    assert.strictEqual(ui.fmt(undefined), '0');
    assert.strictEqual(ui.fmt('nonsense'), '0');
});

test('emojis fall back to unicode before the map is uploaded', () => {
    assert.strictEqual(emojis.hasAny(), false);
    assert.strictEqual(emojis.dk_coin, '💰');
    assert.strictEqual(emojis.dk_farm, '🚜');
});

test('emojis use the uploaded map once it exists', () => {
    store.writeJson(path.join(dir, 'emojis.json'), { dk_coin: '<:dk_coin:1>' });
    const { emojis: fresh } = load();
    assert.strictEqual(fresh.dk_coin, '<:dk_coin:1>');
    assert.strictEqual(fresh.dk_farm, '🚜', 'unmapped keys still fall back');
});
