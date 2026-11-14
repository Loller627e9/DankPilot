// Parsing tests, built from the reply formats the user actually sees.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../parsing');

// --- hunt / dig: the real wording -------------------------------------------

test('a real hunt reply counts one animal', () => {
    const r = P.parseLoot('You went hunting and brought back a **Frog**', 'hunt');
    assert.deepStrictEqual(r.animals, ['Frog']);
    assert.deepStrictEqual(r.items, []);
    assert.strictEqual(r.missed, false);
});

test('a real dig reply counts one item', () => {
    const r = P.parseLoot('You dug in the dirt and brought back a **Rock**', 'dig');
    assert.deepStrictEqual(r.items, ['Rock']);
    assert.deepStrictEqual(r.animals, []);
    assert.strictEqual(r.missed, false);
});

test('a real dig miss is recorded as a miss, not a catch', () => {
    const r = P.parseLoot('You found nothing while digging', 'dig');
    assert.strictEqual(r.missed, true);
    assert.deepStrictEqual(r.items, []);
    assert.deepStrictEqual(r.animals, []);
});

test('a real hunt miss is recorded as a miss', () => {
    assert.strictEqual(P.parseLoot('You found nothing while hunting', 'hunt').missed, true);
});

test('a miss is not also treated as a failure', () => {
    // "nothing" must not fall through to the error branch, or a miss would be
    // counted twice.
    assert.strictEqual(P.isMiss('You found nothing while digging'), true);
    assert.strictEqual(P.isFailure('You found nothing while digging'), false);
});

test('a multi-word item name survives intact', () => {
    const r = P.parseLoot('You dug in the dirt and brought back a **Rusty Old Key**', 'dig');
    assert.deepStrictEqual(r.items, ['Rusty Old Key']);
});

test('several items in one reply are all counted', () => {
    const r = P.parseLoot('You dug in the dirt and brought back a **Rock** and a **Coin**', 'dig');
    assert.strictEqual(r.items.length, 2);
});

test('the loot name is taken from after "brought back", not from other bold text', () => {
    // A bold phrase earlier in the reply must not be mistaken for the item.
    const r = P.parseLoot('**Achievement!** You dug in the dirt and brought back a **Rock**', 'dig');
    assert.deepStrictEqual(r.items, ['Rock']);
});

test('kind decides the counter even when the wording disagrees', () => {
    const asHunt = P.parseLoot('You dug in the dirt and brought back a **Rock**', 'hunt');
    assert.deepStrictEqual(asHunt.animals, ['Rock'], 'hunt always increments animals');
    const asDig = P.parseLoot('You went hunting and brought back a **Frog**', 'dig');
    assert.deepStrictEqual(asDig.items, ['Frog'], 'dig always increments items');
});

// --- older reply shapes must still work --------------------------------------

test('the older numbered shape is still read', () => {
    assert.deepStrictEqual(P.parseLoot('**1 <:Frog:123> Frog**', 'hunt').animals, ['Frog']);
});

test('the older spaced numbered shape is still read', () => {
    assert.deepStrictEqual(P.parseLoot('**1** <:frog:123> Frog', 'dig').items, ['Frog']);
});

test('plain "caught a X" wording is still read', () => {
    assert.deepStrictEqual(P.parseLoot('You caught a Frog!', 'hunt').animals, ['Frog']);
});

test('an animated emoji is read the same as a static one', () => {
    assert.deepStrictEqual(P.parseLoot('brought back a <a:rock:99> Rock', 'dig').items, ['Rock']);
});

// --- cooldowns and refusals --------------------------------------------------

test('a cooldown is a failure, never loot', () => {
    const text = "You're on a cooldown, try again in 30 seconds";
    assert.strictEqual(P.isFailure(text), true);
    assert.deepStrictEqual(P.parseLoot(text, 'hunt').animals, []);
    assert.strictEqual(P.parseLoot(text, 'hunt').missed, false);
});

test('a refusal is a failure', () => {
    assert.strictEqual(P.isFailure("You don't have a hunting rifle"), true);
    assert.strictEqual(P.isFailure('You need more coins'), true);
});

test('a normal reply is not a failure', () => {
    assert.strictEqual(P.isFailure('You went hunting and brought back a **Frog**'), false);
});

// --- balance -----------------------------------------------------------------

test('a real balance block is read, ignoring the bank capacity', () => {
    const r = P.parseCoins('<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000');
    assert.strictEqual(r.wallet, 1850722);
    assert.strictEqual(r.bank, 0, '0 is the balance; 50,000 is capacity');
});

test('a funded bank reads its own number, not the capacity', () => {
    const r = P.parseCoins('<:Coin:1> 100\n<:Bank:2> 25,000 / 50,000');
    assert.strictEqual(r.bank, 25000);
});

test('other currencies in the same reply are captured', () => {
    const r = P.parseBalance(
        '<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000\n' +
        '<:SkinFragments:3> 12\n<:FishToken:4> 3\n<:GemsAnimated:5> 40'
    );
    assert.strictEqual(r.wallet, 1850722);
    assert.strictEqual(r.extras.skins, 12);
    assert.strictEqual(r.extras.fishTokens, 3);
    assert.strictEqual(r.extras.gems, 40);
});

test('both markers are required before a balance is read', () => {
    assert.strictEqual(P.hasBalanceMarkers('<:Coin:1> 1,850,722\n<:Bank:2> 0 / 50,000'), true);
    assert.strictEqual(P.hasBalanceMarkers('<:Coin:1> 1,850,722'), false, 'bank missing');
});

test('plain "Wallet"/"Bank" labels are a fallback', () => {
    const r = P.parseCoins('Wallet: 5,000\nBank: 1,000');
    assert.strictEqual(r.wallet, 5000);
    assert.strictEqual(r.bank, 1000);
});

// --- text flattening ---------------------------------------------------------

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

// --- helpers -----------------------------------------------------------------

test('toInt strips separators and tolerates junk', () => {
    assert.strictEqual(P.toInt('1,234,567'), 1234567);
    assert.strictEqual(P.toInt('abc'), 0);
    assert.strictEqual(P.toInt(undefined), 0);
});

test('cleanLootName drops a leading count and any emoji', () => {
    assert.strictEqual(P.cleanLootName('1 <:Frog:1> Frog'), 'Frog');
    assert.strictEqual(P.cleanLootName('Frog'), 'Frog');
    assert.strictEqual(P.cleanLootName('1'), '');
});
