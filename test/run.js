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

test('statsPayload shows every account even without a stats entry', () => {
    const tokens = { tokens: [{ token: 'tok', channelId: '1', active: true }, { token: 'tok2', channelId: '1', active: false }] };
    const payload = ui.statsPayload({ stats: {} }, tokens, true);
    assert.ok(payload.embeds[0].data.description.includes('#0'));
    assert.ok(payload.embeds[0].data.description.includes('#1'), 'inactive account must still be listed');
});

test('statsPayload marks running accounts from the live token set', () => {
    const tokens = { tokens: [{ token: 'tok', channelId: '1', active: false }] };
    const stats = { stats: { tok: { name: 'tester', coins: 0, commands: 0, items: 0, animals: 0, failures: 0 } } };
    const payload = ui.statsPayload(stats, tokens, false, new Set(['tok']));
    assert.ok(payload.embeds[0].data.description.includes('🟢'), 'live client should show as running');
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

test('parseCoins reads wallet and bank across formats', () => {
    assert.deepStrictEqual(grinder.parseCoins('<:Coin:1> 1,234 <:Bank:2> 5,678'), { wallet: 1234, bank: 5678 });
    assert.deepStrictEqual(grinder.parseCoins('Wallet: 1,234\nBank: 5,678'), { wallet: 1234, bank: 5678 });
    assert.deepStrictEqual(grinder.parseCoins('1,234 wallet | 5,678 bank'), { wallet: 1234, bank: 5678 });
});

test('classifyReply maps commands to stat kinds', () => {
    assert.strictEqual(grinder.classifyReply('pls bal', ''), 'balance');
    assert.strictEqual(grinder.classifyReply('pls hunt', ''), 'hunt');
    assert.strictEqual(grinder.classifyReply('pls dig', ''), 'dig');
    assert.strictEqual(grinder.classifyReply('pls beg', 'You got 5 coins'), 'other');
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

test('addToken registers inactive and does not start farming', () => {
    const g = require('../grinder');
    g.addToken('tokA', '111111111111111111');
    const tokens = require('../store').readJSON(require('../config').tokensPath, { tokens: [] });
    const entry = tokens.tokens.find(t => t.token === 'tokA');
    assert.ok(entry, 'token should be registered');
    assert.strictEqual(entry.active, false, 'must be added inactive');
    assert.strictEqual(g.getActiveCount(), 0, 'no client should be running');
});

test('toggleToken deactivates and persists the flag', async () => {
    const g = require('../grinder');
    const cfg = require('../config');
    const store = require('../store');
    const idx = store.readJSON(cfg.tokensPath, { tokens: [] }).tokens.findIndex(t => t.token === 'tokA');

    // Mark active by hand so we exercise the stop path (no login/network).
    const data = store.readJSON(cfg.tokensPath, { tokens: [] });
    data.tokens[idx].active = true;
    store.writeJSON(cfg.tokensPath, data);

    const res = await g.toggleToken(idx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.active, false, 'toggle should report the new state');
    assert.strictEqual(store.readJSON(cfg.tokensPath, { tokens: [] }).tokens[idx].active, false);
});

test('toggleToken reports failure for a missing index', async () => {
    const g = require('../grinder');
    const res = await g.toggleToken(9999);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.active, false);
});

test('jittered always returns at least the base and stays within the spread', () => {
    const g = require('../grinder');
    for (let i = 0; i < 200; i++) {
        const v = g.jittered(1000, 500);
        assert.ok(v >= 1000 && v < 1500, `out of range: ${v}`);
    }
    assert.strictEqual(g.jittered(1000, 0), 1000, 'no spread means no jitter');
});

test('backoffDelay grows with attempts and respects the cap', () => {
    const g = require('../grinder');
    const cfg = require('../config');
    for (let attempt = 1; attempt <= 10; attempt++) {
        const d = g.backoffDelay(attempt);
        assert.ok(d >= 5000, `too small: ${d}`);
        assert.ok(d <= cfg.maxBackoff + 3000, `exceeds cap: ${d}`);
    }
    assert.ok(g.backoffDelay(8) >= g.backoffDelay(1), 'should not shrink');
});

test('runCommandCycle reschedules while active even when not ready', async () => {
    const g = require('../grinder');
    const token = 'cycleTok';
    // A fake client that is never ready - the old code returned early here and
    // never set another timer, which is what silently stopped farming.
    const fake = {
        _farmToken: token,
        isReady: () => false,
        channels: { fetch: async () => ({ send: async () => ({ id: 'x' }) }) }
    };
    g._test.activeClients.set(token, fake);
    try {
        await g.runCommandCycle(fake, 'chan');
        assert.ok(fake._cycleTimer, 'a follow-up cycle must be scheduled');
        assert.strictEqual(fake._lastCycleAt > 0, true, 'cycle timestamp should update');
    } finally {
        g._test.clearCycleTimer(fake);
        g._test.activeClients.delete(token);
    }
});

test('runCommandCycle does not reschedule once the client is stopped', async () => {
    const g = require('../grinder');
    const fake = { _farmToken: 'stoppedTok', isReady: () => true, channels: { fetch: async () => ({ send: async () => ({ id: 'x' }) }) } };
    // Not in activeClients: the account was stopped.
    await g.runCommandCycle(fake, 'chan');
    assert.strictEqual(fake._cycleTimer, undefined, 'stopped clients must not loop');
});

test('configured client identity is applied to the selfbot options', () => {
    const { Client } = require('discord.js-selfbot-v13');
    const cfg = require('../config');
    const client = new Client({
        checkUpdate: false,
        ws: { properties: { client_build_number: cfg.clientBuildNumber, client_version: cfg.clientVersion } }
    });
    assert.strictEqual(client.options.ws.properties.client_build_number, cfg.clientBuildNumber);
    assert.strictEqual(client.options.ws.properties.client_version, cfg.clientVersion);
    // Overriding must not drop the other identity fields the library sets.
    assert.ok(client.options.ws.properties.browser_user_agent, 'UA must survive the merge');
    assert.ok(client.options.ws.properties.os, 'os must survive the merge');
});

test('applyStats credits coins, animals and items to the right account', () => {
    const g = require('../grinder');
    const statsPath = require('../config').statsPath;
    g.initializeStats('tokB', 'farmer');
    g.applyStats('tokB', 'balance', 'Wallet: 1,000\nBank: 4,000');
    g.applyStats('tokB', 'hunt', 'You caught a **12 <:Rabbit:123> Rabbit**!');
    g.applyStats('tokB', 'dig', 'You found a **3 <:Rare:1> Rare Pepe**!');
    const s = require('../store').readJSON(statsPath, { stats: {} }).stats.tokB;
    assert.strictEqual(s.coins, 5000, 'wallet+bank should be credited');
    assert.strictEqual(s.animals, 1);
    assert.strictEqual(s.items, 1);
    // A later, smaller balance must not reduce accumulated coins.
    g.applyStats('tokB', 'balance', 'Wallet: 10\nBank: 10');
    assert.strictEqual(require('../store').readJSON(statsPath, { stats: {} }).stats.tokB.coins, 5000);
});

test('applyStats never touches an unknown account', () => {
    const g = require('../grinder');
    const statsPath = require('../config').statsPath;
    const before = JSON.stringify(require('../store').readJSON(statsPath, { stats: {} }));
    g.applyStats('not-registered', 'balance', 'Wallet: 999');
    const after = JSON.stringify(require('../store').readJSON(statsPath, { stats: {} }));
    assert.strictEqual(after, before);
});

(async () => {
    for (const [name, promise] of pending) {
        try { await promise; console.log(`  ok  ${name}`); passed++; }
        catch (err) { console.error(`FAIL  ${name}: ${err.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} test(s) passed`);
    fs.rmSync(DATA, { recursive: true, force: true });
})();
