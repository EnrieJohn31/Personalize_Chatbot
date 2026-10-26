import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createFauxCore, createModels, createProvider, fauxAssistantMessage, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { ConnectionManager } from '../dist/auth/connection-manager.js';
import { CredentialVault } from '../dist/auth/credential-vault.js';
import { loadConfig } from '../dist/config.js';
import { validate } from '../dist/contracts.js';
import { signRequest } from '../dist/http/service-auth.js';
import { createServer } from '../dist/server.js';

const KEY = 'test-request-signing-key-0123456789abcdef';
const REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const clock = 1_792_713_600_000;
const servers = [];

after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

/**
 * Stand-in for Pi's Sign in with ChatGPT: the same events, the same race between the browser
 * callback and a pasted address, and the same credential shape. `deliver` plays the browser.
 */
function fakeOpenAI(behaviour = {}) {
    const core = createFauxCore({ provider: 'openai', models: [{ id: 'gpt-test' }, { id: 'gpt-test-mini' }] });
    const fake = { core, logins: [], refreshes: 0, requests: [], deliver: null };
    let sequence = 0;

    const oauth = {
        name: 'Fake ChatGPT',
        isSubscription: true,
        async login(interaction, options) {
            const state = `state-${++sequence}`;
            fake.logins.push({ deviceId: options?.getDeviceId?.(), agentName: options?.agentName });
            const authUrl = new URL('https://auth.example.test/authorize');
            authUrl.search = new URLSearchParams({ redirect_uri: REDIRECT, state }).toString();
            interaction.notify({ type: 'auth_url', url: authUrl.toString() });

            const manualAbort = new AbortController();
            const browser = new Promise((resolve) => {
                fake.deliver = resolve;
            });
            const pasted = interaction.prompt({
                type: 'manual_code',
                message: 'Paste the final redirect URL',
                signal: AbortSignal.any([manualAbort.signal, interaction.signal]),
            });
            try {
                const redirect = new URL(await Promise.race([browser, pasted]));
                if (redirect.searchParams.get('error')) {
                    throw new Error(`ChatGPT authorization failed: ${redirect.searchParams.get('error')}`);
                }
                if (redirect.searchParams.get('state') !== state) {
                    throw new Error('OAuth state mismatch');
                }
                interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' });
                if (behaviour.exchangeError) {
                    throw new Error(behaviour.exchangeError);
                }

                return {
                    type: 'oauth',
                    access: `secret-access-${redirect.searchParams.get('code')}`,
                    refresh: 'secret-refresh',
                    expires: behaviour.expires ?? Date.now() + 3_600_000,
                    clientId: 'issued-client',
                    scopes: ['chatgpt.tokens.use.direct'],
                };
            } catch (error) {
                if (interaction.signal.aborted) {
                    throw new Error('Login cancelled');
                }
                throw error;
            } finally {
                manualAbort.abort();
            }
        },
        async refresh(credential) {
            fake.refreshes += 1;
            if (behaviour.refreshError) {
                throw behaviour.refreshError instanceof Error ? behaviour.refreshError : new Error(behaviour.refreshError);
            }

            return { ...credential, access: 'secret-access-renewed', expires: Date.now() + 3_600_000 };
        },
        async toAuth(credential) {
            return { apiKey: credential.access };
        },
    };

    fake.provider = () =>
        createProvider({ id: 'openai', auth: { oauth }, models: core.models, api: { stream: core.stream, streamSimple: core.streamSimple } });

    return fake;
}

/** Stand-in for an API-key provider such as OpenCode: the stored key is the request key. */
function fakeKeyProvider(id) {
    const core = createFauxCore({ provider: id, models: [{ id: `${id}-model` }] });
    const auth = {
        apiKey: {
            name: `Fake ${id} key`,
            resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined),
        },
    };

    return {
        core,
        provider: () => createProvider({ id, auth, models: core.models, api: { stream: core.stream, streamSimple: core.streamSimple } }),
    };
}

