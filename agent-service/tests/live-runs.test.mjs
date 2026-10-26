import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createFauxCore, createProvider, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentTools } from '@earendil-works/pi-ai';
import { ConnectionManager } from '../dist/auth/connection-manager.js';
import { loadConfig } from '../dist/config.js';
import { validate } from '../dist/contracts.js';
import { signRequest } from '../dist/http/service-auth.js';
import { runLive } from '../dist/runtime/live-run.js';
import { RunExecution } from '../dist/runtime/run-execution.js';
import { createServer } from '../dist/server.js';
import { lookupReference } from '../dist/tools/lookup-reference.js';

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

    return { baseUrl: `http://127.0.0.1:${server.address().port}`, fake, dir, logs, connections };
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

test('a run stopped before execution does not resolve credentials or start a model', async () => {
    const run = liveRun(randomUUID());
    const execution = new RunExecution(run.runId, 2000);
    execution.cancel();
    let preparations = 0;
    await runLive(run, execution, {
        connections: { runModel: async () => { preparations += 1; return { code: 'not_connected', message: 'Not connected.' }; } },
        log: () => {},
    });

    assert.equal(preparations, 0);
    assert.equal(execution.after(0).at(-1).type, 'run.cancelled');
});

test('an aborted credential preparation ends as cancellation rather than an internal error', async () => {
    const run = liveRun(randomUUID());
    const execution = new RunExecution(run.runId, 2000);
    const work = runLive(run, execution, {
        connections: { runModel: (_id, _provider, _model, signal) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }) },
        log: () => {},
    });
    execution.cancel();
    await work;

    assert.equal(execution.after(0).at(-1).type, 'run.cancelled');
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

const withTools = (connectionId, limits = {}) =>
    liveRun(connectionId, {}, { capabilities: ['lookup_reference'], limits: { ...example.limits, ...limits } });
const toolResults = (context) => context.messages.filter((message) => message.role === 'toolResult');
// Pi declares tools to the model in the transcript's system messages.
const offered = (context) => getCurrentTools(context.messages).map((tool) => tool.name);

test('a permitted lookup runs once, its result reaches the model, and the answer uses it', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        engine.fake.reply(() =>
            fauxAssistantMessage([fauxText('Let me check.'), fauxToolCall('lookup_reference', { query: 'sample office' }, { id: 'call_1' })], {
                stopReason: 'toolUse',
            }),
        ),
        engine.fake.reply((context) => {
            const [result] = toolResults(context);

            return fauxAssistantMessage(result.content[0].text.includes('SAMPLE-001') ? 'The sample office code is SAMPLE-001.' : 'Not found.');
        }),
    ]);

    const events = await runToEnd(engine, withTools(connectionId));

    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
    assert.deepEqual(ofType(events, 'run.progress').map((event) => event.data.stage), ['preparing', 'answering', 'retrieving', 'answering']);
    assert.deepEqual(ofType(events, 'tool.started').map((event) => event.data), [{ toolCallId: 'call_1', name: 'lookup_reference' }]);
    assert.equal(ofType(events, 'source.added')[0].data.evidenceId, 'ref-sample-office');
    assert.deepEqual(ofType(events, 'tool.finished').map((event) => event.data), [
        { toolCallId: 'call_1', name: 'lookup_reference', outcome: 'ok', message: null },
    ]);
    const final = ofType(events, 'assistant.final')[0].data.text;
    assert.equal(final, 'Let me check.\n\nThe sample office code is SAMPLE-001.');
    assert.equal(ofType(events, 'assistant.delta').map((event) => event.data.text).join(''), final);

    const [first, second] = engine.fake.calls;
    assert.deepEqual(offered(first.context), ['lookup_reference']);
    assert.match(first.context.messages[0].content, /look them up with your tools/);
    const [result] = toolResults(second.context);
    assert.equal(result.toolCallId, 'call_1');
    assert.match(result.content[0].text, /\[SAMPLE-001\] Sample office \(evidence ref-sample-office/);
});

