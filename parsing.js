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
// The benzene-ring currency symbol the bot prints in plain text, "⏣ 1,850,722".
const COIN_SYMBOL = /\u{23E3}\s*\**\s*([\d,]+)/u;

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
// A catch is recognised by any of the shapes Dank Memer has used, because the
// same bot words the same result differently from build to build:
//
//   "You went hunting and brought back a **Frog**"      prose, bold name
//   "You dug in the dirt and brought back a **Rock**"   prose, bold name
//   "**1 <:Frog:123> Frog**"                            numbered list line
//   "You caught a **Rock**" / "You found a Rock"        other prose
//
// The trigger is the wording that reports a catch, not the item's name and not
// the emoji, so a reply counts whether or not it prints a picture.
const CATCH = /brought back|caught|dug up|found a|picked up|obtained/i;
// "You found nothing while digging" is an outcome, not an error.
const MISS = /found nothing|nothing while|better luck next time|no luck this time/i;

// A numbered list line, in either of the two ways the number is bolded:
//   "**1 <:Frog:123> Frog**"   number and name share the bold
//   "**1** <:frog:1> Frog"     only the number is bold
// The number is a quantity, not part of the name.
const NUMBERED_PATTERNS = [
    /\*\*\s*\d+\s*\**\s*(?:<a?:[A-Za-z0-9_]+:\d+>\s*)?([^*\n]+?)\s*\*\*/g,
    /\*\*\s*\d+\s*\*\*\s*(?:<a?:[A-Za-z0-9_]+:\d+>\s*)?([^\n]+)/g,
];

// Grammar and the trailing status words are not part of a name.
const NOT_A_NAME = new Set(['a', 'an', 'the', 'and', 'or', 'some', 'success', 'succes', 'successful']);

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
    // Both sides are required, matching the balance reply the original bot
    // read. A lone amount, from /beg or elsewhere, is not a balance.
    const coin = COIN_MARKER.test(s) || COIN_LABEL.test(s) || COIN_UNICODE.test(s) || COIN_SYMBOL.test(s);
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
    // Start from the non-emoji fallbacks, so a plain "\u{23E3} 1,850,722" or a
    // "Wallet: 1,850,722" line is read even when the custom emoji is absent.
    // The custom-emoji entries below then override these.
    const fallback = parseCoins(text);
    const result = { wallet: fallback.wallet, bank: fallback.bank, extras: {} };
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
        wallet: firstAmount([COIN_AMOUNT, COIN_LABEL, COIN_UNICODE, COIN_SYMBOL], text),
        bank: firstAmount([BANK_AMOUNT, BANK_LABEL, BANK_UNICODE], text),
    };
}

// The name that follows a catch trigger. A bolded name is kept whole, so
// "**Rusty Old Key**" stays one name; otherwise the first word is taken.
// Returns null when nothing readable follows, so the catch still counts.
function lootName(rest) {
    const strip = (t) => t.replace(/<a?:[A-Za-z0-9_]+:\d+>/g, ' ').replace(/\s+/g, ' ').trim();
    const bold = /\*\*\s*([^*]+?)\s*\*\*/.exec(rest);
    if (bold) {
        const name = strip(bold[1]).replace(/^\d+\s*/, '');
        if (name && !NOT_A_NAME.has(name.toLowerCase())) return name;
    }
    const word = (strip(rest).match(/[A-Za-z][\w'-]*/g) || [])
        .find((w) => !NOT_A_NAME.has(w.toLowerCase()));
    return word || null;
}

// Every name in a reply, from the numbered-list shapes and from prose.
function lootNames(text) {
    const names = [];
    const seen = new Set();
    const push = (raw) => {
        const name = String(raw || '').replace(/<a?:[A-Za-z0-9_]+:\d+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!name || NOT_A_NAME.has(name.toLowerCase())) return;
        if (seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());
        names.push(name);
    };

    // The numbered list first: "**1 <:Frog:1> Frog**". One line, one catch.
    for (const pattern of NUMBERED_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) push(match[1]);
        if (names.length) return names;
    }

    // Prose: the name follows the trigger. Take the first trigger occurrence.
    const at = text.search(CATCH);
    if (at >= 0) {
        const after = text.slice(at).replace(CATCH, '');
        const name = lootName(after);
        if (name) push(name);
    }
    return names;
}

// Returns { animals, items, missed } from one of the reply texts. `kind` is
// 'hunt' or 'dig' when the command is known, which decides the counter.
function parseLoot(content, kind) {
    const text = String(content || '');
    if (MISS.test(text)) return { animals: [], items: [], missed: true };

    if (!isCatch(text)) return { animals: [], items: [], missed: false };

    const names = lootNames(text);
    if (!names.length) {
        // The catch is real but prints no readable name. Count it anyway, so a
        // reply that shows only an emoji is not lost.
        names.push('Unknown');
    }
    const animal = kind === 'hunt' || (kind !== 'dig' && /hunt|caught/i.test(text));

    return animal
        ? { animals: names, items: [], missed: false }
        : { animals: [], items: names, missed: false };
}

// True when the reply reports a catch in any shape, for the reader's
// "is this a result" check.
function isCatch(text) {
    const t = String(text || '');
    if (MISS.test(t)) return false;
    if (CATCH.test(t)) return true;
    for (const pattern of NUMBERED_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(t)) return true;
    }
    return false;
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
    COIN_SYMBOL,
    MISS,
    CATCH,
    isCatch,
};
