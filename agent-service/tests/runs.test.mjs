import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { validate } from '../dist/contracts.js';
import { createServer } from '../dist/server.js';
import { signRequest } from '../dist/http/service-auth.js';

const KEY = 'test-request-signing-key-0123456789abcdef';
const example = JSON.parse(readFileSync(new URL('../../contracts/v1/examples/run-request.json', import.meta.url), 'utf8'));
const servers = [];
let clock = 1_792_713_600_000;
const logs = [];

after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function start(overrides = {}) {
    const server = createServer({
        ...loadConfig({ AGENT_REQUEST_SIGNING_KEY: KEY, AGENT_SIMULATION_ENABLED: 'true' }),
        maxRequestBytes: 8192,
        simulationChunkDelayMs: 0,
        now: () => clock,
        log: (message) => logs.push(message),
        ...overrides,
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return `http://127.0.0.1:${server.address().port}`;
}

const engine = await start();

function newRun(overrides = {}) {
    return { ...structuredClone(example), runId: randomUUID(), ...overrides };
}

async function post(path, payload, options = {}) {
    const {
        baseUrl = engine,
        key = KEY,
        timestamp = String(Math.floor(clock / 1000)),
        body = JSON.stringify(payload),
        signedPath = path,
        signedBody = body,
        contentType = 'application/json',
        signed = true,
    } = options;
    const headers = { 'content-type': contentType };
    if (signed) {
        headers['x-agent-timestamp'] = timestamp;
        headers['x-agent-signature'] = signRequest(key, timestamp, 'POST', signedPath, signedBody);
    }
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body });

    return { status: response.status, body: await response.json() };
}

const cancelPath = (runId) => `/internal/runs/${runId}/cancel`;

test('a valid signed fake run crosses the boundary and is acknowledged on admission', async () => {
    const run = newRun();
    const response = await post('/internal/runs', run);
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { contractVersion: 1, runId: run.runId, status: 'accepted', duplicate: false });
    assert.deepEqual(validate('runAcknowledgement', response.body), []);
});

test('an identical resubmission is idempotent even with reordered keys', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    const reordered = Object.fromEntries(Object.entries(run).reverse());
    const response = await post('/internal/runs', reordered);
    assert.equal(response.status, 202);
    assert.equal(response.body.duplicate, true);
});

test('reusing a run ID with a different payload is rejected', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    const response = await post('/internal/runs', { ...run, userId: '43' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'conflicting_duplicate');
});

test('missing, wrong-key, expired and future signatures are rejected with one generic answer', async () => {
    const run = newRun();
    const now = Math.floor(clock / 1000);
    const attempts = {
        missing: { signed: false },
        mismatch: { key: 'another-signing-key-0123456789abcdefghij' },
        expired: { timestamp: String(now - 61) },
        future: { timestamp: String(now + 61) },
        malformed: { timestamp: 'yesterday' },
    };
    for (const [name, options] of Object.entries(attempts)) {
        const response = await post('/internal/runs', run, options);
        assert.equal(response.status, 401, name);
        assert.deepEqual(response.body.error, {
            code: 'authentication_failed',
            message: 'The request signature is missing, expired or invalid.',
        }, name);
    }
    assert.ok(logs.some((line) => line.includes('(expired)')));
    assert.equal((await post('/internal/runs', run)).status, 202, 'none of the rejected attempts admitted the run');
});

test('a signature cannot be replayed against another endpoint or with a different body', async () => {
    const run = newRun();
    const otherPath = await post(cancelPath(run.runId), { contractVersion: 1, runId: run.runId }, { signedPath: '/internal/runs' });
    assert.equal(otherPath.status, 401);
    const tampered = await post('/internal/runs', run, { signedBody: JSON.stringify(newRun()) });
    assert.equal(tampered.status, 401);
});

