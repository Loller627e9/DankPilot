// Parsing tests, built from the reply texts the user actually sees.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../parsing');

// --- hunt / dig -------------------------------------------------------------

test('the hunt text counts one animal', () => {
    const r = P.parseLoot('You went hunting and brought back a **Frog**', 'hunt');
    assert.deepStrictEqual(r.animals, ['Frog']);
    assert.deepStrictEqual(r.items, []);
    assert.strictEqual(r.missed, false);
});

test('the dig text counts one item', () => {
    const r = P.parseLoot('You dug in the dirt and brought back a **Rock**', 'dig');
    assert.deepStrictEqual(r.items, ['Rock']);
    assert.deepStrictEqual(r.animals, []);
    assert.strictEqual(r.missed, false);
});

test('a trailing status line does not change the name', () => {
    assert.deepStrictEqual(
        P.parseLoot('You went hunting and brought back a **Frog** succes hunting', 'hunt').animals,
        ['Frog']
    );
    assert.deepStrictEqual(
        P.parseLoot('You dug in the dirt and brought back a **Rock** succes digging', 'dig').items,
        ['Rock']
    );
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

test('the name works without the bold', () => {
    assert.deepStrictEqual(P.parseLoot('You went hunting and brought back a Frog', 'hunt').animals, ['Frog']);
});

test('a bolded multi-word name is kept whole', () => {
    assert.deepStrictEqual(
        P.parseLoot('You dug in the dirt and brought back a **Rusty Old Key**', 'dig').items,
        ['Rusty Old Key']
    );
});

test('an emoji followed by a name uses the name', () => {
    assert.deepStrictEqual(
        P.parseLoot('You went hunting and brought back a <:Frog:1> Frog', 'hunt').animals,
        ['Frog']
    );
});

test('a reply with no readable name still counts the catch', () => {
    const r = P.parseLoot('You went hunting and brought back a <:Frog:1>', 'hunt');
    assert.strictEqual(r.animals.length, 1, 'the catch is counted without a name');
});

test('the command decides the counter, not the wording', () => {
    assert.deepStrictEqual(
        P.parseLoot('You dug in the dirt and brought back a **Rock**', 'hunt').animals,
        ['Rock']
    );
    assert.deepStrictEqual(
        P.parseLoot('You went hunting and brought back a **Frog**', 'dig').items,
        ['Frog']
    );
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

test('the benzene-ring symbol is a balance marker', () => {
    assert.strictEqual(P.hasBalanceMarkers('⏣ 1,850,722 <:Bank:2> 0'), true);
    assert.strictEqual(P.parseCoins('⏣ 1,850,722').wallet, 1850722);
    // A lone amount, from /beg, is not a balance.
    assert.strictEqual(P.hasBalanceMarkers('Oh you poor soul, take ⏣ 12,345'), false);
});

test('parseBalance reads the symbol and label fallbacks too', () => {
    assert.deepStrictEqual(
        { w: P.parseBalance('⏣ 2,000,000 <:Bank:2> 1,000,000').wallet, b: P.parseBalance('⏣ 2,000,000 <:Bank:2> 1,000,000').bank },
        { w: 2000000, b: 1000000 }
    );
    assert.strictEqual(P.parseBalance('Wallet: 1,850,722 Bank: 5,000').wallet, 1850722);
    // A custom-emoji entry still wins when both are present.
    assert.strictEqual(P.parseBalance('<:Coin:1> 99').wallet, 99);
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

// --- the numbered-list shape ------------------------------------------------
// The bot has worded a result as a numbered list, which the earlier parser
// matched but the trigger-only parser dropped. Both shapes must read.

test('a numbered line with an emoji counts the name', () => {
    assert.deepStrictEqual(P.parseLoot('**1 <:Frog:123> Frog**', 'hunt').animals, ['Frog']);
    assert.deepStrictEqual(P.parseLoot('**1 <a:Frog:123> Frog**', 'hunt').animals, ['Frog']);
});

test('a numbered line without an emoji counts the name', () => {
    assert.deepStrictEqual(P.parseLoot('**1 Frog**', 'hunt').animals, ['Frog']);
});

test('a numbered line with only the number bolded counts the name', () => {
    assert.deepStrictEqual(P.parseLoot('**1** <:frog:1> Frog', 'hunt').animals, ['Frog']);
});

test('every numbered line is counted', () => {
    const text = '**1 <:Frog:1> Frog**\n**2 <:Rock:2> Rock**\n**3 <:Fish:3> Fish**';
    assert.deepStrictEqual(P.parseLoot(text, 'hunt').animals, ['Frog', 'Rock', 'Fish']);
});

test('a numbered dig line is an item', () => {
    assert.deepStrictEqual(P.parseLoot('**1 <:Rock:2> Rock**', 'dig').items, ['Rock']);
});

test('isCatch is true for every hit shape and false for a miss', () => {
    assert.strictEqual(P.isCatch('**1 <:Frog:1> Frog**'), true);
    assert.strictEqual(P.isCatch('You caught a **Rock**'), true);
    assert.strictEqual(P.isCatch('You went hunting and brought back a **Frog**'), true);
    assert.strictEqual(P.isCatch('You found nothing while digging'), false);
    assert.strictEqual(P.isCatch('Good morning everyone'), false);
});

// --- other wordings ---------------------------------------------------------

test('other ways of reporting a catch still count', () => {
    assert.deepStrictEqual(P.parseLoot('You caught a **Rock**', 'dig').items, ['Rock']);
    assert.deepStrictEqual(P.parseLoot('You found a Rock', 'dig').items, ['Rock']);
});
