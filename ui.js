// Embed builders for the admin bot, styled with the bundled artwork.
//
// Kept separate from the command layer so the message shapes can be reasoned
// about and tested without a Discord connection.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const E = require('./emojis');
const config = require('./config');

const COLOR = 0x00AE86;
const COLOR_OK = 0x50E682;
const COLOR_ERR = 0xF0505A;
const ASSET_DIR = path.join(__dirname, 'assets');

function asset(name) {
    return new AttachmentBuilder(path.join(ASSET_DIR, name), { name });
}

function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function totalOf(stats) {
    const total = { coins: 0, commands: 0, items: 0, animals: 0, failures: 0 };
    for (const s of Object.values((stats && stats.stats) || {})) {
        for (const key of Object.keys(total)) total[key] += Number(s[key]) || 0;
    }
    return total;
}

// stats = stats.getAllStats(); tokens = store.loadTokens()
function statsPayload(stats, tokens) {
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${E.dk_farm} ${config.brandName} — Dashboard`)
        .setImage('attachment://stats_bg.png')
        .setFooter({ text: `${config.brandName} · live stats` })
        .setTimestamp();

    const files = [asset('stats_bg.png')];
    const all = (stats && stats.stats) || {};
    const list = (tokens && tokens.tokens) || [];

    if (!Object.keys(all).length) {
        return {
            embeds: [embed.setDescription(`${E.dk_sparkle} No stats yet. Start the farm with \`$start-all\`.`)],
            files,
        };
    }

    const total = totalOf(stats);
    const lines = [];
    list.forEach((t, i) => {
        const s = all[t.token];
        if (!s) return;
        const dot = t.active ? E.dk_on : E.dk_off;
        lines.push(
            `${dot} **#${i} ${s.name}**\n` +
            `> ${E.dk_coin} \`${fmt(s.coins)}\`  ${E.dk_paw} \`${s.animals}\`  ` +
            `${E.dk_gift} \`${s.items}\`  ${E.dk_cmds} \`${s.commands}\`  ${E.dk_fail} \`${s.failures}\``
        );
    });

    const active = list.filter(t => t.active).length;
    embed
        .setDescription(lines.join('\n\n').slice(0, 4000) || `${E.dk_sparkle} No accounts registered yet.`)
        .addFields(
            { name: `${E.dk_coin} Coins`, value: `**${fmt(total.coins)}**`, inline: true },
            { name: `${E.dk_paw} Animals`, value: `**${fmt(total.animals)}**`, inline: true },
            { name: `${E.dk_gift} Items`, value: `**${fmt(total.items)}**`, inline: true },
            { name: `${E.dk_cmds} Commands`, value: `**${fmt(total.commands)}**`, inline: true },
            { name: `${E.dk_fail} Fails`, value: `**${fmt(total.failures)}**`, inline: true },
            { name: `${E.dk_farm} Accounts`, value: `**${active}/${list.length}** active`, inline: true }
        );
    return { embeds: [embed], files };
}

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

// kind: 'success' | 'error'
function statusPayload(kind, text) {
    const ok = kind === 'success';
    const img = ok ? 'success_bg.png' : 'error_bg.png';
    const embed = new EmbedBuilder()
        .setColor(ok ? COLOR_OK : COLOR_ERR)
        .setDescription(`${ok ? E.dk_on : E.dk_fail} ${text}`)
        .setImage(`attachment://${img}`);
    return { embeds: [embed], files: [asset(img)] };
}

// Per-account card, used by the panel's account pages.
function accountPayload(index, entry, stat, running, total) {
    const embed = new EmbedBuilder()
        .setColor(running ? COLOR_OK : 0x808090)
        .setTitle(`${E.dk_farm} ${stat.name || 'unknown'}`)
        .setDescription(`Account **#${index}** · ${running ? `${E.dk_on} Farming` : `${E.dk_off} Stopped`}`)
        .setImage('attachment://account_card_bg.png')
        .addFields(
            { name: `${E.dk_coin} Coins earned`, value: `**${fmt(stat.coins)}**`, inline: true },
            { name: `${E.dk_paw} Animals`, value: `**${fmt(stat.animals)}**`, inline: true },
            { name: `${E.dk_gift} Items`, value: `**${fmt(stat.items)}**`, inline: true },
            { name: `${E.dk_cmds} Commands`, value: `**${fmt(stat.commands)}**`, inline: true },
            { name: `${E.dk_fail} Failures`, value: `**${fmt(stat.failures)}**`, inline: true },
            { name: 'Token', value: `\`${mask(entry.token)}\``, inline: true }
        )
        .setFooter({ text: `Page ${index + 1} of ${total} · ${config.brandName}` })
        .setTimestamp();
    return { embeds: [embed], files: [asset('account_card_bg.png')] };
}

function mask(token) {
    const s = String(token || '');
    if (s.length <= 8) return '***';
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

module.exports = { statsPayload, helpPayload, statusPayload, accountPayload, fmt, totalOf, mask, COLOR };
