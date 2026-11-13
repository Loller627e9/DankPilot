const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const grinder = require('./grinder');
const ui = require('./ui');
const E = require('./emojis');

const PREFIX = config.commandPrefix;

// Permissions -----------------------------------------------------------------

function loadAccess() {
    return store.readJSON(config.accessPath, { ownerId: config.ownerId, authorizedUsers: [] });
}

function saveAccess(data) {
    try {
        store.writeJSON(config.accessPath, data);
        return true;
    } catch {
        return false;
    }
}

function hasPermission(userId) {
    const access = loadAccess();
    const authorized = Array.isArray(access.authorizedUsers) ? access.authorizedUsers : [];
    return userId === access.ownerId || userId === config.ownerId || authorized.includes(userId);
}

function loadTokens() {
    return store.readJSON(config.tokensPath, { tokens: [] });
}

// Helpers ---------------------------------------------------------------------

function error(text, useCustom) {
    return ui.statusPayload('error', text, useCustom);
}

function success(text, useCustom) {
    return ui.statusPayload('success', text, useCustom);
}

function requireIndex(raw) {
    const index = parseInt(raw, 10);
    return Number.isInteger(index) && index >= 0 ? index : null;
}

// Command handlers ------------------------------------------------------------

async function handleCommand(message) {
    if (!message.content.startsWith(PREFIX)) return;

    const useCustom = ui.inGuild(message);

    if (!hasPermission(message.author.id)) {
        return message.reply(error('You do not have permission to use this bot.', useCustom));
    }

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();

    try {
        switch (cmd) {
            case 'help':
                return message.reply(ui.helpPayload(useCustom));

            case 'stats':
                return message.reply(ui.statsPayload(grinder.getAllStats(), loadTokens(), useCustom));

            case 'ping': {
                const latency = Math.max(0, Date.now() - message.createdTimestamp);
                return message.reply(success(`Pong! \`${latency}ms\` • uptime \`${Math.round(process.uptime())}s\``, useCustom));
            }

            case 'add-token': {
                if (args.length < 2) {
                    return message.reply(error(`Usage: \`${PREFIX}add-token <token> <channelId>\``, useCustom));
                }
                const [token, channelId] = args;
                if (!/^\d{16,20}$/.test(channelId)) {
                    return message.reply(error('Channel ID must be a numeric Discord channel ID.', useCustom));
                }
                if (!grinder.addToken(token, channelId)) {
                    return message.reply(error('That token is already registered.', useCustom));
                }
                const login = await grinder.startClient(token, channelId);
                return message.reply(login.ok
                    ? success(`Added and logged in \`${grinder.maskToken(token)}\``, useCustom)
                    : error(`Added, but login failed for \`${grinder.maskToken(token)}\``, useCustom));
            }

            case 'remove-token': {
                const index = requireIndex(args[0]);
                if (index === null) return message.reply(error('Usage: `remove-token <index>`', useCustom));
                const removed = await grinder.removeToken(index);
                return message.reply(removed
                    ? success(`Removed account at index ${index}.`, useCustom)
                    : error(`No account at index ${index}.`, useCustom));
            }

            case 'toggle': {
                const index = requireIndex(args[0]);
                if (index === null) return message.reply(error('Usage: `toggle <index>`', useCustom));
                const data = loadTokens();
                const entry = data.tokens[index];
                if (!entry) return message.reply(error(`No account at index ${index}.`, useCustom));

                const nowActive = !entry.active;
                const ok = await grinder.toggleToken(index);
                if (!ok) return message.reply(error('Failed to toggle account.', useCustom));
                return message.reply(nowActive
                    ? success(`Activated \`${grinder.maskToken(entry.token)}\``, useCustom)
                    : success(`Deactivated \`${grinder.maskToken(entry.token)}\``, useCustom));
            }

            case 'start-all': {
                const count = await grinder.startAllClients(message);
                return message.reply(success(`Started ${count} farming client(s).`, useCustom));
            }

            case 'stop-all': {
                const count = await grinder.stopAllClients();
                return message.reply(success(`Stopped ${count} farming client(s).`, useCustom));
            }

            case 'grant': {
                const id = (args[0] || '').replace(/[<@!>]/g, '');
                if (!/^\d{16,20}$/.test(id)) {
                    return message.reply(error(`Usage: \`${PREFIX}grant <@user>\``, useCustom));
                }
                const access = loadAccess();
                access.authorizedUsers = access.authorizedUsers || [];
                if (access.authorizedUsers.includes(id)) {
                    return message.reply(error('That user already has access.', useCustom));
                }
                access.authorizedUsers.push(id);
                return message.reply(saveAccess(access)
                    ? success(`Granted access to <@${id}>`, useCustom)
                    : error('Failed to save access list.', useCustom));
            }

            case 'revoke': {
                const id = (args[0] || '').replace(/[<@!>]/g, '');
                if (!/^\d{16,20}$/.test(id)) {
                    return message.reply(error(`Usage: \`${PREFIX}revoke <@user>\``, useCustom));
                }
                const access = loadAccess();
                access.authorizedUsers = access.authorizedUsers || [];
                const pos = access.authorizedUsers.indexOf(id);
                if (pos === -1) return message.reply(error('That user is not authorized.', useCustom));
                access.authorizedUsers.splice(pos, 1);
                return message.reply(saveAccess(access)
                    ? success(`Revoked access from <@${id}>`, useCustom)
                    : error('Failed to save access list.', useCustom));
            }

            case 'emojis-reload': {
                E.reload();
                const count = Object.keys(E.FALLBACK).filter(n => E.hasCustom(n)).length;
                return message.reply(success(`Reloaded custom emojis (${count} active).`, useCustom));
            }

            case 'reset-stats': {
                return message.reply(grinder.resetStats()
                    ? success('Stats reset.', useCustom)
                    : error('Failed to reset stats.', useCustom));
            }

            case 'export-stats': {
                const exported = grinder.exportStats();
                return message.reply(exported
                    ? success(`Exported: \`${path.basename(exported)}\``, useCustom)
                    : error('Export failed.', useCustom));
            }

            default:
                return message.reply(error(`Unknown command. Use \`${PREFIX}help\`.`, useCustom));
        }
    } catch (err) {
        console.error(`[CMD ERROR] ${cmd}:`, err);
        return message.reply(error('Internal error. Check the console log.', useCustom)).catch(() => {});
    }
}

module.exports = { handleCommand, hasPermission, PREFIX };
