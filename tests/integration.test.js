// End-to-end check of the farming path.
//
// This drives the *real* reply handler and the *real* stats accounting with a
// fake Discord client, which is the path that was silently recording nothing
// (the dashboard showed 0 for every account). Only the gateway is faked.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { freshDataDir, load } = require('./helpers');

const dir = freshDataDir();
const { store, stats, grinder } = load();

const TOKEN = 'FAKE-TOKEN-VALUE-abcdefghijklmnop';
const CHANNEL = '1372122677669527653';
const DANK = grinder.DANK_MEMER_ID;

// A stand-in for the selfbot client: an emitter with the two members the
// handler touches.
function fakeClient() {
    const client = new EventEmitter();
    client.isReady = () => true;
    client.user = { id: '999', username: 'farmer', tag: 'farmer#0001' };
    return client;
}

function message(text, { replyTo = null, channelId = CHANNEL } = {}) {
    return {
        author: { id: DANK, bot: true },
        channel: { id: channelId },
        content: text,
        embeds: [],
        reference: replyTo ? { messageId: replyTo } : null,
    };
}

function newAccount() {
    const client = fakeClient();
    const token = `${TOKEN}-${Math.random().toString(36).slice(2)}`;
    grinder._accounts.set(token, {
        client,
        channelId: CHANNEL,
        timer: null,
        pending: new Map(),
        lastActivity: Date.now(),
    });
    grinder._bindMessageHandler(token, CHANNEL, client);
    stats.ensure(token, 'farmer');
    return { client, token };
}

test('a referenced balance reply is recorded against the account', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-1', 'pls bal');
    client.emit('messageCreate', message('Wallet: <:coin:1> 2,000  Bank: <:bank:2> 3,000', { replyTo: 'msg-1' }));
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.coins, 5000, 'coins were recorded');
        resolve();
    }));
});

test('a referenced hunt reply records an animal', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-2', 'pls hunt');
    client.emit('messageCreate', message('**1 <:Frog:1> Frog**', { replyTo: 'msg-2' }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].animals, 1);
        resolve();
    }));
});

test('a referenced dig reply records an item', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-3', 'pls dig');
    client.emit('messageCreate', message('**1 <:Rock:1> Rock**', { replyTo: 'msg-3' }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].items, 1);
        resolve();
    }));
});

test('a reply to a command we never sent is ignored', () => {
    const { client, token } = newAccount();
    client.emit('messageCreate', message('Wallet: <:coin:1> 9,999  Bank: <:bank:2> 9,999', { replyTo: 'unknown-id' }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 0);
        resolve();
    }));
});

test('an unreferenced result is attributed to the oldest pending command', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('oldest', 'pls bal');
    acct.pending.set('newest', 'pls hunt');
    client.emit('messageCreate', message('Wallet: <:coin:1> 100  Bank: <:bank:2> 0'));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 100);
        assert.strictEqual(acct.pending.has('oldest'), false, 'the slot was consumed');
        assert.strictEqual(acct.pending.has('newest'), true, 'the newer one is untouched');
        resolve();
    }));
});

test('an unreferenced unrelated message does not consume a pending slot', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('keep-me', 'pls bal');
    client.emit('messageCreate', message('Good morning everyone!'));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(acct.pending.has('keep-me'), true, 'slot preserved for the real reply');
        resolve();
    }));
});

test('a reply in a different channel is ignored', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-9', 'pls bal');
    client.emit('messageCreate', message('Wallet: <:coin:1> 500  Bank: <:bank:2> 500', {
        replyTo: 'msg-9', channelId: '000000000000000001',
    }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 0);
        resolve();
    }));
});

test('a message from anyone other than Dank Memer is ignored', () => {
    const { client, token } = newAccount();
    const other = message('Wallet: <:coin:1> 1  Bank: <:bank:2> 1');
    other.author.id = '12345';
    client.emit('messageCreate', other);
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 0);
        resolve();
    }));
});

test('a cooldown reply is recorded as a failure, not as coins', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-cd', 'pls hunt');
    client.emit('messageCreate', message("You're on a cooldown, try again in 30 seconds", { replyTo: 'msg-cd' }));
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.failures, 1);
        assert.strictEqual(entry.animals, 0);
        resolve();
    }));
});

test('an embed-only reply is parsed, since results live in embeds', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-e', 'pls bal');
    const msg = message('', { replyTo: 'msg-e' });
    msg.embeds = [{ description: 'Wallet: <:coin:1> 7,000  Bank: <:bank:2> 1,000' }];
    client.emit('messageCreate', msg);
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 8000);
        resolve();
    }));
});

test('a throwing counter does not escape the handler', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    // Make the stats read blow up mid-handling.
    const realLoad = store.loadStats;
    store.loadStats = () => { throw new Error('disk on fire'); };
    acct.pending.set('msg-x', 'pls bal');
    assert.doesNotThrow(() => {
        client.emit('messageCreate', message('Wallet: <:coin:1> 1  Bank: <:bank:2> 1', { replyTo: 'msg-x' }));
    });
    store.loadStats = realLoad;
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].coins, 0);
        resolve();
    }));
});

test('the seeded accounts from FARM_ACCOUNTS end up farmable', () => {
    // The whole point: after a restart on a free host, the accounts must come
    // back so the dashboard stops showing 0.
    process.env.FARM_ACCOUNTS = 'seed-tok-1:111111111111111111,seed-tok-2:222222222222222222';
    const { grinder: fresh, store: freshStore } = load();
    assert.strictEqual(fresh.seedFromEnv(), 2);
    const tokens = freshStore.loadTokens().tokens.filter(t => t.token.startsWith('seed-tok-'));
    assert.strictEqual(tokens.length, 2);
    assert.ok(tokens.every(t => t.active), 'seeded accounts are active, so they start');
    delete process.env.FARM_ACCOUNTS;
});

test('the data directory the tests used is a throwaway', () => {
    assert.ok(dir.includes('dankfarm-test-'));
});