test('Stop during a tool call aborts it, skips the remaining calls and starts no further model round', { timeout: 3000 }, async (t) => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    const started = Promise.withResolvers();
    const late = Promise.withResolvers();
    let toolCalls = 0;
    engine.fake.core.setResponses([
        engine.fake.reply(() => fauxAssistantMessage([
            fauxToolCall('lookup_reference', { query: 'SAMPLE-001' }, { id: 'call_1' }),
            fauxToolCall('lookup_reference', { query: 'SAMPLE-002' }, { id: 'call_2' }),
        ], { stopReason: 'toolUse' })),
        engine.fake.reply(() => fauxAssistantMessage('Must not generate a later answer.')),
    ]);
    const run = withTools(connectionId);
    const execution = new RunExecution(run.runId, 2000);
    const work = runLive(run, execution, {
        connections: engine.connections,
        log: () => {},
        toolRegistry: [{ ...lookupReference, run: (_args, signal) => {
            toolCalls += 1;
            started.resolve(signal);
            return late.promise;
        } }],
    });
    const toolSignal = await started.promise;
    const stoppedAt = performance.now();
    execution.cancel();
    await work;
    t.diagnostic(`Stop during the tool reached run.cancelled in ${(performance.now() - stoppedAt).toFixed(2)} ms.`);
    const events = execution.after(0);

    assert.equal(toolSignal.aborted, true);
    assert.equal(toolCalls, 1);
    assert.equal(engine.fake.calls.length, 1);
    assert.equal(ofType(events, 'tool.started').length, 1);
    assert.equal(ofType(events, 'tool.finished')[0].data.outcome, 'cancelled');
    assert.equal(ofType(events, 'source.added').length, 0);
    assert.equal(ofType(events, 'assistant.final').length, 0);
    assert.equal(ofType(events, 'run.completed').length, 0);
    assert.equal(ofType(events, 'run.cancelled').length, 1);
    assert.equal(events.at(-1).type, 'run.cancelled');
    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
    late.reject(new Error('Late tool rejection is consumed.'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(execution.after(0), events);
});

test('late and repeated Stop never replace a completed answer or restart work', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([engine.fake.reply(() => fauxAssistantMessage('Done.'))]);
    const run = liveRun(connectionId);
    const events = await runToEnd(engine, run);

    for (let i = 0; i < 2; i += 1) {
        const cancel = await call(engine, 'POST', `/internal/runs/${run.runId}/cancel`, { contractVersion: 1, runId: run.runId });
        assert.equal(cancel.status, 202);
    }
    const replay = await call(engine, 'GET', `/internal/runs/${run.runId}/events`);
    assert.deepEqual(replay.events, events);
    assert.equal(engine.fake.calls.length, 1);
    assert.equal(events.at(-1).type, 'run.completed');
});

test('without the capability no tool is offered and a requested call does not run', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage([fauxToolCall('lookup_reference', { query: 'SAMPLE-001' }, { id: 'call_1' })], { stopReason: 'toolUse' }),
        engine.fake.reply(() => fauxAssistantMessage('I cannot look that up here.')),
    ]);

    const events = await runToEnd(engine, liveRun(connectionId));

    assert.deepEqual(offered(engine.fake.calls[0].context), []);
    assert.doesNotMatch(engine.fake.calls[0].context.messages[0].content, /tools/);
    assert.equal(ofType(events, 'tool.started').length, 0);
    assert.equal(ofType(events, 'source.added').length, 0);
    assert.equal(ofType(events, 'tool.finished')[0].data.outcome, 'blocked');
    assert.equal(ofType(events, 'assistant.final')[0].data.text, 'I cannot look that up here.');
    // The model was told the call failed and received no reference text.
    const [refused] = toolResults(engine.fake.calls.at(-1).context);
    assert.equal(refused.isError, true);
    assert.doesNotMatch(refused.content[0].text, /SAMPLE-001\]/);
});

test('text across model rounds stops at the final size limit without saving a shortened success', async () => {
    const engine = await start({ providerOptions: { tokenSize: { min: 20_000, max: 20_000 } } });
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage([
            fauxText('a'.repeat(120_000)),
            fauxToolCall('lookup_reference', { query: 'SAMPLE-001' }, { id: 'call_1' }),
        ], { stopReason: 'toolUse' }),
        fauxAssistantMessage('b'.repeat(100_000)),
    ]);

    const events = await runToEnd(engine, withTools(connectionId));
    const streamed = ofType(events, 'assistant.delta').map((event) => event.data.text).join('');

    assert.equal(failure(events)?.code, 'output_limit_exceeded');
    assert.ok(streamed.length > 0 && streamed.length <= 200_000);
    assert.equal(ofType(events, 'tool.started').length, 1);
    assert.equal(ofType(events, 'assistant.final').length, 0);
    assert.equal(ofType(events, 'run.completed').length, 0);
    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
    assert.equal(events.at(-1).type, 'run.failed');
});

