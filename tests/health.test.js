const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startHealthServer } = require('../health');

function get(port, path) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

test('the health server reports ok and the running count', async () => {
    process.env.PORT = '19891';
    const server = startHealthServer(() => 3);
    assert.ok(server, 'server started');
    await new Promise((r) => server.once('listening', r));

    const res = await get(19891, '/health');
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.running, 3);

    await new Promise((r) => server.close(r));
});

test('an unknown path is a 404', async () => {
    process.env.PORT = '19892';
    const server = startHealthServer();
    await new Promise((r) => server.once('listening', r));
    const res = await get(19892, '/nope');
    assert.strictEqual(res.status, 404);
    await new Promise((r) => server.close(r));
});

test('a throwing counter still answers with a 200', async () => {
    process.env.PORT = '19893';
    const server = startHealthServer(() => { throw new Error('boom'); });
    await new Promise((r) => server.once('listening', r));
    const res = await get(19893, '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(JSON.parse(res.body).running, 0);
    await new Promise((r) => server.close(r));
});

test('the debug route returns the raw inbound payload', async () => {
    process.env.PORT = '19894';
    delete process.env.DEBUG_KEY;
    const server = startHealthServer(() => 1, (limit) => ({ ok: true, inbound: [{ text: 'hi', n: limit }] }));
    await new Promise((r) => server.once('listening', r));
    const res = await get(19894, '/debug?limit=5');
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.inbound[0].n, 5);
    await new Promise((r) => server.close(r));
});

test('the debug route is 404 when no source is wired', async () => {
    process.env.PORT = '19895';
    const server = startHealthServer(() => 1);
    await new Promise((r) => server.once('listening', r));
    assert.strictEqual((await get(19895, '/debug')).status, 404);
    await new Promise((r) => server.close(r));
});

test('the debug route needs the key when one is set', async () => {
    process.env.PORT = '19896';
    process.env.DEBUG_KEY = 'sekret';
    const server = startHealthServer(() => 1, () => ({ ok: true }));
    await new Promise((r) => server.once('listening', r));
    assert.strictEqual((await get(19896, '/debug')).status, 403);
    assert.strictEqual((await get(19896, '/debug?key=sekret')).status, 200);
    delete process.env.DEBUG_KEY;
    await new Promise((r) => server.close(r));
});

test('no PORT means no server, so local runs are unaffected', () => {
    delete process.env.PORT;
    assert.strictEqual(startHealthServer(), null);
});
