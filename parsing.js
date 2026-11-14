// Reply parsing.
//
// The patterns here are built from real Dank Memer replies, not from guesses:
//
//   hunt hit   "You went hunting and brought back a **Frog**"
//   dig hit    "You dug in the dirt and brought back a **Rock**"
//   dig miss   "You found nothing while digging"
//   balance    "<:Coin:1> 1,850,722"  and  "<:Bank:2> 0 / 50,000"
//
// The earlier version matched a numbered shape ("**1 <:Frog:1> Frog**") that
// these replies do not use, so nothing was ever counted. Every pattern below
// also keeps a fallback for that older shape.
//
// No Discord imports, so the whole module is unit-testable.
const EMOJI = '<a?:[A-Za-z0-9_]+:\\d+>';

// -- balance -----------------------------------------------------------------
// The bank line can read "0 / 50,000", where 50,000 is the *capacity*. Only the
// first number is the balance, so the capture stops at the first run of digits.
const COIN_MARKER = /<a?:(?:coin|coins|wallet|banknote):\d+>/i;
const BANK_MARKER = /<a?:bank:\d+>/i;
const COIN_AMOUNT = /<a?:(?:coin|coins|wallet):\d+>\s*\**\s*([\d,]+)/i;
const BANK_AMOUNT = /<a?:bank:\d+>\s*\**\s*([\d,]+)/i;
// Label fallbacks, in case the custom emojis are ever renamed.
const COIN_LABEL = /\bwallet\b\s*:?\s*\**\s*([\d,]+)/i;
const BANK_LABEL = /\bbank\b\s*:?\s*\**\s*([\d,]+)/i;
// Unicode fallbacks.
const COIN_UNICODE = /\u{1F4B0}\s*\**\s*([\d,]+)/u;
const BANK_UNICODE = /\u{1F3E6}\s*\**\s*([\d,]+)/u;

// Other currencies that ride along in the same balance reply, e.g.
// "<:SkinFragments:3> 0", "<:FishToken:4> 0", "<:GemsAnimated:5> 0".
const BALANCE_ENTRY = /<a?:([A-Za-z0-9_]+):\d+>\s*\**\s*([\d,]+)/g;
const EXTRA_ALIASES = {
    skinfragments: 'skins',
    fishtoken: 'fishTokens',
    fishtokens: 'fishTokens',
    gemsanimated: 'gems',
};

// -- loot --------------------------------------------------------------------
// The reply texts, as they arrive. Only the part up to "back a" is the trigger;
// whatever follows names the catch.
//
//   You went hunting and brought back a **Frog**
//   You dug in the dirt and brought back a **Rock**
//   You found nothing while digging
const HUNT_HIT = /you went hunting and brought back a/i;
const DIG_HIT = /you dug in the dirt and brought back a/i;
const MISS = /found nothing while (?:digging|hunting|fishing|searching)/i;

// Grammar and the trailing status words are not part of a name.
const NOT_A_NAME = new Set(['a', 'an', 'the', 'success', 'succes', 'successful']);

// -- errors ------------------------------------------------------------------
const FAILURE = /cooldown|you don'?t have|not enough|you can'?t|you need|you'?re too|failed|try again|no luck|you already|nothing to|you have no|are you sure|you must wait|slow down|rate.?limit/i;

function toInt(raw) {
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

// Flattens a Discord message into plain text, embeds included. Results live in
// embeds, so `message.content` alone is usually empty.
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

function isMiss(text) {
    return MISS.test(String(text || ''));
}

function hasBalanceMarkers(text) {
    const s = String(text || '');
    const coin = COIN_MARKER.test(s) || COIN_LABEL.test(s) || COIN_UNICODE.test(s);
    const bank = BANK_MARKER.test(s) || BANK_LABEL.test(s) || BANK_UNICODE.test(s);
    return coin && bank;
}

function firstAmount(patterns, text) {
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) return toInt(match[1]);
    }
    return 0;
}

function normalizeExtra(name) {
    const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
    return EXTRA_ALIASES[key] || key;
}

// Reads the whole balance reply: wallet, bank, and any other currency in it.
// The bank line can be "0 / 50,000", where 50,000 is capacity — the capture
// stops at the first number, so only the balance is taken.
function parseBalance(content) {
    const text = String(content || '');
    const result = { wallet: 0, bank: 0, extras: {} };
    for (const match of text.matchAll(BALANCE_ENTRY)) {
        const name = String(match[1]).toLowerCase();
        const value = toInt(match[2]);
        if (name === 'coin' || name === 'coins' || name === 'wallet' || name === 'banknote') {
            result.wallet = value;
        } else if (name === 'bank') {
            result.bank = value;
        } else {
            result.extras[normalizeExtra(match[1])] = value;
        }
    }
    return result;
}

function parseCoins(content) {
    const text = String(content || '');
    return {
        wallet: firstAmount([COIN_AMOUNT, COIN_LABEL, COIN_UNICODE], text),
        bank: firstAmount([BANK_AMOUNT, BANK_LABEL, BANK_UNICODE], text),
    };
}

// The name that follows the trigger. A bolded name is kept whole, so
// "**Rusty Old Key**" stays one name; otherwise the first word is taken.
// Returns null when nothing readable follows, so the catch is still counted.
function lootName(rest) {
    const strip = (t) => t.replace(/<a?:[A-Za-z0-9_]+:\d+>/g, ' ').replace(/\s+/g, ' ').trim();
    const bold = /\*\*\s*([^*]+?)\s*\*\*/.exec(rest);
    if (bold) {
        const name = strip(bold[1]);
        if (name && !NOT_A_NAME.has(name.toLowerCase())) return name;
    }
    const word = /[A-Za-z][\w'-]*/.exec(strip(rest));
    if (!word) return null;
    return NOT_A_NAME.has(word[0].toLowerCase()) ? null : word[0];
}

// Returns { animals, items, missed } from one of the reply texts. `kind` is
// 'hunt' or 'dig' when the command is known, which decides the counter.
function parseLoot(content, kind) {
    const text = String(content || '');
    if (MISS.test(text)) return { animals: [], items: [], missed: true };

    const hunt = HUNT_HIT.exec(text);
    const dig = hunt ? null : DIG_HIT.exec(text);
    const hit = hunt || dig;
    if (!hit) return { animals: [], items: [], missed: false };

    const name = lootName(text.slice(hit.index + hit[0].length)) || 'Unknown';
    const animal = kind === 'hunt' || (kind !== 'dig' && !!hunt);

    return animal
        ? { animals: [name], items: [], missed: false }
        : { animals: [], items: [name], missed: false };
}

module.exports = {
    extractReplyText,
    isFailure,
    isMiss,
    hasBalanceMarkers,
    parseCoins,
    parseBalance,
    parseLoot,
    toInt,
    COIN_MARKER,
    BANK_MARKER,
    MISS,
    HUNT_HIT,
    DIG_HIT,
};