async function start(options = {}) {
    const { fake = fakeOpenAI(), key = randomBytes(32), loginTimeoutMs = 60_000 } = options;
    const keys = options.keys ?? { opencode: fakeKeyProvider('opencode'), 'opencode-go': fakeKeyProvider('opencode-go') };
    const dir = options.dataDirectory ?? (await mkdtemp(join(tmpdir(), 'engine-')));
    const logs = [];
    const connections =
        options.connections !== undefined
            ? options.connections
            : new ConnectionManager({
                  dataDirectory: dir,
                  key,
                  providers: { openai: fake.provider, opencode: keys.opencode.provider, 'opencode-go': keys['opencode-go'].provider },
                  loginTimeoutMs,
                  testTimeoutMs: 5_000,
                  now: Date.now,
                  log: (message) => logs.push(message),
              });
    const server = createServer(
        { ...loadConfig({ AGENT_REQUEST_SIGNING_KEY: KEY }), now: () => clock, log: (message) => logs.push(message) },
        { connections },
    );
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return { baseUrl: `http://127.0.0.1:${server.address().port}`, fake, keys, dir, logs, responses: [] };
}

async function call(engine, method, path, payload, { contentType = 'application/json', signed = true } = {}) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(clock / 1000));
    const headers = payload === undefined ? {} : { 'content-type': contentType };
    if (signed) {
        headers['x-agent-timestamp'] = timestamp;
        headers['x-agent-signature'] = signRequest(KEY, timestamp, method, path, body);
    }
    const response = await fetch(`${engine.baseUrl}${path}`, { method, headers, body: payload === undefined ? undefined : body });
    const text = await response.text();
    engine.responses.push(text);

    return { status: response.status, body: JSON.parse(text) };
}

const connectionPath = (id, action = '') => `/internal/connections/${id}${action}`;
const statusPath = (id) => `${connectionPath(id)}?provider=openai`;
const loginRequest = { contractVersion: 1, provider: 'openai', agentName: 'Assistant Foundation' };
const testRequest = (modelId = 'gpt-test') => ({ contractVersion: 1, provider: 'openai', modelId });
const stateOf = (login) => new URL(login.authUrl).searchParams.get('state');

const startLogin = (engine, id) => call(engine, 'POST', connectionPath(id, '/login'), loginRequest);
const paste = (engine, id, redirectUrl) => call(engine, 'POST', connectionPath(id, '/login/callback'), { contractVersion: 1, redirectUrl });

async function connect(engine, id, code = 'pasted') {
    const login = await startLogin(engine, id);
    const finished = await paste(engine, id, `${REDIRECT}?code=${code}&state=${stateOf(login.body)}&client_id=issued-client`);
    assert.equal(finished.body.state, 'connected', JSON.stringify(finished.body));
}

async function poll(read, done) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const result = await read();
        if (done(result)) {
            return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('the expected state was not reached');
}

test('connection endpoints need a signature and a configured credential store', async () => {
    const engine = await start();
    const unsigned = await call(engine, 'GET', statusPath(randomUUID()), undefined, { signed: false });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.body.error.code, 'authentication_failed');

    const closed = await start({ connections: null });
    const refused = await call(closed, 'GET', statusPath(randomUUID()));
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error.code, 'credential_store_not_configured');
    assert.deepEqual(validate('error', refused.body), []);

    assert.equal((await (await fetch(`${closed.baseUrl}/internal/health`)).json()).providerAuth, 'not_configured');
    assert.equal((await (await fetch(`${engine.baseUrl}/internal/health`)).json()).providerAuth, 'configured');
});

test('the real providers are never authenticated by an ambient API key', async () => {
    process.env.OPENAI_API_KEY = 'sk-ambient-key-that-must-not-be-used';
    process.env.OPENCODE_API_KEY = 'ambient-opencode-key-that-must-not-be-used';
    try {
        // Control: with Pi's default auth context, these keys alone would authenticate requests.
        const ambient = createModels({ credentials: new InMemoryCredentialStore() });
        ambient.setProvider(openaiProvider());
        ambient.setProvider(opencodeGoProvider());
        assert.equal((await ambient.getAuth('openai'))?.source, 'OPENAI_API_KEY');
        assert.equal((await ambient.getAuth('opencode-go'))?.source, 'OPENCODE_API_KEY');

        const engine = await start({
            fake: { provider: openaiProvider },
            keys: { opencode: { provider: opencodeProvider }, 'opencode-go': { provider: opencodeGoProvider } },
        });
        const id = randomUUID();
        const status = await call(engine, 'GET', statusPath(id));
        assert.equal(status.status, 200);
        assert.deepEqual(validate('connectionStatus', status.body), []);
        assert.equal(status.body.status, 'not_connected');
        assert.ok(status.body.models.includes('gpt-5.4-mini'));

        const result = await call(engine, 'POST', connectionPath(id, '/test'), testRequest('gpt-5.4-mini'));
        assert.equal(result.status, 200);
        assert.deepEqual(validate('connectionTestResult', result.body), []);
        assert.equal(result.body.outcome, 'failed');
        assert.equal(result.body.error.code, 'not_connected');

        for (const provider of ['opencode', 'opencode-go']) {
            const openCode = await call(engine, 'GET', `${connectionPath(id)}?provider=${provider}`);
            assert.equal(openCode.body.status, 'not_connected', provider);
            const modelId = openCode.body.models[0];
            const test = await call(engine, 'POST', connectionPath(id, '/test'), { contractVersion: 1, provider, modelId });
            assert.equal(test.body.error?.code, 'not_connected', provider);
        }
    } finally {
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENCODE_API_KEY;
    }
});

