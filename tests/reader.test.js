// The inbound reader: what it extracts, and which messages it accepts.
const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

freshDataDir();
const { reader, grinder } = load();
const DANK = grinder.DANK_MEMER_ID;

// Minimal stand-ins for the discord.js-selfbot-v13 message shape. Embeds and
// components expose toJSON(), exactly as the library does.
function msg(over = {}) {
    return Object.assign({
        id: 'm1',
        channel: { id: 'C' },
        author: { id: DANK, username: 'Dank Memer', bot: true },
        content: '',
        embeds: [],
        components: [],
        stickers: new Map(),
        reference: null,
        webhookId: null,
    }, over);
}
const embed = (json) => ({ toJSON: () => json });
const row = (json) => ({ toJSON: () => json });

// --- what is extracted ------------------------------------------------------

test('the result in an embed description is read', () => {
    const m = msg({ embeds: [embed({ description: 'You went hunting and brought back a **Frog**' })] });
    assert.match(reader.textOf(m), /Frog/);
});

test('content and embeds are both read', () => {
    const m = msg({ content: 'line one', embeds: [embed({ description: 'line two' })] });
    const text = reader.textOf(m);
    assert.match(text, /line one/);
    assert.match(text, /line two/);
});

test('embed fields are read, not only the description', () => {
    const m = msg({ embeds: [embed({ fields: [{ name: 'Rewards', value: 'You found nothing while digging' }] })] });
    assert.match(reader.textOf(m), /found nothing/);
});

test('an animated emoji is detected as animated', () => {
    const found = reader.emojisIn('<a:Frog:123> and <:Rock:9>');
    assert.deepStrictEqual(found, [
        { name: 'Frog', id: '123', animated: true },
        { name: 'Rock', id: '9', animated: false },
    ]);
});

test('an animated emoji inside an embed is extracted', () => {
    const m = msg({ embeds: [embed({ description: '<a:Gem:9> 3 gems' })] });
    const found = reader.emojisIn(reader.textOf(m));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].animated, true);
});

test('a button label is read, since an interactive reply puts text there', () => {
    const m = msg({ components: [row({ components: [{ label: 'You found nothing while digging', custom_id: 'x' }] })] });
    assert.match(reader.textOf(m), /found nothing/);
});

test('the snapshot records the emojis and the reference', () => {
    const m = msg({
        embeds: [embed({ description: '<a:Frog:1> You went hunting and brought back a **Frog**' })],
        reference: { messageId: 'sent-1' },
    });
    const snap = reader.describe(m);
    assert.strictEqual(snap.reference, 'sent-1');
    assert.deepStrictEqual(snap.emojis, [{ name: 'Frog', id: '1', animated: true }]);
});

// --- who is accepted --------------------------------------------------------

test('Dank Memer itself is recognised', () => {
    assert.strictEqual(reader.authorKind(msg()), 'dank');
});

test('a webhook reply is recognised, since its author id is not Dank', () => {
    const m = msg({ author: { id: '999', username: 'Dank Memer', bot: true }, webhookId: 'wh-1' });
    assert.strictEqual(reader.authorKind(m), 'webhook');
});

test('anyone else is ignored', () => {
    assert.strictEqual(reader.authorKind(msg({ author: { id: '555', username: 'guy', bot: false } })), 'other');
});

test('a stranger is never attributed to a pending command', () => {
    const acct = { pending: new Map([['sent-1', 'pls dig']]) };
    const m = msg({ author: { id: '555', username: 'guy' }, content: 'You dug in the dirt and brought back a **Rock**' });
    assert.strictEqual(reader.attribute(acct, m), null);
});

// --- attribution ------------------------------------------------------------

test('a referenced reply is matched to the command it answers', () => {
    const acct = { pending: new Map([['sent-1', 'pls hunt']]) };
    const m = msg({ reference: { messageId: 'sent-1' } });
    assert.deepStrictEqual(reader.attribute(acct, m), { command: 'pls hunt', key: 'sent-1', reason: 'reference:sent-1' });
});

test('a reply to a command we never sent is not attributed', () => {
    const acct = { pending: new Map([['sent-1', 'pls hunt']]) };
    const m = msg({ reference: { messageId: 'someone-else' } });
    assert.strictEqual(reader.attribute(acct, m), null);
});

test('a webhook reply is attributed by its reference even though the author differs', () => {
    const acct = { pending: new Map([['sent-9', 'pls dig']]) };
    const m = msg({ author: { id: '999', username: 'Dank Memer' }, webhookId: 'wh-1', reference: { messageId: 'sent-9' } });
    assert.deepStrictEqual(reader.attribute(acct, m), { command: 'pls dig', key: 'sent-9', reason: 'reference:sent-9' });
});

test('an unreferenced reply is matched to the oldest pending command', () => {
    const acct = { pending: new Map([['a', 'pls hunt'], ['b', 'pls dig']]) };
    const m = msg({ content: 'You found nothing while digging' });
    assert.deepStrictEqual(reader.attribute(acct, m), { command: 'pls hunt', key: 'a', reason: 'unreferenced:dank' });
});

test('an unreferenced reply with nothing pending is not attributed', () => {
    assert.strictEqual(reader.attribute({ pending: new Map() }, msg({ content: 'Good morning' })), null);
});

test('an empty message is not attributed', () => {
    const acct = { pending: new Map([['a', 'pls hunt']]) };
    assert.strictEqual(reader.attribute(acct, msg({ content: '' })), null);
});

// --- the log ----------------------------------------------------------------

test('a described message is written as one JSON line', () => {
    const fs = require('fs');
    const before = fs.existsSync(reader.INBOUND_LOG) ? fs.readFileSync(reader.INBOUND_LOG, 'utf8') : '';
    reader.record(reader.describe(msg({ content: 'hello' })));
    const after = fs.readFileSync(reader.INBOUND_LOG, 'utf8');
    assert.ok(after.length > before.length);
    const last = JSON.parse(after.trim().split('\n').pop());
    assert.strictEqual(last.text, 'hello');
});

test('the recent buffer keeps the newest snapshots', () => {
    reader.clearRecent();
    for (let i = 1; i <= 5; i++) reader.record(reader.describe(msg({ content: `m${i}` })));
    const last3 = reader.recent(3).map((s) => s.text);
    assert.deepStrictEqual(last3, ['m3', 'm4', 'm5']);
    assert.strictEqual(reader.recent(100).length, 5);
    reader.clearRecent();
    assert.strictEqual(reader.recent(5).length, 0);
});

test('a numbered-list reply is attributed and parsed as a catch', () => {
    const P = require('../parsing');
    const r = P.parseLoot('**1 <:Frog:1> Frog**', 'hunt');
    assert.deepStrictEqual(r.animals, ['Frog']);
    assert.strictEqual(reader.looksLikeResult('**1 <:Frog:1> Frog**'), true);
});
