import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { validate } from '../dist/contracts.js';
import { RunExecution } from '../dist/runtime/run-execution.js';
import { ToolExecutor } from '../dist/tools/executor.js';
import { lookupReference } from '../dist/tools/lookup-reference.js';
import { SUPPORTED_CAPABILITIES, TOOLS } from '../dist/tools/registry.js';

const RUN_ID = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0f';
const signal = new AbortController().signal;
const call = (id, name = 'lookup_reference') => ({ toolCall: { type: 'toolCall', id, name, arguments: {} } });

/** A tool definition for executor tests: its run function decides how it behaves. */
function fakeTool(run, overrides = {}) {
    return {
        name: 'fake_lookup',
        label: 'Fake lookup',
        description: 'Test tool.',
        parameters: Type.Object({ query: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        capability: 'fake_lookup',
        effect: 'read',
        timeoutMs: 1_000,
        maxResultLength: 100,
        run,
        ...overrides,
    };
}

function executor(capabilities, { maxToolCalls = 6, registry } = {}) {
    const execution = new RunExecution(RUN_ID, 2_000);
    const tools = new ToolExecutor(capabilities, maxToolCalls, execution, () => {}, registry);
    const events = () => execution.after(0);

    return { tools, events, execution, execute: (id, args) => tools.agentTools()[0].execute(id, args, signal) };
}

test('a stopped run or already-aborted tool signal never invokes a tool', async () => {
    for (const stoppedBy of ['run', 'agent']) {
        let calls = 0;
        const tool = fakeTool(async () => {
            calls += 1;
            return { text: 'Must not run', sources: [] };
        });
        const { tools, execution, events } = executor(['fake_lookup'], { registry: [tool] });
        const controller = new AbortController();
        if (stoppedBy === 'run') execution.cancel();
        else controller.abort();

        const result = await tools.agentTools()[0].execute('call-1', { query: 'x' }, controller.signal);

        assert.equal(calls, 0, stoppedBy);
        assert.equal(result.details.outcome, 'cancelled');
        assert.equal(events().length, 0);
    }
});

test('Stop arriving at tool.started prevents dispatch', async () => {
    let calls = 0;
    const tool = fakeTool(async () => {
        calls += 1;
        return { text: 'Must not run', sources: [] };
    });
    const { tools, execution, events, execute } = executor(['fake_lookup'], { registry: [tool] });
    execution.subscribe((event) => {
        if (event.type === 'tool.started') execution.cancel();
    });

    const result = await execute('call-1', { query: 'x' });
    tools.finish('call-1', 'fake_lookup', true);

    assert.equal(calls, 0);
    assert.equal(result.details.outcome, 'cancelled');
    assert.deepEqual(events().map((event) => event.type), ['tool.started', 'tool.finished']);
    assert.equal(events().at(-1).data.outcome, 'cancelled');
    assert.ok(events().every((event) => validate('runEvent', event).length === 0));
});

test('Stop aborts an active tool and ignores a late result even if the tool ignores cancellation', { timeout: 2000 }, async (t) => {
    const started = Promise.withResolvers();
    const late = Promise.withResolvers();
    let toolSignal;
    const tool = fakeTool((_args, signal) => {
        toolSignal = signal;
        started.resolve();
        return late.promise;
    });
    const { tools, execution, events, execute } = executor(['fake_lookup'], { registry: [tool] });
    const work = execute('call-1', { query: 'x' });
    await started.promise;
    const stoppedAt = performance.now();
    execution.cancel();
    const result = await work;
    t.diagnostic(`Active tool cancellation settled in ${(performance.now() - stoppedAt).toFixed(2)} ms.`);
    tools.finish('call-1', 'fake_lookup', true);

    assert.equal(toolSignal.aborted, true);
    assert.equal(result.details.outcome, 'cancelled');
    assert.equal(tools.available, false);
    assert.equal(tools.beforeToolCall(call('call-2', 'fake_lookup')).block, true);
    const count = events().length;
    late.resolve({ text: 'Late answer', sources: [{ evidenceId: 'late', title: 'Late', locator: 'fixture://late', checkedAt: '2026-10-25' }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events().length, count, 'late output is discarded');
    assert.equal(events().filter((event) => event.type === 'source.added').length, 0);
});

test('the reference lookup refuses an already-aborted signal', async () => {
    await assert.rejects(lookupReference.run({ query: 'SAMPLE-001' }, AbortSignal.abort()), { name: 'AbortError' });
});

test('every registered tool declares its contract and only lookup_reference exists so far', () => {
    assert.deepEqual(TOOLS.map((tool) => tool.name), ['lookup_reference']);
    assert.deepEqual([...SUPPORTED_CAPABILITIES], ['lookup_reference']);
    for (const tool of TOOLS) {
        assert.equal(tool.effect, 'read');
        assert.equal(tool.timeoutMs, 10_000);
        assert.ok(tool.maxResultLength > 0 && tool.description.length > 0 && tool.parameters.type === 'object');
    }
});

test('lookup_reference finds entries by code or keywords and says when nothing matches', async () => {
    const byCode = await lookupReference.run({ query: 'what is samPLE-002?' }, signal);
    assert.equal(byCode.sources[0].evidenceId, 'ref-sample-warehouse');
    assert.match(byCode.text, /\[SAMPLE-002\] Sample warehouse \(evidence ref-sample-warehouse, checked 2026-10-01\)/);

    const byWords = await lookupReference.run({ query: 'guest wifi network' }, signal);
    assert.deepEqual(byWords.sources.map((source) => source.evidenceId), ['ref-guest-wifi']);

    const many = await lookupReference.run({ query: 'invented policy office warehouse hours' }, signal);
    assert.ok(many.sources.length <= 3);

    const none = await lookupReference.run({ query: 'quantum teleporter' }, signal);
    assert.deepEqual(none, { text: 'No reference entry matches "quantum teleporter".', sources: [] });
});

test('only permitted tools are offered, and a call is checked for permission, repeats and the budget', () => {
    assert.deepEqual(executor([]).tools.agentTools(), []);
    assert.equal(executor([]).tools.available, false);

    const { tools } = executor(['lookup_reference'], { maxToolCalls: 2 });
    assert.deepEqual(tools.agentTools().map((tool) => tool.name), ['lookup_reference']);
    assert.equal(tools.beforeToolCall(call('call-1')), undefined);
    assert.deepEqual(tools.beforeToolCall(call('call-1')), { block: true, reason: 'This tool call was already handled.' });
    assert.equal(tools.beforeToolCall(call('call-2')), undefined);
    assert.equal(tools.available, false);
    assert.deepEqual(tools.beforeToolCall(call('call-3')), {
        block: true,
        reason: 'No more lookups are allowed for this reply. Answer with what you already have.',
    });
    assert.match(tools.beforeToolCall(call('call-4', 'delete_everything')).reason, /not available/);
});

test('a permitted call reports start, sources and outcome; refused calls never start', async () => {
    const { tools, events, execute } = executor(['lookup_reference']);
    tools.beforeToolCall(call('call-1'));
    const result = await execute('call-1', { query: 'SAMPLE-001' });
    tools.finish('call-1', 'lookup_reference', false);
    tools.finish('call-x', 'Not A Tool!', true);
    tools.finish('call-y', 'lookup_reference', true);

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /SAMPLE-001/);
    const all = events();
    assert.deepEqual(all.map((event) => event.type), ['tool.started', 'source.added', 'tool.finished', 'tool.finished', 'tool.finished']);
    assert.ok(all.every((event) => validate('runEvent', event).length === 0), JSON.stringify(all));
    assert.deepEqual(all.slice(2).map((event) => [event.data.outcome, event.data.message]), [
        ['ok', null],
        ['blocked', 'The requested tool is not available in this conversation.'],
        ['invalid_arguments', 'The tool arguments do not match its schema.'],
    ]);
});

test('arguments are checked again when a call runs', async () => {
    const { execute, events } = executor(['lookup_reference']);
    const result = await execute('call-1', { query: '', extra: true });

    assert.equal(result.isError, true);
    assert.equal(result.details.outcome, 'invalid_arguments');
    assert.equal(events().length, 0, 'the lookup never started');
});

test('timeouts, failures and oversized results end with explicit outcomes', async () => {
    const slow = fakeTool(() => new Promise(() => {}), { timeoutMs: 50 });
    const timedOut = await executor(['fake_lookup'], { registry: [slow] }).execute('call-1', { query: 'x' });
    assert.deepEqual([timedOut.isError, timedOut.details.outcome, timedOut.content[0].text], [true, 'timeout', 'fake_lookup did not finish within 0.05 seconds.']);

    const broken = fakeTool(async () => {
        throw new Error('database password is hunter2');
    });
    const failed = await executor(['fake_lookup'], { registry: [broken] }).execute('call-1', { query: 'x' });
    assert.deepEqual([failed.details.outcome, failed.content[0].text], ['failed', 'fake_lookup could not complete.'], 'internal errors are not passed on');

    const large = fakeTool(async () => ({ text: '😀'.repeat(200), sources: [] }));
    const shortened = await executor(['fake_lookup'], { registry: [large] }).execute('call-1', { query: 'x' });
    const [kept, note] = shortened.content[0].text.split('\n');
    assert.ok(shortened.content[0].text.length <= large.maxResultLength, 'the notice counts toward the size cap');
    assert.equal(kept, '😀'.repeat(kept.length / 2), 'cut on a character boundary');
    assert.equal(note, '[Result shortened to fit the tool size limit.]');
});

test('a result cap smaller than the truncation notice is still enforced', async () => {
    const tiny = fakeTool(async () => ({ text: 'x'.repeat(100), sources: [] }), { maxResultLength: 8 });
    const result = await executor(['fake_lookup'], { registry: [tiny] }).execute('call-1', { query: 'x' });

    assert.equal(result.details.outcome, 'ok');
    assert.ok(result.content[0].text.length <= tiny.maxResultLength);
});
