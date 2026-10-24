import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createFauxCore, createProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { ConnectionManager } from '../dist/auth/connection-manager.js';
import { loadConfig } from '../dist/config.js';
import { validate } from '../dist/contracts.js';
import { signRequest } from '../dist/http/service-auth.js';
import { createServer } from '../dist/server.js';

const KEY = 'test-request-signing-key-0123456789abcdef';
const API_KEY = 'secret-opencode-key-0123456789';
const example = JSON.parse(readFileSync(new URL('../../contracts/v1/examples/run-request-live.json', import.meta.url), 'utf8'));
const servers = [];

after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

/**
 * An API-key provider like OpenCode backed by Pi's faux model. `calls` records what each request
 * received, so tests can check the history, reasoning and key that reached the model.
 */
function fakeProvider(id, coreOptions = {}) {
    const core = createFauxCore({
        provider: id,
        models: [{ id: 'thinker', reasoning: true }, { id: 'plain' }],
        ...coreOptions,
    });
    const calls = [];
    const auth = {
        apiKey: {
            name: `Fake ${id} key`,
            resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined),
        },
    };
    const reply = (respond) => (context, options) => {
        calls.push({ context, options });

        return respond(context, options);
    };

    return {
        core,
        calls,
        reply,
        provider: () => createProvider({ id, auth, models: core.models, api: { stream: core.stream, streamSimple: core.streamSimple } }),
    };
}

async function start({ providerOptions = {}, key = randomBytes(32), dataDirectory } = {}) {
    const fake = fakeProvider('opencode', providerOptions);
    const dir = dataDirectory ?? (await mkdtemp(join(tmpdir(), 'engine-')));
    const logs = [];
    const connections = new ConnectionManager({
        dataDirectory: dir,
        key,
        providers: { openai: fakeProvider('openai').provider, opencode: fake.provider, 'opencode-go': fakeProvider('opencode-go').provider },
        loginTimeoutMs: 60_000,
        testTimeoutMs: 5_000,
        now: Date.now,
        log: (message) => logs.push(message),
    });
    const server = createServer(
        { ...loadConfig({ AGENT_REQUEST_SIGNING_KEY: KEY }), now: Date.now, log: (message) => logs.push(message) },
        { connections, local: null },
    );
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return { baseUrl: `http://127.0.0.1:${server.address().port}`, fake, dir, logs };
}

async function call(engine, method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'x-agent-timestamp': timestamp, 'x-agent-signature': signRequest(KEY, timestamp, method, path, body) };
    if (payload !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${engine.baseUrl}${path}`, { method, headers, body: payload === undefined ? undefined : body });
    const text = await response.text();
    if (!(response.headers.get('content-type') ?? '').startsWith('application/x-ndjson')) {
        return { status: response.status, body: JSON.parse(text) };
    }

    return { status: response.status, events: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

const saveKey = (engine, connectionId) =>
    call(engine, 'PUT', `/internal/connections/${connectionId}/key`, { contractVersion: 1, provider: 'opencode', apiKey: API_KEY });

function liveRun(connectionId, model = {}, overrides = {}) {
    return {
        ...structuredClone(example),
        runId: randomUUID(),
        connectionId,
        model: { provider: 'opencode', id: 'thinker', reasoning: 'high', ...model },
        ...overrides,
    };
}

/** Admits a run and reads its whole event stream. */
async function runToEnd(engine, run) {
    const admitted = await call(engine, 'POST', '/internal/runs', run);
    assert.equal(admitted.status, 202, JSON.stringify(admitted.body));

    return (await call(engine, 'GET', `/internal/runs/${run.runId}/events`)).events;
}

const ofType = (events, type) => events.filter((event) => event.type === type);
const failure = (events) => ofType(events, 'run.failed')[0]?.data;

test('a live run streams batched deltas that add up to the final answer, with history, reasoning and the stored key', async () => {
    const engine = await start({ providerOptions: { tokenSize: { min: 1, max: 1 } } });
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    const answer = `**Summary:** the sample office uses SAMPLE-001. ${'More detail follows. '.repeat(40)}`;
    engine.fake.core.setResponses([engine.fake.reply(() => fauxAssistantMessage(answer))]);
    const run = liveRun(connectionId);

    const events = await runToEnd(engine, run);

    assert.ok(events.every((event) => validate('runEvent', event).length === 0), 'every event satisfies the contract');
    assert.deepEqual(
        events.map((event) => event.type).filter((type) => type !== 'assistant.delta'),
        ['run.started', 'run.progress', 'run.progress', 'assistant.final', 'run.completed'],
    );
    assert.deepEqual(ofType(events, 'run.progress').map((event) => event.data.stage), ['preparing', 'answering']);
    const deltas = ofType(events, 'assistant.delta').map((event) => event.data.text);
    assert.equal(deltas.join(''), answer);
    assert.equal(ofType(events, 'assistant.final')[0].data.text, answer);
    // About 230 one-token chunks arrive at once and are passed on in a few batches.
    assert.ok(deltas.length < 10, `${deltas.length} deltas`);

    const [{ context, options }] = engine.fake.calls;
    assert.equal(options.apiKey, API_KEY);
    assert.equal(options.reasoning, 'high');
    assert.equal(options.sessionId, run.conversationId);
    const [system, ...history] = context.messages;
    assert.equal(system.role, 'system');
    assert.match(system.content, /helpful assistant/);
    assert.deepEqual(
        history.map((message) => [message.role, typeof message.content === 'string' ? message.content : message.content[0].text]),
        run.messages.map((message) => [message.role, message.content]),
    );
});

test('reasoning is sent only to models that reason', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([engine.fake.reply(() => fauxAssistantMessage('Plain answer.'))]);

    const events = await runToEnd(engine, liveRun(connectionId, { id: 'plain' }));

    assert.equal(ofType(events, 'assistant.final')[0].data.text, 'Plain answer.');
    assert.equal(engine.fake.calls[0].options.reasoning, undefined);
});

test('runs without their connection, on unknown providers or without a credential store are refused at admission', async () => {
    const engine = await start();

    const missing = await call(engine, 'POST', '/internal/runs', liveRun(null));
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.code, 'connection_required');

    const unknown = await call(engine, 'POST', '/internal/runs', liveRun(randomUUID(), { provider: 'anthropic' }));
    assert.equal(unknown.body.error.code, 'model_unavailable');

    const noLocal = await call(engine, 'POST', '/internal/runs', liveRun(randomUUID(), { provider: 'local', id: 'llama3.2' }));
    assert.equal(noLocal.body.error.code, 'model_unavailable');

    const plain = createServer({ ...loadConfig({ AGENT_REQUEST_SIGNING_KEY: KEY }), now: Date.now, log: () => {} }, { connections: null, local: null });
    servers.push(plain);
    plain.listen(0, '127.0.0.1');
    await once(plain, 'listening');
    const noStore = await call({ baseUrl: `http://127.0.0.1:${plain.address().port}` }, 'POST', '/internal/runs', liveRun(randomUUID()));
    assert.equal(noStore.body.error.code, 'model_unavailable');
});

