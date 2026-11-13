// Dependency-free smoke test. Verifies the modules load, the embed payloads
// build, and a full command flows through handleCommand with a fake message.
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test-token';
process.env.OWNER_ID = process.env.OWNER_ID || '1289854729324724304';
process.env.DATA_DIR = 'storage-test';
process.env.KEEP_ALIVE = 'false';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = require('../ui');
const grinder = require('../grinder');
const handlers = require('../handlers');

const DATA = path.join(__dirname, '..', 'storage-test');
fs.rmSync(DATA, { recursive: true, force: true });
require('../store').initStorage();

let passed = 0;
const pending = [];
function test(name, fn) {
    try {
        const out = fn();
        if (out && typeof out.then === 'function') { pending.push([name, out]); return; }
        console.log(`  ok  ${name}`); passed++;
    } catch (err) { console.error(`FAIL  ${name}: ${err.message}`); process.exitCode = 1; }
}

test('helpPayload builds an embed + banner', () => {
    const payload = ui.helpPayload(true);
    assert.strictEqual(payload.embeds.length, 1);
    assert.strictEqual(payload.files.length, 1);
    assert.ok(payload.embeds[0].data.title.includes('Command Center'));
});

test('statusPayload sets success/error colors', () => {
    assert.strictEqual(ui.statusPayload('success', 'hi').embeds[0].data.color, 0x50E682);
    assert.strictEqual(ui.statusPayload('error', 'hi').embeds[0].data.color, 0xF0505A);
});

test('statsPayload handles empty stats', () => {
    const payload = ui.statsPayload({ stats: {} }, { tokens: [] }, true);
    assert.ok(payload.embeds[0].data.description.includes('No stats yet'));
});

test('statsPayload totals accounts', () => {
    const stats = { stats: { tok: { name: 'tester', coins: 1000, commands: 4, items: 2, animals: 3, failures: 1 } } };
    const tokens = { tokens: [{ token: 'tok', channelId: '1', active: true }] };
    const payload = ui.statsPayload(stats, tokens, true);
    const fields = payload.embeds[0].data.fields;
    assert.ok(fields.find(f => f.name.includes('Coins') && f.value.includes('1,000')));
    assert.ok(payload.files.length === 1);
});

test('emoji fallback returns unicode when no custom set', () => {
    const E = require('../emojis');
    assert.strictEqual(E.get('dk_coin', false), '💰');
    assert.strictEqual(E.get('does_not_exist', false), '');
});

test('maskToken hides the middle of a token', () => {
    assert.strictEqual(grinder.maskToken('abcdefghijklmnop'), 'abcd...mnop');
    assert.strictEqual(grinder.maskToken(''), 'INVALID_TOKEN');
});

test('handleCommand ignores non-commands and blocks strangers', async () => {
    const replies = [];
    const message = { content: 'hello', author: { id: '999' }, guild: {}, reply: m => { replies.push(m); return Promise.resolve(); } };
    await handlers.handleCommand(message);
    assert.strictEqual(replies.length, 0, 'plain chat must be ignored');
});

test('handleCommand rejects unauthorized users', async () => {
    const replies = [];
    const message = { content: '$help', author: { id: '999' }, guild: {}, reply: m => { replies.push(m); return Promise.resolve(); } };
    await handlers.handleCommand(message);
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].embeds[0].data.description.includes('permission'));
});

test('handleCommand answers $help for the owner', async () => {
    const replies = [];
    const message = { content: '$help', author: { id: process.env.OWNER_ID }, guild: {}, reply: m => { replies.push(m); return Promise.resolve(); } };
    await handlers.handleCommand(message);
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].embeds[0].data.title.includes('Command Center'));
});

test('handleCommand reports unknown commands', async () => {
    const replies = [];
    const message = { content: '$nope', author: { id: process.env.OWNER_ID }, guild: {}, reply: m => { replies.push(m); return Promise.resolve(); } };
    await handlers.handleCommand(message);
    assert.ok(replies[0].embeds[0].data.description.includes('Unknown command'));
});

test('parseLoot handles custom and plain loot lines', () => {
    assert.deepStrictEqual(grinder.parseLoot('You caught a **12 <:Rabbit:123> Rabbit**!').animals, ['Rabbit']);
    assert.deepStrictEqual(grinder.parseLoot('You caught a **12 Rabbit**!').animals, ['Rabbit']);
});

test('parseCoins reads wallet and bank', () => {
    assert.deepStrictEqual(grinder.parseCoins('<:Coin:1> 1,234 <:Bank:2> 5,678'), { wallet: 1234, bank: 5678 });
});

test('emoji sync is a no-op without a token (never throws)', async () => {
    const saved = process.env.BOT_TOKEN;
    process.env.BOT_TOKEN = '';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../upload-emojis')];
    const sync = require('../upload-emojis').sync;
    const result = await sync({ log: () => {} });
    assert.strictEqual(result.uploaded, 0);
    process.env.BOT_TOKEN = saved;
});

(async () => {
    for (const [name, promise] of pending) {
        try { await promise; console.log(`  ok  ${name}`); passed++; }
        catch (err) { console.error(`FAIL  ${name}: ${err.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} test(s) passed`);
    fs.rmSync(DATA, { recursive: true, force: true });
})();
