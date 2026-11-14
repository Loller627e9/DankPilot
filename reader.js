// Strict inbound message reader.
//
// The tracking kept "not reading" because a reply was being dropped before any
// parsing happened, and there was no record of what actually arrived. This
// module does two things:
//
//   1. Describes every inbound message completely — content, embeds (all
//      fields, including animated emoji), components (button labels), and the
//      reference — and appends it to a log file, so the true format is visible
//      instead of guessed at.
//   2. Decides, strictly, whether a message answers a command we sent.
//
// Attribution is by reference id when the reply carries one, which is exact. A
// reply from a webhook is accepted too: Dank Memer can answer through one, and
// its author id is then the webhook's, not the bot's, so an author check alone
// would discard every result.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const parsing = require('./parsing');

const DANK_MEMER_ID = '270904126974590976';
const INBOUND_LOG = path.join(config.dataDirPath, 'inbound.jsonl');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

// -- describing a message ----------------------------------------------------

// The custom-emoji tag, static or animated: <:Name:123> or <a:Name:123>.
const EMOJI_TAG = /<a?:([A-Za-z0-9_]+):(\d+)>/g;

// Every animated and static emoji in a string, as { name, id, animated }.
function emojisIn(text) {
    const found = [];
    for (const match of String(text || '').matchAll(EMOJI_TAG)) {
        found.push({ name: match[1], id: match[2], animated: match[0].startsWith('<a:') });
    }
    return found;
}

// Flattens a message to plain text. Results live in embeds and in button
// labels, not only in content, so all three are read.
function textOf(message) {
    const parts = [];
    if (message.content) parts.push(String(message.content));

    for (const embed of message.embeds || []) {
        const e = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
        if (!e) continue;
        if (e.title) parts.push(String(e.title));
        if (e.description) parts.push(String(e.description));
        if (e.author && e.author.name) parts.push(String(e.author.name));
        if (e.footer && e.footer.text) parts.push(String(e.footer.text));
        for (const field of e.fields || []) {
            if (field) parts.push(`${field.name || ''} ${field.value || ''}`);
        }
    }

    // Button and select labels, which is where an interactive reply puts text.
    for (const row of message.components || []) {
        const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
        for (const component of (json && json.components) || []) {
            if (component.label) parts.push(String(component.label));
            if (component.emoji && component.emoji.name) parts.push(String(component.emoji.name));
        }
    }

    for (const sticker of message.stickers ? message.stickers.values() : []) {
        if (sticker && sticker.name) parts.push(String(sticker.name));
    }

    return parts.filter(Boolean).join('\n');
}

// A complete, serialisable snapshot of one message. Written to the log so the
// exact shape is available after the fact.
function describe(message) {
    const embed = (message.embeds || []).map((e) => {
        const json = typeof e.toJSON === 'function' ? e.toJSON() : e;
        return json;
    });
    const components = (message.components || []).map((row) => {
        const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
        return json;
    });
    return {
        at: new Date().toISOString(),
        id: message.id,
        channelId: message.channel && message.channel.id,
        authorId: message.author && message.author.id,
        authorName: message.author && (message.author.username || message.author.tag),
        authorBot: message.author && message.author.bot,
        webhookId: message.webhookId || null,
        reference: message.reference && message.reference.messageId ? message.reference.messageId : null,
        content: message.content || '',
        embeds: embed,
        components,
        emojis: emojisIn(textOf(message)),
        text: textOf(message),
    };
}

// Appends one snapshot as a JSON line. The file is trimmed once it grows past
// the cap, so a long run cannot fill the disk.
function record(snapshot) {
    try {
        fs.mkdirSync(path.dirname(INBOUND_LOG), { recursive: true });
        if (fs.existsSync(INBOUND_LOG) && fs.statSync(INBOUND_LOG).size > MAX_LOG_BYTES) {
            fs.writeFileSync(INBOUND_LOG, '');
        }
        fs.appendFileSync(INBOUND_LOG, `${JSON.stringify(snapshot)}\n`);
    } catch {
        // A read-only filesystem must not stop the bot.
    }
}

// -- accepting a reply -------------------------------------------------------

// Who sent this? Dank Memer answers as itself or, for interactions, through a
// webhook whose author id is the webhook's.
function authorKind(message) {
    const id = message.author && message.author.id;
    if (id === DANK_MEMER_ID) return 'dank';
    if (message.webhookId) return 'webhook';
    if (id && config.extraBotIds && config.extraBotIds.includes(String(id))) return 'dank';
    return 'other';
}

// True when the text carries something worth recording: a balance, a hunt or
// dig result, a miss, or a refusal. An unreferenced message must look like a
// result before it may claim a pending command, so unrelated chatter in the
// channel cannot consume the slot and make the real reply look unsolicited.
function looksLikeResult(text) {
    const t = String(text || '');
    if (!t) return false;
    return parsing.hasBalanceMarkers(t)
        || parsing.isMiss(t)
        || parsing.HUNT_HIT.test(t)
        || parsing.DIG_HIT.test(t)
        || parsing.isFailure(t);
}

// Decides whether a message answers a pending command, and which one.
//
// Strict: a reference id must name a command we sent. Without a reference, the
// message must come from Dank Memer (or its webhook) and carry a result, and it
// is matched to the oldest unanswered command.
//
// Returns { command, key, reason } or null. `key` is the pending entry to
// clear, so the caller never has to work out which one it was.
function attribute(acct, message) {
    const kind = authorKind(message);
    if (kind === 'other') return null;

    const refId = message.reference && message.reference.messageId;
    if (refId) {
        if (!acct.pending.has(refId)) return null;
        return { command: acct.pending.get(refId), key: refId, reason: `reference:${refId}` };
    }

    const text = textOf(message);
    if (!looksLikeResult(text)) return null;
    const first = acct.pending.keys().next();
    if (first.done) return null;
    return { command: acct.pending.get(first.value), key: first.value, reason: `unreferenced:${kind}` };
}

module.exports = {
    DANK_MEMER_ID,
    INBOUND_LOG,
    textOf,
    describe,
    record,
    emojisIn,
    authorKind,
    attribute,
    looksLikeResult,
};
