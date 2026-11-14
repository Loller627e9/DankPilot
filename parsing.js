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
// A "miss" is a real outcome, not an error: it is how we count "not caught".
const MISS = /(?:found|caught|got|brought back|picked up)\s+nothing|nothing\s+while\s+(?:digging|hunting|fishing|searching)|better luck next time/i;

// Only the text after "brought back" is scanned for a name, so a bold sentence
// elsewhere in the reply cannot be mistaken for an item.
const BOLD = /\*\*(.+?)\*\*/g;
const EMOJI_THEN_NAME = /<a?:[A-Za-z0-9_]+:\d+>\s*([A-Za-z][\w' -]*)/g;
const BROUGHT_BACK_PLAIN = /brought back\s+(?:a|an)?\s*\**([A-Za-z][\w' -]*)/gi;
const CAUGHT_PLAIN = /(?:caught|found|dug up|obtained)\s+(?:a|an)\s+\**([A-Za-z][\w' -]*)\**/gi;

// -- errors ------------------------------------------------------------------
const FAILURE = /cooldown|you don'?t have|not enough|you can'?t|you need|you'?re too|failed|try again|no luck|you already|nothing to|you have no|are you sure|you must wait|slow down|rate.?limit/i;

function toInt(raw) {
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

// "1 <:Frog:1> Frog" -> "Frog";  "Frog" -> "Frog";  "1" -> "".
function cleanLootName(raw) {
    return String(raw)
        .replace(new RegExp(EMOJI, 'g'), ' ')
        .replace(/^\s*\d+\s*/, '')
        .replace(/[^\w\s'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

// Collects the loot names from a reply. Scoped to the text after "brought back"
// when that phrase is present, so unrelated bold text is ignored.
function extractNames(text) {
    const at = text.search(/brought back/i);
    const scope = at >= 0 ? text.slice(at) : text;
    const names = [];

    const push = (raw) => {
        const name = cleanLootName(raw);
        if (name) names.push(name);
    };

    for (const match of scope.matchAll(BOLD)) push(match[1]);
    if (names.length) return names;

    for (const match of scope.matchAll(EMOJI_THEN_NAME)) push(match[1]);
    if (names.length) return names;

    for (const match of scope.matchAll(BROUGHT_BACK_PLAIN)) push(match[1]);
    if (names.length) return names;

    for (const match of text.matchAll(CAUGHT_PLAIN)) push(match[1]);
    return names;
}

// Returns { animals, items, missed }. `kind` is 'hunt' or 'dig' when the
// command is known, which decides which counter a name belongs to.
function parseLoot(content, kind) {
    const text = String(content || '');
    if (isMiss(text)) return { animals: [], items: [], missed: true };
    if (isFailure(text)) return { animals: [], items: [], missed: false };

    const names = extractNames(text);
    if (!names.length) return { animals: [], items: [], missed: false };

    let isAnimal;
    if (kind === 'hunt') isAnimal = true;
    else if (kind === 'dig') isAnimal = false;
    else isAnimal = /hunt|caught/i.test(text);

    return isAnimal
        ? { animals: names, items: [], missed: false }
        : { animals: [], items: names, missed: false };
}

module.exports = {
    extractReplyText,
    extractNames,
    isFailure,
    isMiss,
    hasBalanceMarkers,
    parseCoins,
    parseBalance,
    parseLoot,
    toInt,
    cleanLootName,
    COIN_MARKER,
    BANK_MARKER,
    MISS,
};
