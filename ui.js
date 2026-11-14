// Embed builders for the admin bot, styled with the bundled artwork.
//
// The stats view is paginated: page 0 is the overview, then one page per
// account. Page building is pure (no Discord interaction), so it can be tested
// directly; panel.js drives the buttons.
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const E = require('./emojis');
const config = require('./config');

const COLOR = 0x00AE86;
const COLOR_OK = 0x50E682;
const COLOR_ERR = 0xF0505A;
const COLOR_IDLE = 0x808090;
const ASSET_DIR = path.join(__dirname, 'assets');
const DESC_LIMIT = 4000;

function asset(name) {
    return new AttachmentBuilder(path.join(ASSET_DIR, name), { name });
}

function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function pct(part, whole) {
    if (!whole) return '—';
    return `${Math.round((part / whole) * 100)}%`;
}

function mask(token) {
    const s = String(token || '');
    if (s.length <= 8) return '***';
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

// A stat row that predates a field (or a hand-edited file) must not crash the
// renderer, so every number is read through here.
function statOf(stats, token) {
    const raw = (stats && stats.stats && stats.stats[token]) || {};
    return {
        name: raw.name || mask(token),
        coins: Number(raw.coins) || 0,
        lastTotal: Number(raw.lastTotal) || 0,
        commands: Number(raw.commands) || 0,
        animals: Number(raw.animals) || 0,
        items: Number(raw.items) || 0,
        catches: Number(raw.catches) || 0,
        failures: Number(raw.failures) || 0,
        misses: Number(raw.misses) || 0,
        extras: raw.extras && typeof raw.extras === 'object' ? raw.extras : {},
    };
}

function totalOf(stats) {
    const total = { coins: 0, commands: 0, items: 0, animals: 0, catches: 0, failures: 0, misses: 0 };
    for (const entry of Object.values((stats && stats.stats) || {})) {
        for (const key of Object.keys(total)) total[key] += Number(entry[key]) || 0;
    }
    return total;
}

function extrasLine(extras) {
    const entries = Object.entries(extras || {});
    if (!entries.length) return null;
    return entries.map(([k, v]) => `${k} \`${fmt(v)}\``).join('  ');
}

// -- pages -------------------------------------------------------------------
// page 0 = overview, page N = account N-1. Total pages = accounts + 1.
function totalPages(tokens) {
    return ((tokens && tokens.tokens) || []).length + 1;
}

function overviewPayload(stats, tokens, running) {
    const list = (tokens && tokens.tokens) || [];
    const total = totalOf(stats);
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${E.dk_farm} ${config.brandName} — Overview`)
        .setImage('attachment://stats_bg.png')
        .setFooter({ text: `${config.brandName} · page 1 of ${totalPages(tokens)}` })
        .setTimestamp();

    if (!list.length) {
        embed.setDescription(
            `${E.dk_sparkle} No accounts yet.\n` +
            `Add one with \`${config.prefix}add-token <token> <channelId>\`, or set \`FARM_ACCOUNTS\`.`
        );
        return { embeds: [embed], files: [asset('stats_bg.png')] };
    }

    const lines = list.map((t, i) => {
        const s = statOf(stats, t.token);
        const dot = running.has(t.token) ? E.dk_on : E.dk_off;
        const hits = s.catches + s.misses;
        return `${dot} **#${i} ${s.name}** — ${E.dk_coin} \`${fmt(s.coins)}\` ` +
            `${E.dk_paw} \`${s.animals}\` ${E.dk_gift} \`${s.items}\` ` +
            `${E.dk_fail} \`${s.misses}\` missed · hit \`${pct(s.catches, hits)}\``;
    });

    const active = list.filter(t => running.has(t.token)).length;
    embed
        .setDescription(lines.join('\n').slice(0, DESC_LIMIT))
        .addFields(
            { name: `${E.dk_coin} Coins`, value: `**${fmt(total.coins)}**`, inline: true },
            { name: `${E.dk_paw} Animals`, value: `**${fmt(total.animals)}**`, inline: true },
            { name: `${E.dk_gift} Items`, value: `**${fmt(total.items)}**`, inline: true },
            { name: `${E.dk_cmds} Commands`, value: `**${fmt(total.commands)}**`, inline: true },
            { name: `${E.dk_fail} Misses`, value: `**${fmt(total.misses)}**`, inline: true },
            { name: `${E.dk_farm} Farming`, value: `**${active}/${list.length}**`, inline: true }
        );
    return { embeds: [embed], files: [asset('stats_bg.png')] };
}

