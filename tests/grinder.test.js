const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

freshDataDir();

test('addToken registers an account, inactive by default', () => {
    const { store, grinder } = load();
    assert.strictEqual(grinder.addToken('tok-1', '111'), true);
    const [entry] = store.loadTokens().tokens;
    assert.deepStrictEqual(entry, { token: 'tok-1', channelId: '111', active: false });
});

test('addToken refuses a duplicate', () => {
    const { grinder } = load();
    assert.strictEqual(grinder.addToken('tok-1', '111'), false);
});

test('seedFromEnv adds missing accounts and marks them active', () => {
    withEnv({ FARM_ACCOUNTS: 'tok-a:222,tok-b:333' }, () => {
        const { store, grinder } = load();
        const added = grinder.seedFromEnv();
        assert.strictEqual(added, 2);
        const tokens = store.loadTokens().tokens;
        assert.deepStrictEqual(tokens.filter(t => t.token === 'tok-a')[0], {
            token: 'tok-a', channelId: '222', active: true,
        });
    });
});

test('seedFromEnv is idempotent', () => {
    withEnv({ FARM_ACCOUNTS: 'tok-a:222,tok-b:333' }, () => {
        const { store, grinder } = load();
        assert.strictEqual(grinder.seedFromEnv(), 0);
        assert.strictEqual(store.loadTokens().tokens.filter(t => t.token === 'tok-a').length, 1);
    });
});

test('seedFromEnv skips malformed entries without throwing', () => {
    withEnv({ FARM_ACCOUNTS: 'no-colon-here,tok-c:not-numeric,tok-d:444' }, () => {
        const { store, grinder } = load();
        const added = grinder.seedFromEnv();
        assert.strictEqual(added, 1);
        assert.ok(store.loadTokens().tokens.some(t => t.token === 'tok-d'));
        assert.ok(!store.loadTokens().tokens.some(t => t.token === 'no-colon-here'));
        assert.ok(!store.loadTokens().tokens.some(t => t.token === 'tok-c'));
    });
});

test('seedFromEnv does nothing when FARM_ACCOUNTS is empty', () => {
    withEnv({ FARM_ACCOUNTS: '' }, () => {
        const { grinder } = load();
        assert.strictEqual(grinder.seedFromEnv(), 0);
    });
});

test('removeToken deletes the account and its stats', () => {
    withEnv({ FARM_ACCOUNTS: '' }, () => {
        const { store, stats, grinder } = load();
        store.saveTokens({ tokens: [{ token: 'gone', channelId: '1', active: false }] });
        stats.ensure('gone', 'someone');
        return grinder.removeToken(0).then((ok) => {
            assert.strictEqual(ok, true);
            assert.deepStrictEqual(store.loadTokens().tokens, []);
            assert.strictEqual(store.loadStats().stats.gone, undefined);
        });
    });
});

test('removeToken rejects an out-of-range index', async () => {
    const { grinder } = load();
    assert.strictEqual(await grinder.removeToken(99), false);
    assert.strictEqual(await grinder.removeToken(-1), false);
});

test('toggleToken deactivates an active account without a live client', async () => {
    const { store, grinder } = load();
    store.saveTokens({ tokens: [{ token: 'on-1', channelId: '5', active: true }] });
    const off = await grinder.toggleToken(0);
    assert.deepStrictEqual(off, { ok: true, active: false });
    assert.strictEqual(store.loadTokens().tokens[0].active, false);
});

test('toggleToken rolls the flag back when the login fails', async () => {
    // The account must not be left marked active if it never connected,
    // otherwise a restart would keep retrying a dead token forever.
    const { store, grinder } = load();
    store.saveTokens({ tokens: [{ token: 'not-a-real-token', channelId: '5', active: false }] });
    const res = await grinder.toggleToken(0);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.active, false);
    assert.strictEqual(store.loadTokens().tokens[0].active, false);
});

test('toggleToken rejects an out-of-range index', async () => {
    const { grinder } = load();
    assert.strictEqual(await grinder.toggleToken(42), false);
});

test('runningTokens reports nothing when no client has logged in', () => {
    const { grinder } = load();
    assert.strictEqual(grinder.runningTokens().size, 0);
});

test('maskToken hides the body of a real token', () => {
    const { grinder } = load();
    const masked = grinder.maskToken('ABCDEFGHIJKLMNOP.secret.SECRETPART');
    assert.ok(!masked.includes('secret'));
});

test('a reply is matched to the command that produced it, not guessed from wording', () => {
    // The command is known from the pending map, so the wording never has to be
    // classified: the same hit text counts as an item for a dig and an animal
    // for a hunt.
    const P = require('../parsing');
    const hit = 'You dug in the dirt and brought back a **Rock**';
    assert.deepStrictEqual(P.parseLoot(hit, 'dig').items, ['Rock']);
    assert.deepStrictEqual(P.parseLoot(hit, 'hunt').animals, ['Rock']);
});

