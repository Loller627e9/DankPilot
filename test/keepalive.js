// Verifies the keep-alive server answers /health and 404s everything else.
process.env.KEEP_ALIVE = 'true';
process.env.PORT = '4987';
process.env.SELF_URL = '';
process.env.BOT_TOKEN = 'test-token';
process.env.OWNER_ID = '1289854729324724304';
process.env.DATA_DIR = 'storage-test';

const assert = require('assert');
const keepAlive = require('../keepalive');

const server = keepAlive.start();
assert.ok(server, 'server should start when KEEP_ALIVE=true');

const base = 'http://127.0.0.1:4987';
const get = path => new Promise((resolve, reject) => {
    require('http').get(base + path, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
});

(async () => {
    await new Promise(r => server.once('listening', r));
    const health = await get('/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(JSON.parse(health.body).status, 'ok');
    console.log('  ok  /health returns 200 with status ok');

    const missing = await get('/nope');
    assert.strictEqual(missing.status, 404);
    console.log('  ok  unknown path returns 404');

    server.close();
    console.log('\n2 test(s) passed');
})().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
});
