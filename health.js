// Keep-alive web server.
//
// Free hosts need the process to answer on $PORT, and pinging that endpoint on
// a timer stops an idle instance from being slept. Extracted from the
// entrypoint so it can be started (and tested) on its own.
const http = require('http');

// `countRunning` is injected so this module has no dependency on the grinder.
function startHealthServer(countRunning = () => 0) {
    const port = Number(process.env.PORT);
    if (!Number.isFinite(port) || port <= 0) return null;

    const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            let running = 0;
            try { running = countRunning(); } catch { /* report 0 rather than fail */ }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), running }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
    });

    server.on('error', (err) => {
        // A port already in use is not fatal: some hosts supply their own
        // keep-alive, and the bot itself does not depend on this listener.
        console.warn(`Health server could not bind to ${port}: ${err.message}`);
    });

    server.listen(port, () => console.log(`Health server listening on ${port}`));
    return server;
}

function startSelfPing() {
    const url = process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL;
    if (!url) return null;
    const interval = Number(process.env.SELF_PING_MS) || 240000;
    const target = `${String(url).replace(/\/$/, '')}/health`;
    const timer = setInterval(() => {
        const req = http.get(target, (res) => res.resume());
        req.on('error', () => { /* transient network hiccup */ });
    }, interval);
    // Do not hold the event loop open just for the ping.
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = { startHealthServer, startSelfPing };
