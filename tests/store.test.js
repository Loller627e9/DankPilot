const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshDataDir, load } = require('./helpers');

const dir = freshDataDir();
const { store } = load();

test('loadTokens returns an empty list when the file is missing', () => {
    assert.deepStrictEqual(store.loadTokens(), { tokens: [] });
});

test('loadTokens survives a corrupt file instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'tokens.json'), '{ this is not json');
    assert.deepStrictEqual(store.loadTokens(), { tokens: [] });
});

test('loadTokens survives a file with the wrong shape', () => {
    fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ tokens: 'nope' }));
    assert.deepStrictEqual(store.loadTokens(), { tokens: [] });
});

test('a write is atomic: no temp file is left behind', () => {
    store.saveTokens({ tokens: [{ token: 'a', channelId: '1', active: true }] });
    const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    assert.deepStrictEqual(leftovers, []);
    assert.strictEqual(store.loadTokens().tokens.length, 1);
});

test('loadAccess falls back to OWNER_ID when access.json is missing', () => {
    process.env.OWNER_ID = '1289854729324724304';
    const { store: s2 } = load();
    const access = s2.loadAccess();
    assert.strictEqual(access.ownerId, '1289854729324724304');
    assert.deepStrictEqual(access.authorizedUsers, []);
});

test('loadAccess normalises numeric ids to strings', () => {
    store.saveAccess({ ownerId: 123, authorizedUsers: [456] });
    const access = store.loadAccess();
    assert.strictEqual(access.ownerId, '123');
    assert.deepStrictEqual(access.authorizedUsers, ['456']);
});

test('loadAccess repairs a file whose authorizedUsers is missing', () => {
    store.writeJson(store.ACCESS_PATH, { ownerId: '9' });
    assert.deepStrictEqual(store.loadAccess().authorizedUsers, []);
});

test('blankStats has every field the UI reads', () => {
    const blank = store.blankStats('x');
    for (const key of ['name', 'commands', 'coins', 'lastTotal', 'catches', 'items', 'animals', 'failures']) {
        assert.ok(key in blank, `missing ${key}`);
    }
});

test('the data directory is created on demand', () => {
    const nested = path.join(dir, 'a', 'b');
    process.env.DATA_DIR = nested;
    const { store: s3 } = load();
    assert.strictEqual(s3.ensureDir(), true);
    assert.ok(fs.existsSync(nested));
});
