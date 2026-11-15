// Command handling for the admin bot.
//
// Command names, arguments and replies are unchanged from the original bot.
// What changed is underneath: permission checks work when access.json is
// missing, the file reads are guarded, and the replies are the styled UI
// payloads.
const path = require('path');
const config = require('./config');
const store = require('./store');
const grinder = require('./grinder');
const ui = require('./ui');
const panel = require('./panel');

const PREFIX = config.prefix;

function loadAccess() {
    return store.loadAccess();
}

function saveAccess(data) {
    return store.saveAccess(data);
}

function hasPermission(userId) {
    if (userId === undefined || userId === null) return false;
    const id = String(userId);
    const access = loadAccess();
    if (access.ownerId && id === access.ownerId) return true;
    // Compared as strings: ids from chat input are strings, and a numeric id in
    // the file would otherwise never match.
    return access.authorizedUsers.map(String).includes(id);
}

// Discord replies accept either a plain string or a payload object. Keeping
// both paths means a UI failure can never leave the user without an answer.
function reply(message, payload) {
    return message.reply(payload);
}

function status(message, kind, text) {
    try {
        return reply(message, ui.statusPayload(kind, text));
    } catch {
        return reply(message, text);
    }
}

async function handleCommand(message) {
    const content = (message && message.content) || '';
    if (!content.startsWith(PREFIX)) return;

    if (!hasPermission(message.author && message.author.id)) {
        return reply(message, '❌ No permission.');
    }

    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = (args.shift() || '').toLowerCase();

    try {
        switch (cmd) {
            case 'help':
                return reply(message, ui.helpPayload());

            case 'stats': {
                // Paginated: page 0 is the overview, then one page per account.
                // The nav row is attached so the panel is browsable.
                const view = panel.message(0);
                return reply(message, view);
            }

            case 'add-token': {
                if (args.length < 2) {
                    return status(message, 'error', `Usage: \`${PREFIX}add-token <token> <channelId>\``);
                }
                const [token, channelId] = args;
                if (!/^\d+$/.test(channelId)) {
                    return status(message, 'error', 'Channel ID must be numeric.');
                }
                const added = grinder.addToken(token, channelId);
                if (!added) return status(message, 'error', 'Failed to add token.');
                const login = await grinder.startClient(token, channelId);
                return login
                    ? status(message, 'success', `Added and logged in \`${grinder.maskToken(token)}\``)
                    : status(message, 'error', `Login failed for \`${grinder.maskToken(token)}\``);
            }

            case 'remove-token': {
                const index = parseInt(args[0], 10);
                if (Number.isNaN(index)) return status(message, 'error', 'Invalid index.');
                const ok = await grinder.removeToken(index);
                return ok
                    ? status(message, 'success', `Removed token at index ${index}`)
                    : status(message, 'error', 'Failed to remove token.');
            }

            case 'toggle': {
                const index = parseInt(args[0], 10);
                if (Number.isNaN(index)) return status(message, 'error', 'Invalid index.');
                const res = await grinder.toggleToken(index);
                if (res === false) return status(message, 'error', 'Index not found.');
                if (!res.ok) {
                    return status(message, 'error', `Login failed for \`${grinder.maskToken(args[0])}\``);
                }
                return res.active
                    ? status(message, 'success', 'Account activated.')
                    : status(message, 'success', 'Account stopped.');
            }

            case 'start-all': {
                const count = await grinder.startAllClients(message);
                return status(message, 'success', `Started ${count} client(s).`);
            }

            case 'stop-all': {
                const stopped = await grinder.stopAllClients();
                return status(message, 'success', `Stopped ${stopped} client(s).`);
            }

            case 'grant': {
                const id = (args[0] || '').replace(/[<@!>]/g, '');
                if (!id || !/^\d+$/.test(id)) {
                    return status(message, 'error', `Usage: \`${PREFIX}grant <@user>\``);
                }
                const access = loadAccess();
                if (access.authorizedUsers.includes(id)) {
                    return status(message, 'error', 'Already has access.');
                }
                access.authorizedUsers.push(id);
                return saveAccess(access)
                    ? status(message, 'success', `Granted access to <@${id}>`)
                    : status(message, 'error', 'Failed to grant.');
            }

            case 'revoke': {
                const id = (args[0] || '').replace(/[<@!>]/g, '');
                if (!id || !/^\d+$/.test(id)) {
                    return status(message, 'error', `Usage: \`${PREFIX}revoke <@user>\``);
                }
                const access = loadAccess();
                const at = access.authorizedUsers.indexOf(id);
                if (at === -1) return status(message, 'error', 'Not authorized.');
                access.authorizedUsers.splice(at, 1);
                return saveAccess(access)
                    ? status(message, 'success', `Revoked access from <@${id}>`)
                    : status(message, 'error', 'Failed to revoke.');
            }

            case 'debug': {
                // Shows what the bot is actually receiving. When tracking reads
                // nothing, this is the first place to look.
                const lines = [];
                lines.push('**Accounts**');
                for (const a of grinder.accountStatus()) {
                    lines.push(`• ${a.label} — ${a.ready ? 'ready' : 'not ready'}, pending ${a.pending}, idle ${Math.round(a.idleMs / 1000)}s`);
                }
                const wrong = grinder.foreignChannels();
                if (wrong.length) {
                    lines.push('');
                    lines.push('**Dank Memer replied in other channel(s)** — check the channel id');
                    for (const c of wrong.slice(0, 3)) {
                        lines.push(`• \`${c.channelId}\` x${c.count}: ${JSON.stringify((c.sample || '').slice(0, 80))}`);
                    }
                }
                const recent = grinder.recentInbound(3);
                lines.push('');
                lines.push(`**Last ${recent.length} inbound message(s)**`);
                if (!recent.length) {
                    lines.push('• none recorded yet — the bot has not seen a message in the farm channel');
                }
                for (const m of recent) {
                    lines.push(`• from \`${m.authorName || m.authorId}\`${m.webhookId ? ' (webhook)' : ''} ref=${m.reference || '-'}`);
                    lines.push(`  text: ${JSON.stringify((m.text || '').slice(0, 200))}`);
                    if (m.emojis && m.emojis.length) {
                        lines.push(`  emojis: ${m.emojis.map(e => `${e.animated ? 'animated ' : ''}${e.name}`).join(', ')}`);
                    }
                }
                return reply(message, { content: lines.join('\n').slice(0, 1900) });
            }

            case 'reset-stats': {
                const ok = require('./stats').resetStats();
                return ok
                    ? status(message, 'success', 'Stats reset.')
                    : status(message, 'error', 'Failed to reset stats.');
            }

            case 'export-stats': {
                const file = require('./stats').exportStats();
                return file
                    ? status(message, 'success', `Exported: \`${path.basename(file)}\``)
                    : status(message, 'error', 'Export failed.');
            }

            default:
                return status(message, 'error', `Unknown command. Use \`${PREFIX}help\`.`);
        }
    } catch (err) {
        console.error(`[CMD ERROR] ${cmd}:`, err);
        return status(message, 'error', 'Internal error.');
    }
}

module.exports = { handleCommand, hasPermission, loadAccess, saveAccess, PREFIX };
