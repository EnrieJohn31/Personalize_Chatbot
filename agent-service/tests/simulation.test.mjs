import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validate } from '../dist/contracts.js';
import { RunExecution } from '../dist/runtime/run-execution.js';
import { chunks, runSimulation, simulatedAnswer } from '../dist/simulation/simulated-run.js';

const example = JSON.parse(readFileSync(new URL('../../contracts/v1/examples/run-request.json', import.meta.url), 'utf8'));
const fast = { chunkDelayMs: 0, now: Date.now };

async function simulate(run = example, options = fast) {
    const execution = new RunExecution(run.runId, 2000);
    const events = [];
    execution.subscribe((event) => events.push(event));
    await runSimulation(run, execution, options);
    return { execution, events };
}

test('the simulated answer is deterministic and quotes the question as Markdown', () => {
    const answer = simulatedAnswer(example);
    assert.equal(answer, simulatedAnswer(structuredClone(example)));
    assert.match(answer, /^\*\*Simulated reply\.\*\*/);
    assert.ok(answer.includes('> Thanks. Summarize that in one line.'));
    assert.ok(answer.includes('3 messages of saved history'));
    assert.ok(answer.includes('```text'));
});

test('long questions are quoted on a character boundary', () => {
    const run = { ...example, messages: [{ ...example.messages[0], content: '😀'.repeat(300) }] };
    const quote = simulatedAnswer(run).split('\n').find((line) => line.startsWith('> '));
    assert.equal(Array.from(quote.slice(2)).length, 281);
    assert.ok(quote.endsWith('…'));
});

test('chunks keep every character of the answer', () => {
    const answer = simulatedAnswer(example);
    const pieces = chunks(answer);
    assert.ok(pieces.length > 10);
    assert.equal(pieces.join(''), answer);
    assert.ok(pieces.every((piece) => piece.length > 0));
});

test('a run streams contract-valid events whose deltas add up to the final text', async () => {
    const { events, execution } = await simulate();
    assert.deepEqual(events.slice(0, 2).map((event) => event.type), ['run.started', 'run.progress']);
    assert.deepEqual(events.slice(-2).map((event) => event.type), ['assistant.final', 'run.completed']);
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
    for (const event of events) {
        assert.deepEqual(validate('runEvent', event), [], `${event.type} #${event.sequence}`);
    }
    const draft = events.filter((event) => event.type === 'assistant.delta').map((event) => event.data.text).join('');
    assert.equal(draft, events.at(-2).data.text);
    assert.equal(execution.terminal, true);
});

test('cancellation stops the deltas and ends with run.cancelled instead of a final answer', async () => {
    const execution = new RunExecution(example.runId, 2000);
    const events = [];
    execution.subscribe((event) => {
        events.push(event);
        if (event.type === 'assistant.delta' && events.length === 4) {
            execution.cancel();
        }
    });
    await runSimulation(example, execution, { chunkDelayMs: 5, now: Date.now });
    assert.equal(events.at(-1).type, 'run.cancelled');
    assert.ok(!events.some((event) => event.type === 'assistant.final'));
    assert.equal(events.filter((event) => event.type === 'assistant.delta').length, 2);
});

test('a run past its deadline fails explicitly', async () => {
    let clock = 0;
    const run = { ...example, limits: { ...example.limits, runDeadlineMs: 1000 } };
    const { events } = await simulate(run, { chunkDelayMs: 0, now: () => (clock += 400) });
    assert.equal(events.at(-1).type, 'run.failed');
    assert.equal(events.at(-1).data.code, 'deadline_exceeded');
});

test('executions accept nothing after a terminal event and stay within their event limit', () => {
    // A limit of three keeps the last slot for a terminal event: two ordinary events fit.
    const execution = new RunExecution(example.runId, 3);
    execution.emit('run.started');
    assert.equal(execution.emit('assistant.delta', { text: 'fits' }).type, 'assistant.delta');
    const capped = execution.emit('assistant.delta', { text: 'too many' });
    assert.equal(capped.type, 'run.failed');
    assert.equal(capped.data.code, 'event_limit_exceeded');
    assert.equal(execution.emit('assistant.delta', { text: 'late' }), null);
    assert.deepEqual(execution.after(1).map((event) => event.sequence), [2, 3]);
    assert.doesNotThrow(() => execution.subscribe(() => assert.fail('terminal runs notify nobody'))());
});