test('invalid arguments are refused before the lookup runs', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage([fauxToolCall('lookup_reference', { query: '', limit: 99 }, { id: 'call_1' })], { stopReason: 'toolUse' }),
        engine.fake.reply(() => fauxAssistantMessage('Please give me a code to look up.')),
    ]);

    const events = await runToEnd(engine, withTools(connectionId));

    assert.equal(ofType(events, 'tool.started').length, 0);
    assert.equal(ofType(events, 'tool.finished')[0].data.outcome, 'invalid_arguments');
    assert.equal(toolResults(engine.fake.calls.at(-1).context)[0].isError, true);
    assert.equal(ofType(events, 'run.completed').length, 1);
});

test('tool validation details stay with the model and never enter browser events', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage([
            fauxToolCall('lookup_reference', { query: 'SAMPLE-001', privateNote: 'private-argument-marker' }, { id: 'call_1' }),
        ], { stopReason: 'toolUse' }),
        engine.fake.reply(() => fauxAssistantMessage('The lookup did not run.')),
    ]);

    const events = await runToEnd(engine, withTools(connectionId));
    const [refused] = toolResults(engine.fake.calls.at(-1).context);

    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /private-argument-marker/, 'Pi includes the supplied arguments in its validation error');
    assert.equal(ofType(events, 'tool.started').length, 0);
    assert.equal(ofType(events, 'tool.finished')[0].data.outcome, 'invalid_arguments');
    assert.doesNotMatch(JSON.stringify(events), /private-argument-marker|Received arguments/);
    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
    assert.equal(ofType(events, 'run.completed').length, 1);
});

test('repeated calls and calls over the tool budget are blocked, and the model must then answer', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    engine.fake.core.setResponses([
        fauxAssistantMessage(
            [
                fauxToolCall('lookup_reference', { query: 'SAMPLE-001' }, { id: 'call_a' }),
                fauxToolCall('lookup_reference', { query: 'SAMPLE-001' }, { id: 'call_a' }),
                fauxToolCall('lookup_reference', { query: 'SAMPLE-002' }, { id: 'call_b' }),
                fauxToolCall('lookup_reference', { query: 'POLICY-010' }, { id: 'call_c' }),
            ],
            { stopReason: 'toolUse' },
        ),
        engine.fake.reply(() => fauxAssistantMessage('Here is what I found.')),
    ]);

    const events = await runToEnd(engine, withTools(connectionId, { maxToolCalls: 2 }));

    assert.deepEqual(ofType(events, 'tool.started').map((event) => event.data.toolCallId), ['call_a', 'call_b']);
    assert.deepEqual(ofType(events, 'tool.finished').map((event) => [event.data.toolCallId, event.data.outcome]), [
        ['call_a', 'ok'],
        ['call_a', 'blocked'],
        ['call_b', 'ok'],
        ['call_c', 'blocked'],
    ]);
    assert.deepEqual(offered(engine.fake.calls.at(-1).context), [], 'no tools once the budget is used');
    assert.equal(ofType(events, 'assistant.final')[0].data.text, 'Here is what I found.');
});

test('the last model round offers no tools, so a model that keeps calling them still answers', async () => {
    const engine = await start();
    const connectionId = randomUUID();
    await saveKey(engine, connectionId);
    let n = 0;
    const keepCalling = engine.fake.reply((context) =>
        offered(context).length > 0
            ? fauxAssistantMessage([fauxToolCall('lookup_reference', { query: `office ${(n += 1)}` }, { id: `call_${n}` })], { stopReason: 'toolUse' })
            : fauxAssistantMessage('Final answer without tools.'),
    );
    engine.fake.core.setResponses([keepCalling, keepCalling, keepCalling, keepCalling, keepCalling]);

    const events = await runToEnd(engine, withTools(connectionId, { maxModelRounds: 3 }));

    assert.equal(engine.fake.calls.length, 3);
    assert.deepEqual(engine.fake.calls.map((call) => offered(call.context).length), [1, 1, 0]);
    assert.equal(ofType(events, 'tool.started').length, 2);
    assert.equal(ofType(events, 'assistant.final')[0].data.text, 'Final answer without tools.');
});
