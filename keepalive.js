// Minimal health server + self-ping.
//
// A Render free Web Service is stopped after 15 minutes without inbound
// traffic. Serving /health and periodically pinging our own public URL keeps
// the instance awake without any external uptime service.
const http = require('http');
const config = require('./config');

function start({ onRequest } = {}) {
    if (!config.keepAlive) return null;

    const server = http.createServer((req, res) => {
        if (onRequest && onRequest(req, res)) return;
        if (req.url === '/' || req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
            return;
        }
        res.writeHead(404);
        res.end();
    });

    server.listen(config.port, () => {
        console.log(`🌐 Keep-alive server listening on port ${config.port}`);
    });

    let timer = null;
    if (config.selfUrl) {
        const url = `${config.selfUrl.replace(/\/$/, '')}/health`;
        timer = setInterval(() => {
            fetch(url).catch(err => console.error('Keep-alive ping failed:', err.message));
        }, config.selfPingMs);
        console.log(`🔁 Self-ping enabled -> ${url}`);
    }

    server.on('close', () => { if (timer) clearInterval(timer); });
    return server;
}

module.exports = { start };
