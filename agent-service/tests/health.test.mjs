import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createServer } from '../dist/server.js';

const server = createServer();
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
    });
});

test('health endpoint rejects writes', async () => {
    const response = await fetch(`${baseUrl}/internal/health`, { method: 'POST' });
    assert.equal(response.status, 404);
});

test('run execution is not accidentally exposed before the authenticated contract exists', async () => {
    const response = await fetch(`${baseUrl}/internal/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'This must not execute.' }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
});