test('an OpenCode key is stored encrypted, used for tests and removed on disconnect', async () => {
    const engine = await start();
    const id = randomUUID();
    const apiKey = 'secret-opencode-key-0123456789';
    const keyPath = connectionPath(id, '/key');

    const saved = await call(engine, 'PUT', keyPath, { contractVersion: 1, provider: 'opencode-go', apiKey });
    assert.equal(saved.status, 200);
    assert.deepEqual(validate('connectionStatus', saved.body), []);
    assert.deepEqual(saved.body, {
        contractVersion: 1,
        connectionId: id,
        provider: 'opencode-go',
        status: 'connected',
        expiresAt: null,
        models: ['opencode-go-model'],
    });
    assert.ok(!(await readFile(join(engine.dir, 'credentials', `${id}.json.enc`), 'utf8')).includes('secret'));

    const seen = [];
    engine.keys['opencode-go'].core.setResponses([
        (_context, options) => {
            seen.push({ apiKey: options?.apiKey, sessionId: options?.sessionId });

            return fauxAssistantMessage('Connected');
        },
    ]);
    const test = await call(engine, 'POST', connectionPath(id, '/test'), { contractVersion: 1, provider: 'opencode-go', modelId: 'opencode-go-model' });
    assert.equal(test.body.outcome, 'ok');
    assert.equal(seen[0].apiKey, apiKey);
    assert.match(seen[0].sessionId ?? '', /^connection-test-[0-9a-f-]{36}$/);

    // Another provider of the same connection is unaffected; a new key replaces the old one.
    assert.equal((await call(engine, 'GET', `${connectionPath(id)}?provider=opencode`)).body.status, 'not_connected');
    await call(engine, 'PUT', keyPath, { contractVersion: 1, provider: 'opencode-go', apiKey: 'secret-replacement-key-987' });
    engine.keys['opencode-go'].core.setResponses([(_context, options) => fauxAssistantMessage(String(options?.apiKey === 'secret-replacement-key-987'))]);
    assert.equal((await call(engine, 'POST', connectionPath(id, '/test'), { contractVersion: 1, provider: 'opencode-go', modelId: 'opencode-go-model' })).body.reply, 'true');

    const removed = await call(engine, 'DELETE', `${connectionPath(id)}?provider=opencode-go`);
    assert.equal(removed.body.status, 'not_connected');
    assert.ok(engine.responses.every((text) => !text.includes('secret')));
    assert.ok(engine.logs.every((line) => !line.includes('secret')));
});

test('keys and browser sign-ins are accepted only for providers that use them', async () => {
    const engine = await start();
    const id = randomUUID();
    const refuse = async (method, path, payload) => {
        const response = await call(engine, method, path, payload);
        assert.equal(response.status, 422, `${method} ${path} ${JSON.stringify(payload)}`);
        assert.equal(response.body.error.code, 'invalid_payload');
    };

    await refuse('PUT', connectionPath(id, '/key'), { contractVersion: 1, provider: 'openai', apiKey: 'sk-0123456789' });
    await refuse('PUT', connectionPath(id, '/key'), { contractVersion: 1, provider: 'opencode', apiKey: 'short' });
    await refuse('PUT', connectionPath(id, '/key'), { contractVersion: 1, provider: 'opencode', apiKey: 'has a space inside' });
    await refuse('POST', connectionPath(id, '/login'), { ...loginRequest, provider: 'opencode' });

    // The manager refuses too, independently of the schemas.
    const manager = new ConnectionManager({
        dataDirectory: engine.dir,
        key: randomBytes(32),
        providers: { openai: fakeOpenAI().provider, opencode: fakeKeyProvider('opencode').provider, 'opencode-go': fakeKeyProvider('opencode-go').provider },
        loginTimeoutMs: 1_000,
        testTimeoutMs: 1_000,
        now: Date.now,
        log: () => {},
    });
    await assert.rejects(manager.saveKey(id, 'openai', 'sk-0123456789'), { code: 'unsupported_auth_method' });
    await assert.rejects(manager.startLogin(id, 'opencode', 'App'), { code: 'unsupported_auth_method' });
});

