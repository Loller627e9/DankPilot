// Parsing tests, built from the reply texts the user actually sees.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../parsing');

// --- hunt / dig -------------------------------------------------------------

test('the hunt hit text counts one animal', () => {
    const r = P.parseLoot('You went hunting and brought back a **Frog**', 'hunt');
    assert.deepStrictEqual(r.animals, ['Frog']);
    assert.deepStrictEqual(r.items, []);
    assert.strictEqual(r.missed, false);
});

test('the dig hit text counts one item', () => {
    const r = P.parseLoot('You dug in the dirt and brought back a **Rock**', 'dig');
    assert.deepStrictEqual(r.items, ['Rock']);
    assert.deepStrictEqual(r.animals, []);
    assert.strictEqual(r.missed, false);
});

test('the dig miss text is a miss, not a catch', () => {
    const r = P.parseLoot('You found nothing while digging', 'dig');
    assert.strictEqual(r.missed, true);
    assert.deepStrictEqual(r.items, []);
    assert.deepStrictEqual(r.animals, []);
});

test('a hunt miss is a miss too', () => {
    assert.strictEqual(P.parseLoot('You found nothing while hunting', 'hunt').missed, true);
});

test('a miss is not also an error', () => {
    assert.strictEqual(P.isMiss('You found nothing while digging'), true);
    assert.strictEqual(P.isFailure('You found nothing while digging'), false);
});

test('the name works without the bold or the emoji', () => {
    assert.deepStrictEqual(P.parseLoot('You went hunting and brought back a Frog', 'hunt').animals, ['Frog']);
});

test('a name shown only as an emoji is still counted', () => {
    const r = P.parseLoot('You went hunting and brought back a <:Frog:1>', 'hunt');
    assert.strictEqual(r.animals.length, 1, 'the catch is counted even with no printed name');
});

test('an emoji followed by a name uses the name', () => {
    const r = P.parseLoot('You went hunting and brought back a <:Frog:1> Frog', 'hunt');
    assert.deepStrictEqual(r.animals, ['Frog']);
});

test('a multi-word name survives intact', () => {
    assert.deepStrictEqual(P.parseLoot('You dug in the dirt and brought back a **Rusty Old Key**', 'dig').items, ['Rusty Old Key']);
});

test('the command decides the counter, not the wording', () => {
    assert.deepStrictEqual(P.parseLoot('You dug in the dirt and brought back a **Rock**', 'hunt').animals, ['Rock']);
    assert.deepStrictEqual(P.parseLoot('You went hunting and brought back a **Frog**', 'dig').items, ['Frog']);
});

// --- non-results ------------------------------------------------------------

test('a cooldown counts nothing', () => {
    const text = "You're on a cooldown, try again in 30 seconds";
    assert.strictEqual(P.isFailure(text), true);
    const r = P.parseLoot(text, 'hunt');
    assert.deepStrictEqual(r.animals, []);
    assert.strictEqual(r.missed, false);
});

test('unrelated chatter counts nothing', () => {
    const r = P.parseLoot('Good morning everyone', 'hunt');
    assert.deepStrictEqual(r.animals, []);
    assert.deepStrictEqual(r.items, []);
    assert.strictEqual(r.missed, false);
});

// --- balance ----------------------------------------------------------------

test('the balance text is read, ignoring the bank capacity', () => {
    const r = P.parseCoins('<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000');
    assert.strictEqual(r.wallet, 1850722);
    assert.strictEqual(r.bank, 0, '0 is the balance; 50,000 is capacity');
});

test('a funded bank reads its own number', () => {
    assert.strictEqual(P.parseCoins('<:Coin:1> 100\n<:Bank:2> 25,000 / 50,000').bank, 25000);
});

test('the other currencies in the balance text are captured', () => {
    const r = P.parseBalance(
        '<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000\n' +
        '<:SkinFragments:3> 12\n<:FishToken:4> 3\n<:GemsAnimated:5> 40'
    );
    assert.strictEqual(r.wallet, 1850722);
    assert.strictEqual(r.extras.skins, 12);
    assert.strictEqual(r.extras.fishTokens, 3);
    assert.strictEqual(r.extras.gems, 40);
});

test('both markers are needed before a balance is read', () => {
    assert.strictEqual(P.hasBalanceMarkers('<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000'), true);
    assert.strictEqual(P.hasBalanceMarkers('<:Coin:1> 1,850,722'), false);
});

// --- text flattening --------------------------------------------------------

test('embeds are flattened, since results live there', () => {
    const text = P.extractReplyText({
        content: 'hi',
        embeds: [{ description: 'You went hunting and brought back a **Frog**', fields: [{ name: 'n', value: 'v' }] }],
    });
    assert.match(text, /Frog/);
    assert.match(text, /hi/);
});

test('a message with no content and no embeds yields an empty string', () => {
    assert.strictEqual(P.extractReplyText({}), '');
    assert.strictEqual(P.extractReplyText(null), '');
});

test('toInt strips separators and tolerates junk', () => {
    assert.strictEqual(P.toInt('1,234,567'), 1234567);
    assert.strictEqual(P.toInt('abc'), 0);
    assert.strictEqual(P.toInt(undefined), 0);
});
