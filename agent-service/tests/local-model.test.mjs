import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { ConnectionManager } from '../dist/auth/connection-manager.js';
import { LocalModelServer, localModelConfig } from '../dist/auth/local-model.js';
import { loadConfig } from '../dist/config.js';
import { validate } from '../dist/contracts.js';
import { signRequest } from '../dist/http/service-auth.js';
import { createServer } from '../dist/server.js';

const KEY = 'test-request-signing-key-0123456789abcdef';
const clock = 1_792_713_600_000;
const servers = [];

after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

/** A minimal OpenAI-compatible server like Ollama or LM Studio: a model list and streamed chat completions. */
async function fakeLocalServer({ models = ['llama3.2:latest', 'qwen2.5:7b', 'id with spaces'], reply = 'Connected' } = {}) {
    const requests = [];
    const server = createHttpServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) {
            body += chunk;
        }
        requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization ?? null, body: body === '' ? null : JSON.parse(body) });

        if (request.method === 'GET' && request.url === '/v1/models') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }));
            return;
        }
        if (request.method === 'POST' && request.url === '/v1/chat/completions') {
            const chunk = (delta, finishReason = null) =>
                `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 0, model: 'llama3.2:latest', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(chunk({ role: 'assistant', content: reply }));
            response.write(chunk({}, 'stop'));
            response.end('data: [DONE]\n\n');
            return;
        }
        response.writeHead(404);
        response.end();
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return { url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

async function engine(localConfig) {
    const local = localConfig === null ? null : new LocalModelServer(localConfig, Date.now);
    const connections = new ConnectionManager({
        dataDirectory: await mkdtemp(join(tmpdir(), 'engine-')),
        key: randomBytes(32),
        // The real providers make no network call unless used.
        providers: { openai: openaiProvider, opencode: opencodeProvider, 'opencode-go': opencodeGoProvider },
        local,
        loginTimeoutMs: 60_000,
        testTimeoutMs: 5_000,
        now: Date.now,
        log: () => {},
    });
    const server = createServer({ ...loadConfig({ AGENT_REQUEST_SIGNING_KEY: KEY }), now: () => clock, log: () => {} }, { connections, local });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return `http://127.0.0.1:${server.address().port}`;
}

async function call(baseUrl, method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(clock / 1000));
    const headers = { 'x-agent-timestamp': timestamp, 'x-agent-signature': signRequest(KEY, timestamp, method, path, body) };
    if (payload !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload === undefined ? undefined : body });

    return { status: response.status, body: await response.json() };
}

test('the local server address comes only from configuration and must be a plain http URL', () => {
    assert.equal(localModelConfig({}), null);
    assert.deepEqual(localModelConfig({ LOCAL_LLM_URL: ' http://host.docker.internal:11434/v1/ ', LOCAL_LLM_NAME: 'Ollama on this PC' }), {
        name: 'Ollama on this PC',
        url: 'http://host.docker.internal:11434/v1',
        apiKey: null,
    });
    assert.equal(localModelConfig({ LOCAL_LLM_URL: 'http://192.168.1.20:1234/v1', LOCAL_LLM_API_KEY: ' lm-key ' }).apiKey, 'lm-key');
    assert.equal(localModelConfig({ LOCAL_LLM_URL: 'http://192.168.1.20:1234/v1' }).name, 'Local model');

    for (const url of ['not a url', 'ftp://host/v1', 'http://user:secret@host/v1', 'http://host/v1?x=1', 'http://host/v1#top']) {
        assert.throws(() => localModelConfig({ LOCAL_LLM_URL: url }), /LOCAL_LLM_URL/, url);
    }
});

test('the engine reports the configured server and the models it lists', async () => {
    const local = await fakeLocalServer();
    const baseUrl = await engine({ name: 'Ollama on this PC', url: local.url, apiKey: null });

    const view = await call(baseUrl, 'GET', '/internal/local-model');
    assert.equal(view.status, 200);
    assert.deepEqual(validate('localModelStatus', view.body), []);
    assert.deepEqual(view.body, {
        contractVersion: 1,
        configured: true,
        name: 'Ollama on this PC',
        baseUrl: local.url,
        reachable: true,
        models: ['llama3.2:latest', 'qwen2.5:7b'],
        error: null,
    });

    const status = await call(baseUrl, 'GET', `/internal/connections/${randomUUID()}?provider=local`);
    assert.deepEqual(validate('connectionStatus', status.body), []);
    assert.equal(status.body.status, 'connected');
    assert.deepEqual(status.body.models, ['llama3.2:latest', 'qwen2.5:7b']);

    // The model list is cached briefly, so repeated page views do not hit the server each time.
    assert.equal(local.requests.filter((request) => request.url === '/v1/models').length, 1);
});

