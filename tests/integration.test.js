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
        applied: new Set(),
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
    client.emit('messageCreate', message('You went hunting and brought back a **Frog**', { replyTo: 'msg-2' }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(store.loadStats().stats[token].animals, 1);
        resolve();
    }));
});

test('a referenced dig reply records an item', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('msg-3', 'pls dig');
    client.emit('messageCreate', message('You dug in the dirt and brought back a **Rock**', { replyTo: 'msg-3' }));
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

test('a dig that finds nothing increments misses, not items', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('m-miss', 'pls dig');
    client.emit('messageCreate', message('You found nothing while digging', { replyTo: 'm-miss' }));
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.misses, 1);
        assert.strictEqual(entry.items, 0);
        assert.strictEqual(entry.failures, 0, 'a miss is not an error');
        resolve();
    }));
});

test('a hit rate is computable from catches and misses', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('h1', 'pls hunt');
    client.emit('messageCreate', message('You went hunting and brought back a **Frog**', { replyTo: 'h1' }));
    acct.pending.set('h2', 'pls hunt');
    client.emit('messageCreate', message('You found nothing while hunting', { replyTo: 'h2' }));
    acct.pending.set('h3', 'pls hunt');
    client.emit('messageCreate', message('You went hunting and brought back a **Frog**', { replyTo: 'h3' }));
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.catches, 2);
        assert.strictEqual(entry.misses, 1);
        resolve();
    }));
});

test('balance extras are stored alongside the coins', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('b1', 'pls bal');
    client.emit('messageCreate', message(
        '<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000\n<:GemsAnimated:5> 40',
        { replyTo: 'b1' }
    ));
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.lastTotal, 1850722);
        assert.strictEqual(entry.extras.gems, 40);
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

// The exact replies the original bot counted, through the real handler. These
// are the shapes that produced non-zero stats in storage/stats.json before the
// parser was narrowed, so they must keep working.
test('a numbered-list reply from the bot is counted', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('n1', 'pls hunt');
    client.emit('messageCreate', {
        author: { id: DANK, bot: true },
        channel: { id: CHANNEL },
        content: '',
        embeds: [{ description: '**1 <:Frog:123> Frog**' }],
        reference: { messageId: 'n1' },
    });
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.animals, 1);
        assert.strictEqual(entry.catches, 1);
        resolve();
    }));
});

test('a prose hunt, a prose dig and a miss are each counted', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    const emit = (key, text, replyTo) => {
        acct.pending.set(key, key.startsWith('h') ? 'pls hunt' : 'pls dig');
        client.emit('messageCreate', {
            author: { id: DANK, bot: true },
            channel: { id: CHANNEL },
            content: text,
            embeds: [],
            reference: { messageId: key },
        });
    };
    emit('h1', 'You went hunting and brought back a **Frog**', 'h1');
    return new Promise((resolve) => setImmediate(() => {
        emit('d1', 'You dug in the dirt and brought back a **Rock**', 'd1');
        setImmediate(() => {
            emit('d2', 'You found nothing while digging', 'd2');
            setImmediate(() => {
                const entry = store.loadStats().stats[token];
                assert.strictEqual(entry.animals, 1);
                assert.strictEqual(entry.items, 1);
                assert.strictEqual(entry.catches, 2);
                assert.strictEqual(entry.misses, 1);
                resolve();
            });
        });
    }));
});

test('a Dank Memer reply in another channel is recorded, not counted', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('keep', 'pls hunt');
    client.emit('messageCreate', message('You went hunting and brought back a **Frog**', { replyTo: 'keep', channelId: '999999999999999999' }));
    return new Promise((resolve) => setImmediate(() => {
        assert.strictEqual(acct.pending.has('keep'), true, 'the slot is untouched');
        const seen = grinder.foreignChannels().map((c) => c.channelId);
        assert.ok(seen.includes('999999999999999999'), 'the other channel is noted for /debug');
        resolve();
    }));
});

test('an edited reply is counted once, not twice', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('e1', 'pls hunt');
    const msg = {
        id: 'edit-1',
        author: { id: DANK, bot: true },
        channel: { id: CHANNEL },
        content: '',
        embeds: [{ description: '**1 <:Frog:1> Frog**' }],
        reference: { messageId: 'e1' },
    };
    client.emit('messageCreate', msg);
    return new Promise((resolve) => setImmediate(() => {
        // The same message arrives again as an edit, with the final content.
        client.emit('messageUpdate', null, msg);
        setImmediate(() => {
            const entry = store.loadStats().stats[token];
            assert.strictEqual(entry.animals, 1, 'counted exactly once');
            resolve();
        });
    }));
});

test('a result that only arrives on edit is still counted', () => {
    const { client, token } = newAccount();
    const acct = grinder._accounts.get(token);
    acct.pending.set('d9', 'pls dig');
    // The create carries no result yet; the edit fills it in.
    client.emit('messageUpdate', null, {
        id: 'edit-2',
        author: { id: DANK, bot: true },
        channel: { id: CHANNEL },
        content: 'You dug in the dirt and brought back a **Rock**',
        embeds: [],
        reference: { messageId: 'd9' },
    });
    return new Promise((resolve) => setImmediate(() => {
        const entry = store.loadStats().stats[token];
        assert.strictEqual(entry.items, 1);
        resolve();
    }));
});

test('an account that sends but never reads is flagged deaf', async () => {
    const { token } = newAccount();
    const acct = grinder._accounts.get(token);
    // Simulate sends with no readable reply. sendCommand needs a channel, so
    // count directly the way the send path does.
    acct.label = 'deaf-test';
    for (let i = 0; i < 8; i++) acct.sent = (acct.sent || 0) + 1;
    const status = grinder.accountStatus().find((a) => a.label === 'deaf-test');
    assert.strictEqual(status.sent, 8);
    assert.strictEqual(status.read, 0);
    assert.strictEqual(status.deaf, true, 'eight sends with no reads is the zero-stats failure');

    // One read clears it.
    acct.read = 1;
    const after = grinder.accountStatus().find((a) => a.label === 'deaf-test');
    assert.strictEqual(after.deaf, false);
});
