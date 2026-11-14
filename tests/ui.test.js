// UI tests: the paginated stats panel and the command embeds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshDataDir, load } = require('./helpers');

freshDataDir();
const { ui } = load();

function flatten(payload) {
    const parts = [];
    for (const embed of payload.embeds) {
        const json = embed.toJSON();
        for (const key of ['title', 'description']) if (json[key]) parts.push(json[key]);
        if (json.image && json.image.url) parts.push(json.image.url);
        if (json.footer && json.footer.text) parts.push(json.footer.text);
        for (const f of json.fields || []) parts.push(`${f.name} ${f.value}`);
    }
    return parts.join('\n');
}

const THREE = {
    tokens: [
        { token: 'tok-a', channelId: '111', active: true },
        { token: 'tok-b', channelId: '222', active: true },
        { token: 'tok-c', channelId: '333', active: false },
    ],
};
const STATS = {
    stats: {
        'tok-a': { name: 'alpha', coins: 1500, animals: 4, items: 3, commands: 20, catches: 7, failures: 1, misses: 3, lastTotal: 9000, extras: { gems: 12 } },
        'tok-b': { name: 'bravo', coins: 250, animals: 2, items: 1, commands: 9, catches: 3, failures: 0, misses: 1, lastTotal: 400 },
        'tok-c': { name: 'charlie', coins: 0, animals: 0, items: 0, commands: 0, catches: 0, failures: 0, misses: 0, lastTotal: 0 },
    },
};

// --- pagination --------------------------------------------------------------

test('page count is one overview plus one page per account', () => {
    assert.strictEqual(ui.totalPages(THREE), 4);
    assert.strictEqual(ui.totalPages({ tokens: [] }), 1);
});

test('page 0 is the overview and lists every account', () => {
    const view = ui.statsPage(0, STATS, THREE);
    const text = flatten(view);
    for (const name of ['alpha', 'bravo', 'charlie']) assert.ok(text.includes(name), `missing ${name}`);
    assert.match(text, /page 1 of 4/i);
});

test('each account page shows that account and its page number', () => {
    for (let i = 0; i < 3; i++) {
        const text = flatten(ui.statsPage(i + 1, STATS, THREE));
        const name = ['alpha', 'bravo', 'charlie'][i];
        assert.ok(text.includes(name), `page ${i + 1} should show ${name}`);
        assert.match(text, new RegExp(`page ${i + 2} of 4`, 'i'));
    }
});

test('an account page shows catches, misses and hit rate', () => {
    const text = flatten(ui.statsPage(1, STATS, THREE));
    assert.match(text, /Animals caught \*\*4\*\*/);
    assert.match(text, /Items dug \*\*3\*\*/);
    assert.match(text, /Missed \*\*3\*\*/);
    assert.match(text, /Hit rate \*\*70%\*\*/, '7 catches / 10 attempts');
});

test('an account page shows extra currencies', () => {
    const text = flatten(ui.statsPage(1, STATS, THREE));
    assert.match(text, /gems/);
    assert.match(text, /12/);
});

test('an account page never leaks the token', () => {
    const text = flatten(ui.statsPage(1, STATS, THREE));
    assert.ok(!text.includes('tok-a'), 'the token body must not appear');
});

test('a page number past the end is clamped, not crashed', () => {
    const view = ui.statsPage(99, STATS, THREE);
    assert.strictEqual(view.page, 3);
    assert.ok(flatten(view).includes('charlie'));
});

test('a negative page number is clamped to the overview', () => {
    assert.strictEqual(ui.statsPage(-5, STATS, THREE).page, 0);
});

test('a stats row missing newer fields renders as zeros', () => {
    // Files written by the older bot have no misses/extras keys.
    const old = { stats: { 'tok-a': { name: 'old', coins: 5 } } };
    const text = flatten(ui.statsPage(1, old, THREE));
    assert.match(text, /Missed \*\*0\*\*/);
    assert.match(text, /Hit rate/);
});

test('a stats row with no entry at all renders as zeros', () => {
    // No stats row yet: the name falls back to a masked token and every
    // counter reads zero rather than throwing.
    const text = flatten(ui.statsPage(3, { stats: {} }, THREE));
    assert.match(text, /Missed \*\*0\*\*/);
    assert.ok(!text.includes('tok-c'), 'the full token never appears');
});


test('the overview totals every account', () => {
    const text = flatten(ui.statsPage(0, STATS, THREE));
    assert.match(text, /Coins[\s\S]*?\*\*1,750\*\*/);
    assert.match(text, /Animals[\s\S]*?\*\*6\*\*/);
    assert.match(text, /Items[\s\S]*?\*\*4\*\*/);
    assert.match(text, /Misses[\s\S]*?\*\*4\*\*/);
});