test('an unreachable or missing server is reported, not an error', async () => {
    const gone = await fakeLocalServer();
    const url = gone.url;
    await new Promise((resolve) => servers.pop().close(resolve));
    const unreachable = await engine({ name: 'LM Studio', url, apiKey: null });

    const view = await call(unreachable, 'GET', '/internal/local-model');
    assert.deepEqual(validate('localModelStatus', view.body), []);
    assert.equal(view.body.reachable, false);
    assert.equal(view.body.error, 'LM Studio could not be reached.');
    assert.equal((await call(unreachable, 'GET', `/internal/connections/${randomUUID()}?provider=local`)).body.status, 'unreachable');

    const missing = await engine(null);
    assert.deepEqual((await call(missing, 'GET', '/internal/local-model')).body, {
        contractVersion: 1, configured: false, name: null, baseUrl: null, reachable: false, models: [], error: null,
    });
    assert.equal((await call(missing, 'GET', `/internal/connections/${randomUUID()}?provider=local`)).body.status, 'not_connected');
});

test('a test message reaches the local server with its key and gets the reply', async () => {
    const local = await fakeLocalServer({ reply: 'Connected' });
    const baseUrl = await engine({ name: 'vLLM', url: local.url, apiKey: 'local-server-key' });
    const id = randomUUID();

    const result = await call(baseUrl, 'POST', `/internal/connections/${id}/test`, { contractVersion: 1, provider: 'local', modelId: 'qwen2.5:7b' });

    assert.equal(result.status, 200);
    assert.deepEqual(validate('connectionTestResult', result.body), []);
    assert.equal(result.body.outcome, 'ok', JSON.stringify(result.body));
    assert.equal(result.body.reply, 'Connected');
    const completion = local.requests.find((request) => request.url === '/v1/chat/completions');
    assert.equal(completion.authorization, 'Bearer local-server-key');
    assert.equal(completion.body.model, 'qwen2.5:7b');
    assert.equal(completion.body.stream, true);
    assert.ok(completion.body.messages.every((message) => message.role !== 'developer'));
    assert.match(JSON.stringify(completion.body.messages), /Reply with exactly one word: Connected/);

    const unknown = await call(baseUrl, 'POST', `/internal/connections/${id}/test`, { contractVersion: 1, provider: 'local', modelId: 'not-served' });
    assert.equal(unknown.body.error.code, 'unknown_model');
});

test('a server without a key still gets the test message, with a placeholder token', async () => {
    const local = await fakeLocalServer({ reply: 'Connected' });
    const baseUrl = await engine({ name: 'Ollama on this PC', url: local.url, apiKey: null });

    const result = await call(baseUrl, 'POST', `/internal/connections/${randomUUID()}/test`, { contractVersion: 1, provider: 'local', modelId: 'llama3.2:latest' });

    assert.equal(result.body.outcome, 'ok', JSON.stringify(result.body));
    assert.equal(local.requests.find((request) => request.url === '/v1/models').authorization, null);
    assert.equal(local.requests.find((request) => request.url === '/v1/chat/completions').authorization, 'Bearer unused');
});

test('the local server needs no user credential: keys and sign-ins are refused and disconnect stores nothing', async () => {
    const local = await fakeLocalServer();
    const baseUrl = await engine({ name: 'Local model', url: local.url, apiKey: null });
    const id = randomUUID();

    const key = await call(baseUrl, 'PUT', `/internal/connections/${id}/key`, { contractVersion: 1, provider: 'local', apiKey: 'some-key-123' });
    assert.equal(key.body.error.code, 'invalid_payload');
    const login = await call(baseUrl, 'POST', `/internal/connections/${id}/login`, { contractVersion: 1, provider: 'local', agentName: 'App' });
    assert.equal(login.body.error.code, 'invalid_payload');

    const removed = await call(baseUrl, 'DELETE', `/internal/connections/${id}?provider=local`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.status, 'not_connected');
});