test('content type, JSON syntax and contract version are checked after authentication', async () => {
    assert.equal((await post('/internal/runs', newRun(), { contentType: 'text/plain' })).body.error.code, 'unsupported_media_type');
    assert.equal((await post('/internal/runs', null, { body: '{"contractVersion":' })).body.error.code, 'invalid_json');

    const version = await post('/internal/runs', newRun({ contractVersion: 2 }));
    assert.equal(version.status, 422);
    assert.equal(version.body.error.code, 'unsupported_contract_version');
});

test('schema violations return bounded details and admit nothing', async () => {
    const run = newRun({ credentials: { token: 'secret' }, messages: [{ ...example.messages[0], role: 'system' }] });
    const response = await post('/internal/runs', run);
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'invalid_payload');
    const issuePaths = response.body.error.details.map((issue) => issue.path);
    assert.ok(issuePaths.includes('/credentials'));
    assert.ok(issuePaths.includes('/messages/0/role'));
    assert.ok(response.body.error.details.length <= 10);
    assert.deepEqual(validate('error', response.body), []);
    assert.equal((await post(cancelPath(run.runId), { contractVersion: 1, runId: run.runId })).status, 404);
});

test('runs must end with a user message and use unique message IDs', async () => {
    const assistantLast = await post('/internal/runs', newRun({ messages: example.messages.slice(0, 2) }));
    assert.equal(assistantLast.status, 422);
    assert.equal(assistantLast.body.error.details[0].message, 'the final message must have role user');

    const message = example.messages[0];
    const duplicateIds = await post('/internal/runs', newRun({ messages: [message, { ...message, content: 'Again' }] }));
    assert.equal(duplicateIds.body.error.details[0].message, 'message IDs must be unique');
});

test('unverified providers, disabled simulation and unenforceable capabilities are refused', async () => {
    const live = await post('/internal/runs', newRun({ model: { provider: 'openai', id: 'example-model' } }));
    assert.equal(live.status, 422);
    assert.equal(live.body.error.code, 'model_unavailable');

    const capability = await post('/internal/runs', newRun({ capabilities: ['lookup_reference', 'send_email'] }));
    assert.equal(capability.body.error.code, 'unsupported_capability');
    assert.deepEqual(capability.body.error.details, [{ path: '/capabilities', message: 'unsupported capability send_email' }]);
    assert.equal((await post('/internal/runs', newRun({ capabilities: ['lookup_reference'] }))).status, 202, 'the registry enforces lookup_reference');

    const many = await post('/internal/runs', newRun({ capabilities: Array.from({ length: 32 }, (_, i) => `tool_${i}`) }));
    assert.equal(many.body.error.details.length, 10);
    assert.deepEqual(validate('error', many.body), [], 'error bodies stay within their own schema');

    const production = await start({ simulationEnabled: false });
    const simulated = await post('/internal/runs', newRun(), { baseUrl: production });
    assert.equal(simulated.body.error.code, 'model_unavailable');
});

test('oversized bodies are rejected before parsing', async () => {
    const response = await post('/internal/runs', newRun({ padding: 'x'.repeat(9000) }));
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'payload_too_large');
});

test('the admission registry is bounded and forgets runs after its retention period', async () => {
    const small = await start({ maxTrackedRuns: 1, trackedRunTtlMs: 60_000 });
    assert.equal((await post('/internal/runs', newRun(), { baseUrl: small })).status, 202);

    const full = await post('/internal/runs', newRun(), { baseUrl: small });
    assert.equal(full.status, 503);
    assert.equal(full.body.error.code, 'capacity_exhausted');

    clock += 60_001;
    assert.equal((await post('/internal/runs', newRun(), { baseUrl: small })).status, 202);
});

test('cancellation is acknowledged idempotently for a tracked run', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    const body = { contractVersion: 1, runId: run.runId };

    const first = await post(cancelPath(run.runId), body);
    assert.equal(first.status, 202);
    assert.deepEqual(first.body, { contractVersion: 1, runId: run.runId, status: 'cancel_requested', duplicate: false });
    assert.equal((await post(cancelPath(run.runId), body)).body.duplicate, true);

    const resubmitted = await post('/internal/runs', run);
    assert.equal(resubmitted.body.status, 'cancel_requested');
    assert.equal(resubmitted.body.duplicate, true);
});

