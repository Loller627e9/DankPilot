// Embed builders. Every command reply goes through here so the look is
// consistent and the custom emojis degrade cleanly to unicode when needed.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const config = require('./config');
const E = require('./emojis');

const PREFIX = config.commandPrefix;

const COLOR = 0x00AE86;
const OK_COLOR = 0x50E682;
const ERR_COLOR = 0xF0505A;
const MAX_DESCRIPTION = 4000;

const asset = name => new AttachmentBuilder(path.join(__dirname, 'assets', name), { name });
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const maskToken = t => (!t ? 'unknown' : t.length <= 10 ? '***' : t.slice(0, 4) + '...' + t.slice(-4));

// A reply is only allowed to use custom emojis when it is going to a guild
// channel, because uploaded emojis do not render in DMs.
function inGuild(message) {
    return Boolean(message && message.guild);
}

// stats = grinder.getAllStats(); tokens = store.readJSON(tokensPath)
// activeTokens = optional Set of tokens with a live client (grinder.getActiveTokens())
function statsPayload(stats, tokens, useCustom = true, activeTokens = null) {
    const e = name => E.get(name, useCustom);
    const accounts = Array.isArray(tokens?.tokens) ? tokens.tokens : [];
    const all = (stats && stats.stats) || {};
    const isRunning = t => (activeTokens ? activeTokens.has(t.token) : Boolean(t.active));
    const fallbackName = t => all[t.token]?.name || maskToken(t.token);

    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🚜 Farm Dashboard')
        .setFooter({ text: `Dank Farm • ${accounts.length} account(s) • live stats` })
        .setTimestamp();

    if (!accounts.length) {
        return {
            embeds: [embed.setDescription(`${e('dk_sparkle')} No accounts yet. Add one with \`${PREFIX}add-token\`.`)],
            files: []
        };
    }

    const total = { coins: 0, commands: 0, items: 0, animals: 0, failures: 0 };
    const lines = [];
    accounts.forEach((t, i) => {
        // Show every registered account, even one that has never been farmed.
        const s = all[t.token] || { coins: 0, animals: 0, items: 0, commands: 0, failures: 0 };
        for (const key of Object.keys(total)) total[key] += Number(s[key]) || 0;
        const dot = isRunning(t) ? e('dk_on') : e('dk_off');
        lines.push(
            `${dot} **#${i}** \`${fallbackName(t)}\`\n` +
            `> ${e('dk_coin')} \`${fmt(s.coins)}\`  ${e('dk_paw')} \`${s.animals}\`  ` +
            `${e('dk_gift')} \`${s.items}\`  ${e('dk_cmds')} \`${s.commands}\`  ${e('dk_fail')} \`${s.failures}\``
        );
    });

    if (!lines.length) {
        return {
            embeds: [embed.setDescription(`${e('dk_sparkle')} No accounts to show. Add one with \`${PREFIX}add-token\`.`)],
            files: []
        };
    }

    const description = lines.join('\n\n');
    embed.setDescription(description.length > MAX_DESCRIPTION
        ? description.slice(0, MAX_DESCRIPTION - 3) + '...'
        : description);

    const active = accounts.filter(isRunning).length;
    embed.addFields(
        { name: `${e('dk_coin')} Coins`, value: `**${fmt(total.coins)}**`, inline: true },
        { name: `${e('dk_paw')} Animals`, value: `**${total.animals}**`, inline: true },
        { name: `${e('dk_gift')} Items`, value: `**${total.items}**`, inline: true },
        { name: `${e('dk_cmds')} Commands`, value: `**${fmt(total.commands)}**`, inline: true },
        { name: `${e('dk_fail')} Failures`, value: `**${total.failures}**`, inline: true },
        { name: `${e('dk_farm')} Accounts`, value: `**${active}/${accounts.length}** active`, inline: true }
    );

    return { embeds: [embed.setImage('attachment://stats_bg.png')], files: [asset('stats_bg.png')] };
}

function helpPayload(useCustom = true) {
    const e = name => E.get(name, useCustom);
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🤖 Dank Farm • Command Center')
        .setDescription(`${e('dk_sparkle')} Admin panel for your Dank Memer farming accounts.`)
        .addFields(
            { name: `${e('dk_coin')} Stats & Info`, value: `\`${PREFIX}help\`  \`${PREFIX}stats\`  \`${PREFIX}ping\`` },
            { name: `${e('dk_cmds')} Accounts`, value: `\`${PREFIX}add-token <token> <channelId>\`\n\`${PREFIX}remove-token <index>\`\n\`${PREFIX}toggle <index>\`` },
            { name: `${e('dk_farm')} Control`, value: `\`${PREFIX}start-all\`  \`${PREFIX}stop-all\`` },
            { name: `${e('dk_paw')} Access`, value: `\`${PREFIX}grant <@user>\`  \`${PREFIX}revoke <@user>\`` },
            { name: `${e('dk_gift')} Data`, value: `\`${PREFIX}reset-stats\`  \`${PREFIX}export-stats\`  \`${PREFIX}emojis-reload\`` }
        )
        .setFooter({ text: `Prefix: ${PREFIX} • admin only` })
        .setTimestamp();
    return { embeds: [embed.setImage('attachment://help_banner.png')], files: [asset('help_banner.png')] };
}

// kind: 'success' | 'error'
function statusPayload(kind, text, useCustom = true) {
    const ok = kind === 'success';
    const img = ok ? 'success_bg.png' : 'error_bg.png';
    const dot = ok ? E.get('dk_on', useCustom) : E.get('dk_fail', useCustom);
    const embed = new EmbedBuilder()
        .setColor(ok ? OK_COLOR : ERR_COLOR)
        .setDescription(`${dot} ${text}`)
        .setImage(`attachment://${img}`)
        .setTimestamp();
    return { embeds: [embed], files: [asset(img)] };
}

module.exports = { statsPayload, helpPayload, statusPayload, inGuild };
