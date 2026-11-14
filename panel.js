// The interactive stats panel.
//
// Page 0 is the overview; pages 1..n are one account each. Navigation is the
// only control — accounts start on boot and are managed with commands, so the
// panel has no start/stop buttons.
const ui = require('./ui');
const store = require('./store');

// Kept so a page press cannot be answered with a page that no longer exists
// after accounts were added or removed.
function currentPage(action, page) {
    const tokens = store.loadTokens();
    const pages = ui.totalPages(tokens);
    return { page: ui.nextPage(action, page, pages), tokens, pages };
}


// Injected by index.js to avoid a require cycle with the grinder.
let runningProvider = () => new Set();
function running() {
    try { return runningProvider() || new Set(); } catch { return new Set(); }
}

function setRunningProvider(fn) {
    runningProvider = fn;
}


// Builds the full message for a page: payload plus the nav row.
function message(page) {
    const { tokens } = currentPage('keep', page);
    const stats = store.loadStats();
    const view = ui.statsPage(page, stats, tokens, running());
    return {
        ...view,
        components: ui.navRow(view.page, view.pages),
    };
}

// The footer reads "page 3 of 7"; recover the 3 so the next press is relative
// to what the user is actually looking at.
function pageFromMessage(message) {
    try {
        let embed = message && message.embeds && message.embeds[0];
        if (!embed) return 0;
        // A live message carries a MessageEmbed; a builder hides its parts until
        // serialised, so accept both shapes.
        if (typeof embed.toJSON === 'function') embed = embed.toJSON();
        const footer = embed.footer && embed.footer.text;
        const match = /page (\d+)/i.exec(footer || '');
        return match ? Math.max(0, Number(match[1]) - 1) : 0;
    } catch {
        return 0;
    }
}

module.exports = { message, setRunningProvider, currentPage, pageFromMessage };
