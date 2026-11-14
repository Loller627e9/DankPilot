const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

freshDataDir();
const { parsing } = load();

test('parseCoins reads the capitalised emoji names the old bot used', () => {
    assert.deepStrictEqual(
        parsing.parseCoins('Wallet: <:Coin:1> 1,234  Bank: <:Bank:2> 5,000'),
        { wallet: 1234, bank: 5000 }
    );
});

test('parseCoins tolerates lowercase and animated emoji names', () => {
    assert.deepStrictEqual(
        parsing.parseCoins('Wallet: <:coin:1> **1,234**  Bank: <a:bank:2> **5,000**'),
        { wallet: 1234, bank: 5000 }
    );
});

test('parseCoins returns zeros when nothing matches', () => {
    assert.deepStrictEqual(parsing.parseCoins('no numbers here'), { wallet: 0, bank: 0 });
});

test('hasBalanceMarkers needs both the coin and the bank marker', () => {
    assert.strictEqual(parsing.hasBalanceMarkers('Wallet: <:coin:1> 1  Bank: <:bank:2> 2'), true);
    assert.strictEqual(parsing.hasBalanceMarkers('Wallet: <:coin:1> 1'), false);
});

test('parseLoot reads the tight numbered shape', () => {
    assert.deepStrictEqual(parsing.parseLoot('**1 <:Frog:123> Frog**', 'hunt'), {
        animals: ['Frog'], items: [],
    });
});

test('parseLoot reads the spaced numbered shape', () => {
    assert.deepStrictEqual(parsing.parseLoot('**1** <:frog:123> Frog', 'dig'), {
        animals: [], items: ['Frog'],
    });
});

test('parseLoot falls back to plain wording', () => {
    assert.deepStrictEqual(parsing.parseLoot('You caught a Frog!', 'hunt'), {
        animals: ['Frog'], items: [],
    });
});

test('parseLoot counts an unrecognised catch instead of dropping it', () => {
    const loot = parsing.parseLoot('You caught a weird thing', 'hunt');
    assert.strictEqual(loot.animals.length, 1);
});

test('parseLoot never counts a cooldown as loot', () => {
    assert.deepStrictEqual(parsing.parseLoot("You're on a cooldown, caught nothing", 'hunt'), {
        animals: [], items: [],
    });
});

test('parseLoot routes by command kind, not by reply wording', () => {
    assert.deepStrictEqual(parsing.parseLoot('**1 <:X:1> Shiny Rock**', 'dig'), {
        animals: [], items: ['Shiny Rock'],
    });
});

test('extractReplyText flattens embeds, which is where the results live', () => {
    const message = {
        content: '',
        embeds: [{ description: 'Wallet: <:Coin:1> 10', fields: [{ name: 'Bank', value: '<:Bank:2> 20' }] }],
    };
    const text = parsing.extractReplyText(message);
    assert.match(text, /Wallet: <:Coin:1> 10/);
    assert.match(text, /Bank <:Bank:2> 20/);
});

test('extractReplyText survives a message with no embeds', () => {
    assert.strictEqual(parsing.extractReplyText({ content: 'hi' }), 'hi');
    assert.strictEqual(parsing.extractReplyText({}), '');
});

test('isFailure recognises cooldown wording', () => {
    assert.strictEqual(parsing.isFailure("You're on a cooldown"), true);
    assert.strictEqual(parsing.isFailure('You caught a Frog'), false);
});