test('a pasted redirect finishes the sign-in, and pasting mistakes keep it waiting', async () => {
    const engine = await start();
    const id = randomUUID();
    const started = await startLogin(engine, id);
    assert.equal(started.status, 200);
    assert.deepEqual(validate('connectionLogin', started.body), []);
    assert.equal(started.body.connectionId, id);
    assert.equal(started.body.state, 'waiting_for_user');
    const state = stateOf(started.body);

    // Pi receives this installation's stable ID and the application's name.
    const deviceId = (await readFile(join(engine.dir, 'installation-id'), 'utf8')).trim();
    assert.deepEqual(engine.fake.logins, [{ deviceId, agentName: 'Assistant Foundation' }]);

    for (const [redirectUrl, message] of [
        ['not an address', /complete address/],
        [`http://127.0.0.1:9999/auth/callback?code=c&state=${state}`, /must start with http:\/\/127\.0\.0\.1:1455\/auth\/callback/],
        [`${REDIRECT}?code=c&state=state-from-an-older-tab`, /different sign-in/],
        [`${REDIRECT}?state=${state}`, /incomplete/],
    ]) {
        const refused = await paste(engine, id, redirectUrl);
        assert.equal(refused.status, 422, redirectUrl);
        assert.equal(refused.body.error.code, 'invalid_redirect');
        assert.match(refused.body.error.message, message);
    }
    assert.equal((await call(engine, 'GET', connectionPath(id, '/login'))).body.state, 'waiting_for_user');

    const finished = await paste(engine, id, `  ${REDIRECT}?code=pasted&state=${state}&client_id=issued-client  `);
    assert.equal(finished.status, 200);
    assert.deepEqual(validate('connectionLogin', finished.body), []);
    assert.equal(finished.body.state, 'connected');
    assert.equal(finished.body.authUrl, null);

    const status = await call(engine, 'GET', statusPath(id));
    assert.deepEqual(validate('connectionStatus', status.body), []);
    assert.equal(status.body.status, 'connected');
    assert.ok(status.body.expiresAt > Date.now());
    assert.deepEqual(status.body.models, ['gpt-test', 'gpt-test-mini']);

    // Tokens stay in the engine: encrypted on disk and absent from every answer and log line.
    assert.ok(!(await readFile(join(engine.dir, 'credentials', `${id}.json.enc`), 'utf8')).includes('secret'));
    assert.ok(engine.responses.every((text) => !text.includes('secret')));
    assert.ok(engine.logs.every((line) => !line.includes('secret')));
    assert.ok(engine.logs.includes(`Connection ${id}: openai sign-in completed`));
});

test('the browser callback finishes the sign-in without a paste', async () => {
    const engine = await start();
    const id = randomUUID();
    const started = await startLogin(engine, id);

    engine.fake.deliver(`${REDIRECT}?code=browser&state=${stateOf(started.body)}`);
    const login = await poll(() => call(engine, 'GET', connectionPath(id, '/login')), (result) => result.body.state === 'connected');
    assert.deepEqual(validate('connectionLogin', login.body), []);
    assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'connected');

    const late = await paste(engine, id, `${REDIRECT}?code=late&state=${stateOf(started.body)}`);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'login_not_waiting');
});

test('one sign-in runs at a time; the same connection gets its pending sign-in back', async () => {
    const engine = await start();
    const [first, second] = [randomUUID(), randomUUID()];

    const pending = await startLogin(engine, first);
    const again = await startLogin(engine, first);
    assert.equal(again.body.authUrl, pending.body.authUrl);
    assert.equal(engine.fake.logins.length, 1);

    const blocked = await startLogin(engine, second);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'login_in_progress');
    const none = await call(engine, 'GET', connectionPath(second, '/login'));
    assert.equal(none.status, 404);
    assert.equal(none.body.error.code, 'no_login');

    const cancelled = await call(engine, 'DELETE', connectionPath(first, '/login'));
    assert.equal(cancelled.status, 200);
    assert.deepEqual(validate('connectionLogin', cancelled.body), []);
    assert.equal(cancelled.body.state, 'cancelled');
    assert.equal(cancelled.body.error, 'The sign-in was cancelled.');

    assert.equal((await startLogin(engine, second)).body.state, 'waiting_for_user');
    assert.equal((await call(engine, 'GET', statusPath(first))).body.status, 'not_connected');
});

