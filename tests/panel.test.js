// The interactive panel: page tracking, clamping, and the message payload.
const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

freshDataDir();
const { panel, store, ui } = load();

function seed(count) {
    const tokens = [];
    for (let i = 0; i < count; i++) {
        tokens.push({ token: `tok-${i}`, channelId: String(1000 + i), active: true });
    }
    store.saveTokens({ tokens });
    const stats = { stats: {} };
    for (const t of tokens) {
        stats.stats[t.token] = { name: `acct-${t.token}`, coins: 10, animals: 1, items: 1, commands: 1, catches: 1, misses: 0 };
    }
    store.saveStats(stats);
    return tokens;
}

function footerOf(message) {
    return message.embeds[0].toJSON().footer.text;
}

test('the panel message carries the nav buttons', () => {
    seed(3);
    const message = panel.message(0);
    assert.strictEqual(message.components.length, 1);
    assert.strictEqual(message.components[0].components.length, 4);
});

test('there is no start/stop button in the panel message', () => {
    seed(2);
    const message = panel.message(0);
    const ids = message.components[0].components.map(c => c.data.custom_id);
    assert.ok(!ids.some(id => /start|stop|toggle/i.test(id)));
});

test('a single account still shows the nav row', () => {
    seed(1);
    assert.strictEqual(panel.message(0).components.length, 1);
});

test('no accounts means no nav row', () => {
    store.saveTokens({ tokens: [] });
    assert.strictEqual(panel.message(0).components.length, 0);
});

test('currentPage moves forward and clamps at the end', () => {
    seed(3); // 4 pages
    assert.strictEqual(panel.currentPage('next', 0).page, 1);
    assert.strictEqual(panel.currentPage('next', 3).page, 3, 'clamped at the last page');
    assert.strictEqual(panel.currentPage('last', 0).page, 3);
    assert.strictEqual(panel.currentPage('first', 3).page, 0);
});

test('currentPage cannot be pushed past the end after accounts are removed', () => {
    seed(5); // 6 pages
    assert.strictEqual(panel.currentPage('last', 0).page, 5);
    seed(1); // now 2 pages
    assert.strictEqual(panel.currentPage('next', 5).page, 1, 'clamped to the new last page');
});

test('pageFromMessage recovers the page from the footer', () => {
    seed(3);
    for (let p = 0; p < 4; p++) {
        assert.strictEqual(panel.pageFromMessage(panel.message(p)), p);
    }
});

test('pageFromMessage tolerates a message with no footer', () => {
    assert.strictEqual(panel.pageFromMessage({ embeds: [] }), 0);
    assert.strictEqual(panel.pageFromMessage({}), 0);
    assert.strictEqual(panel.pageFromMessage(null), 0);
});

test('a nav press round-trips through the footer', () => {
    seed(3);
    const first = panel.message(0);
    const next = panel.currentPage('next', panel.pageFromMessage(first)).page;
    const second = panel.message(next);
    assert.strictEqual(next, 1);
    assert.strictEqual(panel.pageFromMessage(second), 1);
    assert.match(footerOf(second), /page 2 of 4/);
});

test('the running provider marks accounts as farming', () => {
    seed(2);
    panel.setRunningProvider(() => new Set(['tok-0']));
    const text = panel.message(0).embeds[0].toJSON().description;
    assert.match(text, /acct-tok-0/);
    panel.setRunningProvider(() => new Set());
});

test('a throwing running provider does not break the panel', () => {
    seed(1);
    panel.setRunningProvider(() => { throw new Error('grinder down'); });
    assert.doesNotThrow(() => panel.message(0));
    panel.setRunningProvider(() => new Set());
});

test('the panel reflects stats written by the stats module', () => {
    seed(1);
    const { stats } = load();
    stats.applyReply('tok-0', 'hunt', 'You went hunting and brought back a **Frog**');
    const message = panel.message(1);
    assert.match(message.embeds[0].toJSON().fields.map(f => f.value).join(' '), /\*\*1\*\*/);
});
