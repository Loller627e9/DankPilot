// Embed builders. Every command reply goes through here so the look is
// consistent and the custom emojis degrade cleanly to unicode when needed.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const E = require('./emojis');

const COLOR = 0x00AE86;
const OK_COLOR = 0x50E682;
const ERR_COLOR = 0xF0505A;
const MAX_DESCRIPTION = 4000;

const asset = name => new AttachmentBuilder(path.join(__dirname, 'assets', name), { name });
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');

// A reply is only allowed to use custom emojis when it is going to a guild
// channel, because uploaded emojis do not render in DMs.
function inGuild(message) {
    return Boolean(message && message.guild);
}

// stats = grinder.getAllStats(); tokens = store.readJSON(tokensPath)
function statsPayload(stats, tokens, useCustom = true) {
    const e = name => E.get(name, useCustom);
    const accounts = Array.isArray(tokens?.tokens) ? tokens.tokens : [];
    const all = (stats && stats.stats) || {};

    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🚜 Farm Dashboard')
        .setFooter({ text: `Dank Farm • ${accounts.length} account(s) • live stats` })
        .setTimestamp();

    if (!Object.keys(all).length) {
        return {
            embeds: [embed.setDescription(`${e('dk_sparkle')} No stats yet. Start the farm with \`$start-all\`.`)],
            files: []
        };
    }

    const total = { coins: 0, commands: 0, items: 0, animals: 0, failures: 0 };
    const lines = [];
    accounts.forEach((t, i) => {
        const s = all[t.token];
        if (!s) return;
        for (const key of Object.keys(total)) total[key] += Number(s[key]) || 0;
        const dot = t.active ? e('dk_on') : e('dk_off');
        lines.push(
            `${dot} **#${i} ${s.name}**\n` +
            `> ${e('dk_coin')} \`${fmt(s.coins)}\`  ${e('dk_paw')} \`${s.animals}\`  ` +
            `${e('dk_gift')} \`${s.items}\`  ${e('dk_cmds')} \`${s.commands}\`  ${e('dk_fail')} \`${s.failures}\``
        );
    });

    if (!lines.length) {
        return {
            embeds: [embed.setDescription(`${e('dk_sparkle')} No accounts to show. Add one with \`$add-token\`.`)],
            files: []
        };
    }

    const description = lines.join('\n\n');
    embed.setDescription(description.length > MAX_DESCRIPTION
        ? description.slice(0, MAX_DESCRIPTION - 3) + '...'
        : description);

    const active = accounts.filter(t => t.active).length;
    embed.addFields(
        { name: `${e('dk_coin')} Coins`, value: `**${fmt(total.coins)}**`, inline: true },
        { name: `${e('dk_paw')} Animals`, value: `**${total.animals}**`, inline: true },
        { name: `${e('dk_gift')} Items`, value: `**${total.items}**`, inline: true },
        { name: `${e('dk_cmds')} Commands`, value: `**${fmt(total.commands)}**`, inline: true },
        { name: `${e('dk_fail')} Failures`, value: `**${total.failures}**`, inline: true },
        { name: `${e('dk_farm')} Accounts`, value: `**${active}/${accounts.length}** active`, inline: true }
    );

    return { embeds: [embed], files: [asset('stats_bg.png')] };
}

function helpPayload(useCustom = true) {
    const e = name => E.get(name, useCustom);
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🤖 Dank Farm • Command Center')
        .setDescription(`${e('dk_sparkle')} Admin panel for your Dank Memer farming accounts.`)
        .addFields(
            { name: `${e('dk_coin')} Stats & Info`, value: '`$help`  `$stats`  `$ping`' },
            { name: `${e('dk_cmds')} Accounts`, value: '`$add-token <token> <channelId>`\n`$remove-token <index>`\n`$toggle <index>`' },
            { name: `${e('dk_farm')} Control`, value: '`$start-all`  `$stop-all`' },
            { name: `${e('dk_paw')} Access`, value: '`$grant <@user>`  `$revoke <@user>`' },
            { name: `${e('dk_gift')} Data`, value: '`$reset-stats`  `$export-stats`  `$emojis-reload`' }
        )
        .setFooter({ text: 'Prefix: $ • admin only' })
        .setTimestamp();
    return { embeds: [embed], files: [asset('help_banner.png')] };
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