test('cancellation rejects unknown runs, mismatched IDs and malformed paths', async () => {
    const unknown = randomUUID();
    assert.equal((await post(cancelPath(unknown), { contractVersion: 1, runId: unknown })).body.error.code, 'run_not_found');

    const run = newRun();
    await post('/internal/runs', run);
    const mismatch = await post(cancelPath(run.runId), { contractVersion: 1, runId: randomUUID() });
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error.code, 'run_id_mismatch');

    assert.equal((await post('/internal/runs/not-a-uuid/cancel', { contractVersion: 1 })).status, 404);
});

async function getEvents(runId, { baseUrl = engine, after, signed = true } = {}) {
    const path = `/internal/runs/${runId}/events${after === undefined ? '' : `?after=${after}`}`;
    const timestamp = String(Math.floor(clock / 1000));
    const headers = signed
        ? { 'x-agent-timestamp': timestamp, 'x-agent-signature': signRequest(KEY, timestamp, 'GET', path, '') }
        : {};
    const response = await fetch(`${baseUrl}${path}`, { headers });
    const text = await response.text();
    if (!(response.headers.get('content-type') ?? '').startsWith('application/x-ndjson')) {
        return { status: response.status, body: JSON.parse(text) };
    }

    return { status: response.status, events: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

test('an admitted run streams contract-valid events until it completes', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    const { status, events } = await getEvents(run.runId);
    assert.equal(status, 200);
    assert.equal(events.at(-1).type, 'run.completed');
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
    assert.ok(events.every((event) => event.runId === run.runId && validate('runEvent', event).length === 0));
    const deltas = events.filter((event) => event.type === 'assistant.delta').map((event) => event.data.text).join('');
    assert.equal(deltas, events.find((event) => event.type === 'assistant.final').data.text);
});

test('a reader resuming after an event receives only later events', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    const all = (await getEvents(run.runId)).events;
    const resumed = (await getEvents(run.runId, { after: 5 })).events;
    assert.deepEqual(resumed, all.slice(5));
    assert.deepEqual((await getEvents(run.runId, { after: all.length })).events, []);
});

test('a duplicate admission does not start a second execution', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    await post('/internal/runs', run);
    const { events } = await getEvents(run.runId);
    assert.equal(events.filter((event) => event.type === 'run.started').length, 1);
    assert.equal(events.filter((event) => event.type === 'run.completed').length, 1);
});

test('a reader that joins a paced run follows it live, and Stop ends it as cancelled', async () => {
    const paced = await start({ simulationChunkDelayMs: 15 });
    const live = newRun();
    await post('/internal/runs', live, { baseUrl: paced });
    const followed = (await getEvents(live.runId, { baseUrl: paced })).events;
    assert.equal(followed.at(-1).type, 'run.completed');

    const stopped = newRun();
    await post('/internal/runs', stopped, { baseUrl: paced });
    const reading = getEvents(stopped.runId, { baseUrl: paced });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await post(cancelPath(stopped.runId), { contractVersion: 1, runId: stopped.runId }, { baseUrl: paced })).status, 202);
    const events = (await reading).events;
    assert.equal(events.at(-1).type, 'run.cancelled');
    assert.ok(!events.some((event) => event.type === 'assistant.final'));
    assert.ok(events.some((event) => event.type === 'assistant.delta'), 'some text streamed before Stop');
});

test('event streams require a signature, a tracked run and a valid cursor', async () => {
    const run = newRun();
    await post('/internal/runs', run);
    assert.equal((await getEvents(run.runId, { signed: false })).status, 401);
    assert.equal((await getEvents(randomUUID())).body.error.code, 'run_not_found');
    const cursor = await getEvents(run.runId, { after: -1 });
    assert.equal(cursor.status, 422);
    assert.equal(cursor.body.error.details[0].path, '/after');
});