test('a failed exchange or a refusal at the provider ends the sign-in with its reason', async () => {
    const failing = await start({ fake: fakeOpenAI({ exchangeError: 'OpenAI OAuth token request failed (400): invalid_grant' }) });
    const id = randomUUID();
    const login = await startLogin(failing, id);
    const failed = await paste(failing, id, `${REDIRECT}?code=c&state=${stateOf(login.body)}`);
    assert.equal(failed.body.state, 'failed');
    assert.match(failed.body.error, /token request failed \(400\)/);
    assert.equal((await call(failing, 'GET', statusPath(id))).body.status, 'not_connected');

    const engine = await start();
    const refusedLogin = await startLogin(engine, id);
    const refused = await paste(engine, id, `${REDIRECT}?error=access_denied&state=${stateOf(refusedLogin.body)}`);
    assert.equal(refused.body.state, 'failed');
    assert.equal(refused.body.error, 'ChatGPT authorization failed: access_denied');

    // A finished sign-in frees the slot for the next one.
    assert.equal((await startLogin(engine, randomUUID())).body.state, 'waiting_for_user');
});

test('an unfinished sign-in is cancelled when it expires', async () => {
    const engine = await start({ loginTimeoutMs: 40 });
    const id = randomUUID();
    await startLogin(engine, id);

    const expired = await poll(() => call(engine, 'GET', connectionPath(id, '/login')), (result) => result.body.state === 'cancelled');
    assert.match(expired.body.error, /took too long/);
});

test('a test message uses the stored sign-in and reports the reply or the provider error', async () => {
    const engine = await start();
    const id = randomUUID();
    await connect(engine, id, 'abc');

    const seen = [];
    engine.fake.core.setResponses([
        (context, options) => {
            seen.push({ context: JSON.stringify(context), apiKey: options?.apiKey });

            return fauxAssistantMessage('Connected');
        },
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'You exceeded your current quota.' }),
    ]);

    const ok = await call(engine, 'POST', connectionPath(id, '/test'), testRequest());
    assert.equal(ok.status, 200);
    assert.deepEqual(validate('connectionTestResult', ok.body), []);
    assert.equal(ok.body.outcome, 'ok');
    assert.equal(ok.body.reply, 'Connected');
    assert.equal(ok.body.error, null);
    assert.equal(seen[0].apiKey, 'secret-access-abc');
    assert.match(seen[0].context, /Reply with exactly one word: Connected/);

    const failed = await call(engine, 'POST', connectionPath(id, '/test'), testRequest('gpt-test-mini'));
    assert.deepEqual(validate('connectionTestResult', failed.body), []);
    assert.equal(failed.body.outcome, 'failed');
    assert.deepEqual(failed.body.error, { code: 'provider_error', message: 'You exceeded your current quota.' });

    const unknown = await call(engine, 'POST', connectionPath(id, '/test'), testRequest('gpt-missing'));
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error.code, 'unknown_model');
    assert.ok(engine.responses.every((text) => !text.includes('secret')));
});

test('an expired sign-in is renewed before a test, or reported when renewal fails', async () => {
    const renewing = await start({ fake: fakeOpenAI({ expires: Date.now() - 1 }) });
    const id = randomUUID();
    await connect(renewing, id);
    const seen = [];
    renewing.fake.core.setResponses([
        (_context, options) => {
            seen.push(options?.apiKey);

            return fauxAssistantMessage('Connected');
        },
    ]);
    assert.equal((await call(renewing, 'POST', connectionPath(id, '/test'), testRequest())).body.outcome, 'ok');
    assert.deepEqual(seen, ['secret-access-renewed']);
    assert.ok((await call(renewing, 'GET', statusPath(id))).body.expiresAt > Date.now());

    const revoked = await start({ fake: fakeOpenAI({ expires: Date.now() - 1, refreshError: 'invalid_grant' }) });
    await connect(revoked, id);
    const result = await call(revoked, 'POST', connectionPath(id, '/test'), testRequest());
    assert.deepEqual(validate('connectionTestResult', result.body), []);
    assert.equal(result.body.error.code, 'reauth_required');
    assert.equal(revoked.fake.refreshes, 1);
    assert.equal(revoked.fake.core.state.callCount, 0, 'no model request without a valid sign-in');
    // The credential is kept, so a later renewal can still be retried, but the status says it was rejected.
    const status = await call(revoked, 'GET', statusPath(id));
    assert.deepEqual(validate('connectionStatus', status.body), []);
    assert.equal(status.body.status, 'reauth_required');

    // A new sign-in replaces the rejected one.
    await connect(revoked, id, 'again');
    assert.equal((await call(revoked, 'GET', statusPath(id))).body.status, 'connected');
});

