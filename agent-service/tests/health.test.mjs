import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { createServer } from '../dist/server.js';

// No signing key: the default state of a fresh checkout before setup generates one.
const server = createServer({ ...loadConfig({}), log: () => {} });
let baseUrl;

before(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
}));

test('health loads Pi without credentials and distinguishes provider readiness', async () => {
    const response = await fetch(`${baseUrl}/internal/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
        status: 'ok',
        service: 'agent',
        providerAuth: 'not_configured',
        requestAuth: 'not_configured',
        simulation: 'disabled',
    });
});

test('health endpoint rejects writes', async () => {
    const response = await fetch(`${baseUrl}/internal/health`, { method: 'POST' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'not_found');
});

test('run endpoints stay closed until a request signing key is configured', async () => {
    const response = await fetch(`${baseUrl}/internal/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'This must not execute.' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'request_auth_not_configured');
});
