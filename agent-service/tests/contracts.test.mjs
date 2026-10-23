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
    assert.deepEqual(validate('runAcknowledgement', example('run-acknowledgement.json')), []);
    assert.deepEqual(validate('error', example('error.json')), []);
    for (const event of example('run-events.json')) {
        assert.deepEqual(validate('runEvent', event), [], event.type);
    }
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

test('fingerprints ignore key order but not values', () => {
    const reordered = Object.fromEntries(Object.entries(runRequest).reverse());
    assert.equal(fingerprint(reordered), fingerprint(runRequest));
    assert.notEqual(fingerprint({ ...runRequest, userId: '43' }), fingerprint(runRequest));
});