/** What undici's fetch rejects with when the connection fails; the code sits on the cause. */
const fetchFailed = (code, message = code) => new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

test('a renewal that never got an answer from the provider keeps the sign-in connected', async () => {
    const cases = {
        'certificate interception': [fetchFailed('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain'), /intercepted.*SELF_SIGNED_CERT_IN_CHAIN.*scans HTTPS/],
        'nested connection code': [new TypeError('fetch failed', { cause: new Error('connect failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }) }), /could not be reached \(ECONNRESET\)/],
        'bare fetch failure': [new TypeError('fetch failed'), /could not be reached\./],
        timeout: [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), /did not answer in time/],
        'provider outage': [new Error('OpenAI OAuth token request failed (503): Service Unavailable'), /temporary problem \(503\)/],
    };

    for (const [name, [refreshError, message]] of Object.entries(cases)) {
        const behaviour = { expires: Date.now() - 1, refreshError };
        const engine = await start({ fake: fakeOpenAI(behaviour) });
        const id = randomUUID();
        await connect(engine, id);

        const result = await call(engine, 'POST', connectionPath(id, '/test'), testRequest());
        assert.deepEqual(validate('connectionTestResult', result.body), [], name);
        assert.equal(result.body.error.code, 'provider_error', name);
        assert.match(result.body.error.message, message, name);
        assert.match(result.body.error.message, /no need to sign in again/, name);
        assert.equal(engine.fake.core.state.callCount, 0, `${name}: no model request without a valid sign-in`);
        assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'connected', name);

        // Once the provider answers again, the next request renews the same stored sign-in.
        behaviour.refreshError = undefined;
        engine.fake.core.setResponses([fauxAssistantMessage('Connected')]);
        assert.equal((await call(engine, 'POST', connectionPath(id, '/test'), testRequest())).body.outcome, 'ok', name);
        assert.equal(engine.fake.refreshes, 2, name);
        assert.ok((await call(engine, 'GET', statusPath(id))).body.expiresAt > Date.now(), name);
    }
});

test('a chat run whose renewal is cut off fails with a retryable error and leaves the account connected', async () => {
    const engine = await start({ fake: fakeOpenAI({ expires: Date.now() - 1, refreshError: fetchFailed('SELF_SIGNED_CERT_IN_CHAIN') }) });
    const id = randomUUID();
    await connect(engine, id);
    const example = JSON.parse(await readFile(new URL('../../contracts/v1/examples/run-request-live.json', import.meta.url), 'utf8'));
    const run = { ...example, runId: randomUUID(), connectionId: id, model: { provider: 'openai', id: 'gpt-test', reasoning: 'medium' } };
    assert.equal((await call(engine, 'POST', '/internal/runs', run)).status, 202);

    const path = `/internal/runs/${run.runId}/events`;
    const timestamp = String(Math.floor(clock / 1000));
    const response = await fetch(`${engine.baseUrl}${path}`, {
        headers: { 'x-agent-timestamp': timestamp, 'x-agent-signature': signRequest(KEY, timestamp, 'GET', path, '') },
    });
    const events = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const failed = events.find((event) => event.type === 'run.failed');
    assert.ok(events.every((event) => validate('runEvent', event).length === 0));
    assert.equal(failed?.data.code, 'provider_error', JSON.stringify(failed));
    assert.match(failed.data.message, /SELF_SIGNED_CERT_IN_CHAIN.*no need to sign in again/s);
    assert.equal(engine.fake.core.state.callCount, 0);
    assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'connected');
});

test('a refusal still asks for a new sign-in, even beside a network-looking error or a server status', async () => {
    const cases = {
        'refused with 401': new Error('OpenAI OAuth token request failed (401): {"error":"invalid_grant"}'),
        'invalid_grant behind a 5xx': new Error('OpenAI OAuth token request failed (500): {"error":"invalid_grant"}'),
        'refusal deeper in the chain': new TypeError('fetch failed', { cause: new Error('refresh token was revoked') }),
        'unrecognized failure': new Error('OpenAI OAuth token response must be an object'),
    };

    for (const [name, refreshError] of Object.entries(cases)) {
        const engine = await start({ fake: fakeOpenAI({ expires: Date.now() - 1, refreshError }) });
        const id = randomUUID();
        await connect(engine, id);

        const result = await call(engine, 'POST', connectionPath(id, '/test'), testRequest());
        assert.equal(result.body.error.code, 'reauth_required', name);
        assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'reauth_required', name);
    }
});