function accountPayload(index, tokens, stats, running) {
    const list = tokens.tokens || [];
    const entry = list[index];
    const s = statOf(stats, entry.token);
    const isRunning = running.has(entry.token);
    const hits = s.catches + s.misses;

    const embed = new EmbedBuilder()
        .setColor(isRunning ? COLOR_OK : COLOR_IDLE)
        .setTitle(`${E.dk_farm} ${s.name}`)
        .setDescription(
            `Account **#${index}** · ${isRunning ? `${E.dk_on} Farming` : `${E.dk_off} Stopped`}\n` +
            `Channel \`${entry.channelId}\` · token \`${mask(entry.token)}\``
        )
        .setImage('attachment://account_card_bg.png')
        .addFields(
            { name: `${E.dk_coin} Coins earned`, value: `**${fmt(s.coins)}**`, inline: true },
            { name: 'Balance', value: `**${fmt(s.lastTotal)}**`, inline: true },
            { name: `${E.dk_cmds} Commands`, value: `**${fmt(s.commands)}**`, inline: true },
            { name: `${E.dk_paw} Animals caught`, value: `**${fmt(s.animals)}**`, inline: true },
            { name: `${E.dk_gift} Items dug`, value: `**${fmt(s.items)}**`, inline: true },
            { name: `${E.dk_fail} Missed`, value: `**${fmt(s.misses)}**`, inline: true },
            { name: 'Hit rate', value: `**${pct(s.catches, hits)}**`, inline: true },
            { name: 'Errors', value: `**${fmt(s.failures)}**`, inline: true },
            { name: 'Catches', value: `**${fmt(s.catches)}**`, inline: true }
        )
        .setFooter({ text: `${config.brandName} · page ${index + 2} of ${totalPages(tokens)}` })
        .setTimestamp();

    const extras = extrasLine(s.extras);
    if (extras) embed.addFields({ name: `${E.dk_sparkle} Other`, value: extras });

    return { embeds: [embed], files: [asset('account_card_bg.png')] };
}

// Builds one page of the stats panel. `page` is clamped, so a stale button
// press after accounts were removed cannot ask for a page that is gone.
function statsPage(page, stats, tokens, running = new Set()) {
    const pages = totalPages(tokens);
    const clamped = Math.max(0, Math.min(Number(page) || 0, pages - 1));
    const payload = clamped === 0
        ? overviewPayload(stats, tokens, running)
        : accountPayload(clamped - 1, tokens, stats, running);
    return { ...payload, page: clamped, pages };
}

function navRow(page, pages) {
    if (pages <= 1) return [];
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('stats:first').setLabel('«').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('stats:prev').setLabel('‹ Prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('stats:next').setLabel('Next ›').setStyle(ButtonStyle.Primary).setDisabled(page >= pages - 1),
        new ButtonBuilder().setCustomId('stats:last').setLabel('»').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    )];
}

// Applies a nav button to the current page, returning the new page number.
function nextPage(action, page, pages) {
    switch (action) {
        case 'first': return 0;
        case 'prev': return Math.max(0, page - 1);
        case 'next': return Math.min(pages - 1, page + 1);
        case 'last': return pages - 1;
        default: return page;
    }
}

// -- command replies ---------------------------------------------------------
function helpPayload() {
    const p = config.prefix;
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${E.dk_farm} ${config.brandName} — Commands`)
        .setDescription(`${E.dk_sparkle} Admin panel for your farming accounts.`)
        .setImage('attachment://help_banner.png')
        .addFields(
            { name: `${E.dk_coin} Stats & Info`, value: `\`${p}help\`  \`${p}stats\`` },
            { name: `${E.dk_cmds} Accounts`, value: `\`${p}add-token <token> <channelId>\`\n\`${p}remove-token <index>\`\n\`${p}toggle <index>\`` },
            { name: `${E.dk_farm} Control`, value: `\`${p}start-all\`  \`${p}stop-all\`` },
            { name: `${E.dk_paw} Access`, value: `\`${p}grant <@user>\`  \`${p}revoke <@user>\`` },
            { name: `${E.dk_gift} Data`, value: `\`${p}reset-stats\`  \`${p}export-stats\`` }
        )
        .setFooter({ text: `Prefix: ${p}` })
        .setTimestamp();
    return { embeds: [embed], files: [asset('help_banner.png')] };
}

function statusPayload(kind, text) {
    const ok = kind === 'success';
    const img = ok ? 'success_bg.png' : 'error_bg.png';
    const embed = new EmbedBuilder()
        .setColor(ok ? COLOR_OK : COLOR_ERR)
        .setDescription(`${ok ? E.dk_on : E.dk_fail} ${text}`)
        .setImage(`attachment://${img}`);
    return { embeds: [embed], files: [asset(img)] };
}

module.exports = {
    statsPage,
    overviewPayload,
    accountPayload,
    navRow,
    nextPage,
    totalPages,
    helpPayload,
    statusPayload,
    statOf,
    totalOf,
    fmt,
    pct,
    mask,
    COLOR,
};
