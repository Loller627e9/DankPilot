const test = require('node:test');
const assert = require('node:assert');
const { freshDataDir, load } = require('./helpers');

function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

freshDataDir();

test('environment variables win over config.json', () => {
    withEnv({ BOT_TOKEN: 'from-env', OWNER_ID: '42' }, () => {
        const { config } = load();
        assert.strictEqual(config.botToken, 'from-env');
        assert.strictEqual(config.ownerId, '42');
    });
});

test('a blank env var does not clobber a usable value', () => {
    withEnv({ BOT_TOKEN: '   ', OWNER_ID: '' }, () => {
        const { config } = load();
        assert.notStrictEqual(config.botToken, '   ');
    });
});

test('validate lists every missing required value', () => {
    withEnv({ BOT_TOKEN: undefined, OWNER_ID: undefined }, () => {
        const { config } = load();
        const problems = config.validate();
        assert.ok(problems.some(p => p.includes('BOT_TOKEN')));
        assert.ok(problems.some(p => p.includes('OWNER_ID')));
    });
});

test('validate rejects a placeholder token', () => {
    withEnv({ BOT_TOKEN: 'YOUR_BOT_TOKEN_HERE', OWNER_ID: '123' }, () => {
        const { config } = load();
        assert.ok(config.validate().some(p => p.includes('BOT_TOKEN')));
    });
});

test('validate rejects a non-numeric owner id', () => {
    withEnv({ BOT_TOKEN: 'abc.def.ghi', OWNER_ID: 'not-an-id' }, () => {
        const { config } = load();
        assert.ok(config.validate().some(p => p.includes('OWNER_ID')));
    });
});

test('validate is clean for a usable config', () => {
    withEnv({ BOT_TOKEN: 'abc.def.ghi', OWNER_ID: '1289854729324724304' }, () => {
        const { config } = load();
        assert.deepStrictEqual(config.validate(), []);
    });
});

test('FARM_ACCOUNTS splits on commas and newlines and keeps colons intact', () => {
    const value = 'aaa:111,bbb:222\nccc:333';
    withEnv({ FARM_ACCOUNTS: value }, () => {
        const { config } = load();
        assert.deepStrictEqual(config.farmAccounts, ['aaa:111', 'bbb:222', 'ccc:333']);
    });
});

test('FARM_COMMANDS is split and trimmed', () => {
    withEnv({ FARM_COMMANDS: 'pls beg, pls hunt ,pls dig' }, () => {
        const { config } = load();
        assert.deepStrictEqual(config.commands, ['pls beg', 'pls hunt', 'pls dig']);
    });
});

test('the command prefix defaults to $', () => {
    withEnv({ COMMAND_PREFIX: undefined }, () => {
        const { config } = load();
        assert.strictEqual(config.prefix, '$');
    });
});

test('intervals fall back to sane defaults when unset or invalid', () => {
    withEnv({ COMMAND_INTERVAL: 'nonsense', CYCLE_INTERVAL: undefined }, () => {
        const { config } = load();
        assert.strictEqual(config.commandInterval, 3000);
        assert.strictEqual(config.cycleInterval, 45000);
    });
});

test('DATA_DIR resolves to an absolute path', () => {
    withEnv({ DATA_DIR: 'state' }, () => {
        const { config } = load();
        assert.ok(config.dataDirPath.startsWith('/') || /^[A-Za-z]:/.test(config.dataDirPath));
        assert.ok(config.dataDirPath.endsWith('state'));
    });
});
