const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

freshDataDir();
const OWNER = '1289854729324724304';
process.env.OWNER_ID = OWNER;
const { handlers, store, stats } = load();

// A minimal stand-in for a Discord message. Only the surface the handler uses
// is provided; everything else is the real project code.
function fakeMessage(content, authorId = OWNER) {
    const sent = [];
    return {
        content,
        author: { id: authorId, bot: false },
        sent,
        reply(payload) {
            sent.push(payload);
            return Promise.resolve(payload);
        },
    };
}

function textOf(payload) {
    if (typeof payload === 'string') return payload;
    return payload.embeds[0].toJSON().description || '';
}

test('a non-prefixed message is ignored', async () => {
    const msg = fakeMessage('hello there');
    await handlers.handleCommand(msg);
    assert.strictEqual(msg.sent.length, 0);
});

test('an unauthorised user is refused', async () => {
    const msg = fakeMessage('$help', '999');
    await handlers.handleCommand(msg);
    assert.match(msg.sent[0], /No permission/);
});

test('the owner can run help and gets the styled embed', async () => {
    const msg = fakeMessage('$help');
    await handlers.handleCommand(msg);
    const payload = msg.sent[0];
    assert.ok(payload.embeds, 'help returns an embed payload');
    assert.match(payload.embeds[0].toJSON().title, /Commands/);
});

test('the owner can run stats', async () => {
    const msg = fakeMessage('$stats');
    await handlers.handleCommand(msg);
    assert.ok(msg.sent[0].embeds);
});

test('an unknown command is reported', async () => {
    const msg = fakeMessage('$nonsense');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Unknown command/);
});

test('add-token rejects a non-numeric channel id', async () => {
    const msg = fakeMessage('$add-token abc.def.ghi not-a-channel');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /must be numeric/);
    assert.deepStrictEqual(store.loadTokens().tokens, []);
});

test('add-token reports a failed login and leaves no account behind', async () => {
    const msg = fakeMessage('$add-token not-a-real-token 123456789012345678');
    await handlers.handleCommand(msg);
    // The token is stored so it can be retried, but it must be marked inactive.
    const tokens = store.loadTokens().tokens;
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].active, false);
    assert.match(textOf(msg.sent[0]), /Login failed|Added/);
});

test('remove-token with a bad index reports failure', async () => {
    const msg = fakeMessage('$remove-token 99');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Failed to remove/);
});

test('remove-token with a non-number is rejected', async () => {
    const msg = fakeMessage('$remove-token abc');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Invalid index/);
});

test('grant and revoke round-trip an authorised user', async () => {
    const granted = fakeMessage(`$grant <@123456789012345678>`);
    await handlers.handleCommand(granted);
    assert.match(textOf(granted.sent[0]), /Granted access/);
    assert.ok(store.loadAccess().authorizedUsers.includes('123456789012345678'));

    // The granted user can now run commands.
    const asUser = fakeMessage('$stats', '123456789012345678');
    await handlers.handleCommand(asUser);
    assert.ok(asUser.sent[0].embeds, 'granted user got a stats embed');

    const revoked = fakeMessage(`$revoke <@123456789012345678>`);
    await handlers.handleCommand(revoked);
    assert.match(textOf(revoked.sent[0]), /Revoked access/);
    assert.ok(!store.loadAccess().authorizedUsers.includes('123456789012345678'));
});

test('granting the same user twice is refused', async () => {
    await handlers.handleCommand(fakeMessage('$grant <@555555555555555555>'));
    const again = fakeMessage('$grant <@555555555555555555>');
    await handlers.handleCommand(again);
    assert.match(textOf(again.sent[0]), /Already has access/);
});

test('revoking a user who was never granted is refused', async () => {
    const msg = fakeMessage('$revoke <@777777777777777777>');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Not authorized/);
});

test('grant without a mention explains the usage', async () => {
    const msg = fakeMessage('$grant');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Usage/);
});

test('reset-stats zeroes the recorded numbers', async () => {
    // resetStats rebuilds from the registered accounts, so the account has to
    // be registered first — the same contract the original bot had.
    store.saveTokens({ tokens: [{ token: 'tok-reset', channelId: '1', active: true }] });
    stats.ensure('tok-reset', 'resetme');
    stats.applyReply('tok-reset', 'balance', 'Wallet: <:coin:1> 500  Bank: <:bank:2> 500');
    assert.strictEqual(store.loadStats().stats['tok-reset'].coins, 1000);
    const msg = fakeMessage('$reset-stats');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Stats reset/);
    assert.strictEqual(store.loadStats().stats['tok-reset'].coins, 0);
});

test('export-stats reports a filename', async () => {
    const msg = fakeMessage('$export-stats');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /stats_export_/);
});

test('stop-all is safe when nothing is running', async () => {
    const msg = fakeMessage('$stop-all');
    await handlers.handleCommand(msg);
    assert.match(textOf(msg.sent[0]), /Stopped 0/);
});

test('hasPermission matches the owner and authorised users only', () => {
    assert.strictEqual(handlers.hasPermission(OWNER), true);
    assert.strictEqual(handlers.hasPermission('nobody'), false);
    assert.strictEqual(handlers.hasPermission(undefined), false);
    assert.strictEqual(handlers.hasPermission(null), false);
});

test('the owner keeps access when access.json is missing entirely', () => {
    // Regression: the original read access.json with no fallback, so on a fresh
    // clone the owner was locked out of every command.
    const fs = require('fs');
    fs.rmSync(store.ACCESS_PATH, { force: true });
    const { handlers: fresh } = load();
    assert.strictEqual(fresh.hasPermission(OWNER), true);
});