test('disconnecting removes the stored sign-in and cancels a pending one', async () => {
    const engine = await start();
    const id = randomUUID();
    await connect(engine, id);

    const removed = await call(engine, 'DELETE', statusPath(id));
    assert.equal(removed.status, 200);
    assert.deepEqual(validate('connectionStatus', removed.body), []);
    assert.equal(removed.body.status, 'not_connected');
    assert.deepEqual(await readdir(join(engine.dir, 'credentials')), []);

    await startLogin(engine, id);
    await call(engine, 'DELETE', statusPath(id));
    const login = await call(engine, 'GET', connectionPath(id, '/login'));
    assert.equal(login.body.state, 'cancelled');
    assert.equal(login.body.error, 'The connection was removed.');
});

test('an unreadable stored sign-in is reported and replaced by a new sign-in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'engine-'));
    const id = randomUUID();
    await new CredentialVault(join(dir, 'credentials'), id, randomBytes(32)).modify('openai', async () => ({
        type: 'oauth',
        access: 'secret-old',
        refresh: 'secret-old',
        expires: Date.now() + 3_600_000,
    }));

    // Same files, different credential key: as after AGENT_CREDENTIAL_KEY changes.
    const engine = await start({ dataDirectory: dir });
    assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'unreadable');
    const result = await call(engine, 'POST', connectionPath(id, '/test'), testRequest());
    assert.equal(result.body.error.code, 'credentials_unreadable');

    await connect(engine, id);
    assert.equal((await call(engine, 'GET', statusPath(id))).body.status, 'connected');
});

test('connection requests must match their routes and contracts', async () => {
    const engine = await start();
    const id = randomUUID();
    const invalid = async (method, path, payload, code, options) => {
        const response = await call(engine, method, path, payload, options);
        assert.equal(response.body.error?.code, code, `${method} ${path}`);
        assert.deepEqual(validate('error', response.body), []);

        return response;
    };

    const extra = await invalid('POST', connectionPath(id, '/login'), { ...loginRequest, accessToken: 'x' }, 'invalid_payload');
    assert.ok(extra.body.error.details.some((issue) => issue.path === '/accessToken'));
    await invalid('POST', connectionPath(id, '/login'), { ...loginRequest, provider: 'anthropic' }, 'invalid_payload');
    await invalid('POST', connectionPath(id, '/login'), { ...loginRequest, agentName: '<script>' }, 'invalid_payload');
    await invalid('POST', connectionPath(id, '/login'), { ...loginRequest, contractVersion: 2 }, 'unsupported_contract_version');
    await invalid('POST', connectionPath(id, '/login'), loginRequest, 'unsupported_media_type', { contentType: 'text/plain' });
    await invalid('POST', connectionPath(id, '/test'), testRequest('bad model'), 'invalid_payload');
    await invalid('POST', connectionPath(id, '/login/callback'), { contractVersion: 1, redirectUrl: 'x'.repeat(4097) }, 'invalid_payload');
    await invalid('POST', connectionPath(id, '/login/callback'), { contractVersion: 1, redirectUrl: `${REDIRECT}?code=c` }, 'no_login');
    await invalid('GET', `${connectionPath(id)}?provider=anthropic`, undefined, 'invalid_payload');
    await invalid('GET', connectionPath(id), undefined, 'invalid_payload');
    await invalid('GET', '/internal/connections/NOT-A-UUID?provider=openai', undefined, 'not_found');
    await invalid('PUT', connectionPath(id, '/login'), undefined, 'not_found');
    await invalid('POST', connectionPath(id), loginRequest, 'not_found');
    assert.equal(engine.fake.logins.length, 0);
});
