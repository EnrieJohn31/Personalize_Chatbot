import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fingerprint, validate } from '../dist/contracts.js';
import { canonicalRequest, signRequest } from '../dist/http/service-auth.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../contracts/v1/examples/${name}`, import.meta.url), 'utf8'));
const runRequest = example('run-request.json');
const paths = (contract, value) => validate(contract, value).map((issue) => issue.path);

test('shared examples satisfy their v1 schemas', () => {
    assert.deepEqual(validate('runRequest', runRequest), []);
    assert.deepEqual(validate('runRequest', example('run-request-live.json')), []);
    assert.deepEqual(validate('runAcknowledgement', example('run-acknowledgement.json')), []);
    assert.deepEqual(validate('error', example('error.json')), []);
    for (const event of [...example('run-events.json'), ...example('run-events-tool.json')]) {
        assert.deepEqual(validate('runEvent', event), [], event.type);
    }
});

test('tool events carry only identifiers, outcomes and source metadata', () => {
    const [, , , started, source, finished] = example('run-events-tool.json');
    const rejected = (event) => validate('runEvent', event).length > 0;

    assert.ok(rejected({ ...started, data: { ...started.data, arguments: { query: 'x' } } }), 'no arguments');
    assert.ok(rejected({ ...finished, data: { ...finished.data, result: 'text' } }), 'no result text');
    assert.ok(rejected({ ...finished, data: { ...finished.data, outcome: 'maybe' } }));
    assert.ok(rejected({ ...source, data: { ...source.data, checkedAt: 'yesterday' } }));
    assert.ok(rejected({ ...started, data: { ...started.data, toolCallId: 'has space' } }));
});

test('signing matches the independently computed test vector', () => {
    const vector = example('signature.json');
    assert.equal(canonicalRequest(vector.timestamp, vector.method, vector.target, vector.body), vector.canonicalRequest);
    assert.equal(signRequest(vector.key, vector.timestamp, vector.method, vector.target, vector.body), vector.signature);
});

test('run requests reject unknown fields, including browser-style credentials and tool lists', () => {
    assert.ok(paths('runRequest', { ...runRequest, credentials: { token: 'secret' } }).includes('/credentials'));
    assert.ok(paths('runRequest', { ...runRequest, tools: ['shell'] }).includes('/tools'));
    assert.ok(paths('runRequest', { ...runRequest, model: { ...runRequest.model, apiKey: 'secret' } }).includes('/model/apiKey'));
    assert.ok(paths('runRequest', { ...runRequest, model: { ...runRequest.model, reasoning: 'max' } }).includes('/model/reasoning'));
});

test('run requests enforce identifiers, roles, sizes and limits', () => {
    const message = runRequest.messages[0];
    const invalid = {
        '/runId': { ...runRequest, runId: runRequest.runId.toUpperCase() },
        '/userId': { ...runRequest, userId: '0' },
        '/connectionId': { ...runRequest, connectionId: 'not-a-uuid' },
        '/capabilities': { ...runRequest, capabilities: ['lookup_reference', 'lookup_reference'] },
        '/messages': { ...runRequest, messages: [] },
        '/messages/0/role': { ...runRequest, messages: [{ ...message, role: 'system' }] },
        '/messages/0/content': { ...runRequest, messages: [{ ...message, content: 'x'.repeat(64_001) }] },
        '/limits/maxModelRounds': { ...runRequest, limits: { ...runRequest.limits, maxModelRounds: 17 } },
        '/limits/runDeadlineMs': { ...runRequest, limits: { ...runRequest.limits, runDeadlineMs: 999 } },
    };
    for (const [path, value] of Object.entries(invalid)) {
        assert.ok(paths('runRequest', value).includes(path), `expected an issue at ${path}`);
    }
    assert.ok(paths('runRequest', { ...runRequest, messages: Array(201).fill(message) }).includes('/messages'));
    assert.ok(paths('runRequest', { ...runRequest, contractVersion: 2 }).includes('/contractVersion'));
});

test('events accept only known types with type-specific data', () => {
    const [started, , delta, , final] = example('run-events.json');
    assert.ok(validate('runEvent', { ...started, type: 'provider.raw_frame' }).length > 0);
    assert.ok(validate('runEvent', { ...started, data: { leaked: true } }).length > 0);
    assert.ok(validate('runEvent', { ...delta, data: { text: '' } }).length > 0);
    assert.ok(validate('runEvent', { ...final, data: { text: 'answer', reasoning: 'hidden' } }).length > 0);
    assert.ok(validate('runEvent', { ...started, type: 'run.failed', data: { message: 'no code' } }).length > 0);
    assert.ok(validate('runEvent', { ...started, sequence: 0 }).length > 0);
    assert.deepEqual(validate('runEvent', { ...started, type: 'run.failed', data: { code: 'provider_error', message: 'Upstream failed.' } }), []);
});

test('connection examples satisfy their v1 schemas', () => {
    const examples = {
        connectionLoginRequest: 'connection-login-request.json',
        connectionCallbackRequest: 'connection-callback-request.json',
        connectionKeyRequest: 'connection-key-request.json',
        connectionTestRequest: 'connection-test-request.json',
        connectionLogin: 'connection-login.json',
        connectionStatus: 'connection-status.json',
        connectionTestResult: 'connection-test-result.json',
        localModelStatus: 'local-model-status.json',
    };
    for (const [contract, file] of Object.entries(examples)) {
        assert.deepEqual(validate(contract, example(file)), [], file);
    }
});

test('connection answers reject credential fields and inconsistent outcomes', () => {
    const status = example('connection-status.json');
    assert.ok(paths('connectionStatus', { ...status, access: 'token' }).includes('/access'));
    assert.ok(paths('connectionStatus', { ...status, status: 'expired' }).includes('/status'));
    assert.ok(paths('connectionLogin', { ...example('connection-login.json'), authUrl: 'http://insecure.example' }).includes('/authUrl'));
    assert.ok(paths('connectionLoginRequest', { ...example('connection-login-request.json'), apiKey: 'x' }).includes('/apiKey'));
    assert.deepEqual(validate('connectionStatus', { ...status, provider: 'opencode-go', expiresAt: null }), []);
    assert.ok(paths('connectionStatus', { ...status, apiKey: 'leaked' }).includes('/apiKey'));
    assert.ok(paths('connectionLoginRequest', { ...example('connection-login-request.json'), provider: 'opencode' }).includes('/provider'));
    assert.ok(paths('connectionKeyRequest', { ...example('connection-key-request.json'), provider: 'openai' }).includes('/provider'));

    const ok = example('connection-test-result.json');
    const failure = { code: 'timeout', message: 'The provider did not answer within 60 seconds.' };
    assert.ok(validate('connectionTestResult', { ...ok, error: failure }).length > 0, 'ok with an error');
    assert.ok(validate('connectionTestResult', { ...ok, outcome: 'failed' }).length > 0, 'failed without an error');
    assert.ok(validate('connectionTestResult', { ...ok, outcome: 'failed', error: failure }).length > 0, 'failed with a reply');
    assert.ok(validate('connectionTestResult', { ...ok, outcome: 'failed', reply: null, error: { ...failure, code: 'raw' } }).length > 0);
    assert.deepEqual(validate('connectionTestResult', { ...ok, outcome: 'failed', reply: null, error: failure }), []);
});

test('fingerprints ignore key order but not values', () => {
    const reordered = Object.fromEntries(Object.entries(runRequest).reverse());
    assert.equal(fingerprint(reordered), fingerprint(runRequest));
    assert.notEqual(fingerprint({ ...runRequest, userId: '43' }), fingerprint(runRequest));
});