test('the overview shows how many accounts are farming', () => {
    const running = new Set(['tok-a', 'tok-b']);
    assert.match(flatten(ui.statsPage(0, STATS, THREE, running)), /Farming \*\*2\/3\*\*/);
});

test('the overview copes with no accounts at all', () => {
    const view = ui.statsPage(0, { stats: {} }, { tokens: [] });
    assert.match(flatten(view), /No accounts yet/i);
    assert.strictEqual(ui.totalPages({ tokens: [] }), 1);
});

test('a long account list is truncated to fit the embed limit', () => {
    const tokens = { tokens: [] };
    const stats = { stats: {} };
    for (let i = 0; i < 300; i++) {
        tokens.tokens.push({ token: `t${i}`, channelId: '1', active: true });
        stats.stats[`t${i}`] = { name: `account-name-${i}`, coins: i, animals: 1, items: 1, commands: 1 };
    }
    const json = ui.statsPage(0, stats, tokens).embeds[0].toJSON();
    assert.ok(json.description.length <= 4096, `description was ${json.description.length}`);
});

// --- navigation buttons ------------------------------------------------------

test('the nav row is hidden when there is only one page', () => {
    assert.deepStrictEqual(ui.navRow(0, 1), []);
});

test('the nav row offers four buttons otherwise', () => {
    const [row] = ui.navRow(0, 4);
    const ids = row.components.map(c => c.data.custom_id);
    assert.deepStrictEqual(ids, ['stats:first', 'stats:prev', 'stats:next', 'stats:last']);
});

test('first and prev are disabled on the first page', () => {
    const [row] = ui.navRow(0, 4);
    const by = Object.fromEntries(row.components.map(c => [c.data.custom_id, c.data.disabled]));
    assert.strictEqual(by['stats:first'], true);
    assert.strictEqual(by['stats:prev'], true);
    assert.strictEqual(by['stats:next'], false);
});

test('next and last are disabled on the final page', () => {
    const [row] = ui.navRow(3, 4);
    const by = Object.fromEntries(row.components.map(c => [c.data.custom_id, c.data.disabled]));
    assert.strictEqual(by['stats:next'], true);
    assert.strictEqual(by['stats:last'], true);
    assert.strictEqual(by['stats:prev'], false);
});

test('there is no start/stop button anywhere in the panel', () => {
    const [row] = ui.navRow(0, 4);
    const ids = row.components.map(c => c.data.custom_id);
    assert.ok(!ids.some(id => /start|stop|toggle/i.test(id)), 'start/stop controls were removed');
});

test('nextPage moves one page at a time and stops at the ends', () => {
    assert.strictEqual(ui.nextPage('next', 0, 4), 1);
    assert.strictEqual(ui.nextPage('next', 3, 4), 3);
    assert.strictEqual(ui.nextPage('prev', 2, 4), 1);
    assert.strictEqual(ui.nextPage('prev', 0, 4), 0);
    assert.strictEqual(ui.nextPage('first', 3, 4), 0);
    assert.strictEqual(ui.nextPage('last', 0, 4), 3);
    assert.strictEqual(ui.nextPage('unknown', 2, 4), 2);
});

// --- command embeds ----------------------------------------------------------

test('help lists every command with the prefix', () => {
    const text = flatten(ui.helpPayload());
    for (const cmd of ['help', 'stats', 'add-token', 'remove-token', 'toggle', 'start-all', 'stop-all', 'grant', 'revoke', 'reset-stats', 'export-stats']) {
        assert.ok(text.includes(cmd), `missing ${cmd}`);
    }
});

test('status embeds colour success and failure differently', () => {
    const ok = ui.statusPayload('success', 'done').embeds[0].toJSON();
    const bad = ui.statusPayload('error', 'nope').embeds[0].toJSON();
    assert.notStrictEqual(ok.color, bad.color);
    assert.match(ok.description, /done/);
    assert.match(bad.description, /nope/);
});

test('every attached asset actually exists on disk', () => {
    const payloads = [
        ui.helpPayload(),
        ui.statusPayload('success', 'x'),
        ui.statusPayload('error', 'x'),
        ui.statsPage(0, STATS, THREE),
        ui.statsPage(1, STATS, THREE),
    ];
    for (const payload of payloads) {
        for (const file of payload.files) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', file.name)), `missing ${file.name}`);
        }
    }
});

test('fmt groups thousands and tolerates junk', () => {
    assert.strictEqual(ui.fmt(1234567), '1,234,567');
    assert.strictEqual(ui.fmt(undefined), '0');
    assert.strictEqual(ui.fmt('nonsense'), '0');
});

test('pct handles a zero denominator', () => {
    assert.strictEqual(ui.pct(0, 0), '—');
    assert.strictEqual(ui.pct(1, 4), '25%');
});