test('an unconnected account, an unknown model and an unreadable sign-in fail the run with codes Laravel acts on', async () => {
    const key = randomBytes(32);
    const engine = await start({ key });

    assert.deepEqual(failure(await runToEnd(engine, liveRun(randomUUID()))), {
        code: 'not_connected',
        message: 'This account is not connected.',
    });

    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    assert.equal(failure(await runToEnd(engine, liveRun(connectionId, { id: 'gpt-unknown' }))).code, 'model_unavailable');

    // The same stored key read with a different engine key, as after AGENT_CREDENTIAL_KEY changed.
    const rekeyed = await start({ dataDirectory: engine.dir });
    const unreadable = failure(await runToEnd(rekeyed, liveRun(connectionId)));
    assert.equal(unreadable.code, 'credentials_unreadable');
    assert.equal(engine.fake.calls.length + rekeyed.fake.calls.length, 0, 'no model request was made');
});

test('provider errors and empty answers end the run honestly without a final answer', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'You exceeded your current quota.' }),
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'fetch failed' }),
        fauxAssistantMessage(''),
    ]);

    const quota = await runToEnd(engine, liveRun(connectionId));
    assert.deepEqual(failure(quota), { code: 'provider_error', message: 'You exceeded your current quota.' });
    assert.equal(ofType(quota, 'assistant.final').length, 0);

    const network = failure(await runToEnd(engine, liveRun(connectionId)));
    assert.equal(network.code, 'provider_error');
    assert.match(network.message, /could not reach the provider \(fetch failed\)/);

    assert.equal(failure(await runToEnd(engine, liveRun(connectionId))).code, 'empty_reply');
    assert.ok(!engine.logs.join('\n').includes(API_KEY), 'the key is never logged');
});

test('Stop aborts the model request and ends the run as cancelled', async () => {
    const engine = await start({ providerOptions: { tokensPerSecond: 20 } });
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    let aborted = false;
    engine.fake.core.setResponses([
        engine.fake.reply((_context, options) => {
            options.signal?.addEventListener('abort', () => {
                aborted = true;
            });

            return fauxAssistantMessage('A long answer that streams slowly. '.repeat(30));
        }),
    ]);
    const run = liveRun(connectionId);
    await call(engine, 'POST', '/internal/runs', run);
    const reading = call(engine, 'GET', `/internal/runs/${run.runId}/events`);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const cancel = await call(engine, 'POST', `/internal/runs/${run.runId}/cancel`, { contractVersion: 1, runId: run.runId });
    assert.equal(cancel.status, 202);
    const { events } = await reading;

    assert.equal(events.at(-1).type, 'run.cancelled');
    assert.equal(ofType(events, 'assistant.final').length, 0);
    assert.ok(ofType(events, 'assistant.delta').length > 0, 'some text streamed before Stop');
    assert.ok(aborted, 'the provider request was aborted');
});

test('a run past its deadline fails explicitly', async () => {
    const engine = await start({ providerOptions: { tokensPerSecond: 10 } });
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([fauxAssistantMessage('Too slow to finish. '.repeat(50))]);

    const events = await runToEnd(engine, liveRun(connectionId, {}, { limits: { ...example.limits, runDeadlineMs: 1_000 } }));

    assert.deepEqual(failure(events), { code: 'deadline_exceeded', message: 'The run exceeded its time limit.' });
    assert.equal(ofType(events, 'assistant.final').length, 0);
});

test('large streamed text is split within the delta limit without breaking characters', async () => {
    const engine = await start({ providerOptions: { tokenSize: { min: 20_000, max: 20_000 } } });
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    // A surrogate pair straddles the 16,384-unit boundary.
    const answer = `${'a'.repeat(16_383)}😀${'b'.repeat(20_000)}`;
    engine.fake.core.setResponses([fauxAssistantMessage(answer)]);

    const events = await runToEnd(engine, liveRun(connectionId));
    const deltas = ofType(events, 'assistant.delta').map((event) => event.data.text);

    assert.ok(deltas.length >= 3, `${deltas.length} deltas`);
    assert.ok(deltas.every((text) => text.length <= 16_384 && !/[\uD800-\uDBFF]$/.test(text) && !/^[\uDC00-\uDFFF]/.test(text)));
    assert.equal(deltas.join(''), answer);
    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
});
