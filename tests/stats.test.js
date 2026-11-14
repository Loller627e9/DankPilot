const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { freshDataDir, load } = require('./helpers');

const dir = freshDataDir();
const { store, stats, parsing } = load();

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.abcdefghijklmnopqrstuvwx';
const BALANCE = 'Wallet: <:coin:1> 1,000  Bank: <:bank:2> 500';

test('ensure creates a blank entry named after the account', () => {
    stats.ensure(TOKEN, 'loller');
    const entry = store.loadStats().stats[TOKEN];
    assert.strictEqual(entry.name, 'loller');
    assert.strictEqual(entry.coins, 0);
    assert.strictEqual(entry.commands, 0);
});

test('ensure is idempotent and refreshes a changed username', () => {
    stats.ensure(TOKEN, 'renamed');
    stats.ensure(TOKEN, 'renamed');
    const all = store.loadStats().stats;
    assert.strictEqual(Object.keys(all).length, 1);
    assert.strictEqual(all[TOKEN].name, 'renamed');
});

test('a balance reply is counted as the high-water mark', () => {
    stats.ensure(TOKEN, 'loller');
    stats.applyReply(TOKEN, 'balance', BALANCE);
    assert.strictEqual(store.loadStats().stats[TOKEN].coins, 1500);
});

test('coins only ever rise, so spending is not counted as earning', () => {
    stats.ensure(TOKEN, 'loller');
    stats.applyReply(TOKEN, 'balance', 'Wallet: <:coin:1> 5,000  Bank: <:bank:2> 0');
    const after = store.loadStats().stats[TOKEN].coins;
    // A later, lower balance must not add anything.
    stats.applyReply(TOKEN, 'balance', 'Wallet: <:coin:1> 1,000  Bank: <:bank:2> 0');
    assert.strictEqual(store.loadStats().stats[TOKEN].coins, after);
});

test('coins accrue again once the balance passes the old mark', () => {
    const token = `${TOKEN}x`;
    stats.ensure(token, 'accrue');
    stats.applyReply(token, 'balance', 'Wallet: <:coin:1> 1,000  Bank: <:bank:2> 0');
    stats.applyReply(token, 'balance', 'Wallet: <:coin:1> 3,000  Bank: <:bank:2> 0');
    assert.strictEqual(store.loadStats().stats[token].coins, 3000);
});

test('a hunt reply counts animals, a dig reply counts items', () => {
    const token = `${TOKEN}h`;
    stats.ensure(token, 'hunter');
    stats.applyReply(token, 'hunt', 'You went hunting and brought back a **Frog**');
    stats.applyReply(token, 'dig', 'You dug in the dirt and brought back a **Rock**');
    const entry = store.loadStats().stats[token];
    assert.strictEqual(entry.animals, 1);
    assert.strictEqual(entry.items, 1);
});

test('a cooldown counts as a failure and nothing else', () => {
    const token = `${TOKEN}f`;
    stats.ensure(token, 'cooling');
    stats.applyReply(token, 'hunt', "You're on a cooldown, try again in 30 seconds");
    const entry = store.loadStats().stats[token];
    assert.strictEqual(entry.failures, 1);
    assert.strictEqual(entry.animals, 0);
    assert.strictEqual(entry.commands, 0);
});

test('recordFailure does not throw for an unknown token', () => {
    // Regression: the original dereferenced stats[token].failures and threw a
    // TypeError inside a catch block, killing the account's message handler.
    assert.doesNotThrow(() => stats.recordFailure('brand-new-token-value'));
    assert.strictEqual(store.loadStats().stats['brand-new-token-value'].failures, 1);
});

test('concurrent reply handling does not lose updates', () => {
    // Regression: the original read the stats file, awaited Discord calls, then
    // wrote the stale copy back, so overlapping replies clobbered each other.
    const token = `${TOKEN}c`;
    stats.ensure(token, 'concurrent');
    for (let i = 0; i < 25; i++) stats.recordCommand(token);
    assert.strictEqual(store.loadStats().stats[token].commands, 25);
});

test('resetStats zeroes every registered account and keeps them', () => {
    const tokens = store.loadTokens();
    tokens.tokens = [{ token: TOKEN, channelId: '1', active: true }];
    store.saveTokens(tokens);
    stats.ensure(TOKEN, 'loller');
    stats.applyReply(TOKEN, 'balance', BALANCE);
    assert.strictEqual(stats.resetStats(), true);
    const entry = store.loadStats().stats[TOKEN];
    assert.strictEqual(entry.coins, 0);
    assert.ok(entry.name, 'name is preserved');
});

test('exportStats writes a parseable file', () => {
    const file = stats.exportStats();
    assert.ok(file && fs.existsSync(file));
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('getAllStats returns the on-disk shape', () => {
    assert.ok(store.loadStats().stats);
});

test('maskToken never exposes the middle of a token', () => {
    const masked = stats.maskToken(TOKEN);
    assert.ok(!masked.includes('GhIjKl'));
    assert.match(masked, /^MTIz\.\.\./);
    assert.strictEqual(stats.maskToken(''), 'unknown');
    assert.strictEqual(stats.maskToken('short'), '***');
});

test('a zeroed data dir still yields a valid empty stats object', () => {
    fs.rmSync(`${dir}/stats.json`, { force: true });
    assert.deepStrictEqual(store.loadStats(), { stats: {} });
});
