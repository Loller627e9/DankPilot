// Reply parsing and stat accounting.
//
// Ported from the original Node bot so the shapes it matches are the ones Dank
// Memer actually sends. Two things are deliberately kept from that version:
// results live in embeds (message.content is usually empty), and coins are
// tracked as a high-water mark so spending cannot be counted as earning.
//
// No Discord imports here, so the whole module is unit-testable.

// A custom Discord emoji, e.g. <:Coin:123> or <a:Coin:123>.
const EMOJI = '<a?:[A-Za-z0-9_]+:\\d+>';

// Balance markers. Widened to a case-insensitive set (coin/coins/bank) because
// the emoji names are Discord-side and have changed over time; requiring the
// exact capitalisation is what silently produced 0s before.
const COIN_MARKER = /<a?:(?:coin|coins|wallet|banknote):\d+>/i;
const BANK_MARKER = /<a?:bank:\d+>/i;
const COIN_AMOUNT = /<a?:(?:coin|coins|wallet):\d+>\s*\**\s*([\d,]+)/i;
const BANK_AMOUNT = /<a?:bank:\d+>\s*\**\s*([\d,]+)/i;
// Unicode fallbacks, in case the custom emojis are ever renamed.
const COIN_UNICODE = /\u{1F4B0}\s*\**\s*([\d,]+)/u;
const BANK_UNICODE = /\u{1F3E6}\s*\**\s*([\d,]+)/u;

// Loot lines. "**1 <:Frog:123> Frog**" is the original shape; the spaced form
// "**1** <:Frog:123> Frog" shows up in newer replies.
const LOOT_TIGHT = /\*\*\d+ [<:a-zA-Z0-9]+:\d+> ([^*\n]+)/g;
const LOOT_SPACED = /\*\*\s*\d+\s*\*\*\s*(?:<a?:[A-Za-z0-9_]+:\d+>)?\s*([^\n,*]+)/g;
// Plain "caught a Frog" with no numbering.
const PLAIN_LOOT = /(?:caught|found|dug up|picked up|obtained)\s+a[n]?\s+\**([A-Za-z][A-Za-z0-9' -]{1,30}?)\**(?=[\s.!?,]|$)/gi;

const FAILURE = /cooldown|you don'?t have|not enough|you can'?t|you need|you'?re too|failed|better luck next time|try again|no luck|you already|nothing to|you have no|are you sure|you must wait|slow down|rate.?limit/i;

function toInt(raw) {
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

function cleanName(raw) {
    return String(raw)
        .replace(new RegExp(EMOJI, 'g'), ' ')
        .replace(/[^\w\s'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Flattens a Discord message into plain text, embeds included.
function extractReplyText(message) {
    const parts = [];
    if (message && message.content) parts.push(String(message.content));
    for (const embed of (message && message.embeds) || []) {
        for (const key of ['title', 'description']) {
            if (embed && embed[key]) parts.push(String(embed[key]));
        }
        if (embed && embed.author && embed.author.name) parts.push(String(embed.author.name));
        if (embed && embed.footer && embed.footer.text) parts.push(String(embed.footer.text));
        for (const field of (embed && embed.fields) || []) {
            if (field) parts.push(`${field.name || ''} ${field.value || ''}`);
        }
    }
    return parts.filter(Boolean).join('\n');
}

function isFailure(text) {
    return FAILURE.test(String(text || ''));
}

function hasBalanceMarkers(text) {
    const s = String(text || '');
    return (COIN_MARKER.test(s) || COIN_UNICODE.test(s)) && (BANK_MARKER.test(s) || BANK_UNICODE.test(s));
}

function firstAmount(pattern, text) {
    const match = pattern.exec(text);
    return match ? toInt(match[1]) : 0;
}

function parseCoins(content) {
    const text = String(content || '');
    const wallet = firstAmount(COIN_AMOUNT, text) || firstAmount(COIN_UNICODE, text);
    const bank = firstAmount(BANK_AMOUNT, text) || firstAmount(BANK_UNICODE, text);
    return { wallet, bank };
}

function parseLoot(content, kind) {
    const text = String(content || '');
    if (isFailure(text)) return { animals: [], items: [] };

    let names = [];
    for (const pattern of [LOOT_TIGHT, LOOT_SPACED]) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const name = cleanName(match[1]);
            if (name) names.push(name);
        }
        if (names.length) break;
    }

    if (!names.length) {
        for (const match of text.matchAll(PLAIN_LOOT)) {
            const name = cleanName(match[1]);
            if (name) names.push(name);
        }
    }

    // Safety net from the original bot: if the reply says something was caught
    // or found but the name format was not recognised, still count it once so a
    // format change cannot silently zero the totals.
    let forced = null;
    if (!names.length) {
        if (/caught a/i.test(text)) { names = ['Unknown Animal']; forced = 'animal'; }
        else if (/found a/i.test(text)) { names = ['Unknown Item']; forced = 'item'; }
    }
    if (!names.length) return { animals: [], items: [] };

    let isAnimal;
    if (forced === 'animal') isAnimal = true;
    else if (forced === 'item') isAnimal = false;
    else if (kind === 'hunt') isAnimal = true;
    else if (kind === 'dig') isAnimal = false;
    else isAnimal = /caught|hunting|hunt/i.test(text);

    return isAnimal ? { animals: names, items: [] } : { animals: [], items: names };
}

module.exports = {
    extractReplyText,
    isFailure,
    hasBalanceMarkers,
    parseCoins,
    parseLoot,
    toInt,
    cleanName,
    COIN_MARKER,
    BANK_MARKER,
};
