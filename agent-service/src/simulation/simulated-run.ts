import { setTimeout as sleep } from 'node:timers/promises';
import type { RunRequest } from '../contracts.js';
import type { RunExecution } from '../runtime/run-execution.js';

const QUOTE_LIMIT = 280;

/**
 * Deterministic development answer: the same request always yields the same text. It quotes
 * the question and includes Markdown so the interface's safe rendering can be checked.
 */
export function simulatedAnswer(run: RunRequest): string {
    const question = run.messages.at(-1)?.content ?? '';
    const characters = Array.from(question);
    const quoted = characters.length > QUOTE_LIMIT ? `${characters.slice(0, QUOTE_LIMIT).join('')}…` : question;
    const history = run.messages.length === 1 ? 'one message' : `${run.messages.length} messages`;

    return [
        '**Simulated reply.** No model was called; this text tests streaming and Markdown.',
        '',
        'You wrote:',
        '',
        ...quoted.split('\n').map((line) => `> ${line}`),
        '',
        `The request carried ${history} of saved history.`,
        '',
        '- Text arrives in small pieces.',
        '- The final event replaces the draft.',
        '',
        '```text',
        `run ${run.runId.slice(0, 8)}`,
        '```',
    ].join('\n');
}

/** Splits text into chunks of about three words, keeping every character. */
export function chunks(text: string): string[] {
    return text.match(/(?:\S+\s*){1,3}|\s+/g) ?? [];
}

/**
 * Streams a simulated answer into `execution`, honouring cancellation and the run deadline.
 * Every path ends with exactly one terminal event.
 */
export async function runSimulation(
    run: RunRequest,
    execution: RunExecution,
    options: { chunkDelayMs: number; now: () => number },
): Promise<void> {
    const deadline = options.now() + run.limits.runDeadlineMs;
    const answer = simulatedAnswer(run);

    execution.emit('run.started');
    execution.emit('run.progress', { stage: 'answering' });

    try {
        for (const text of chunks(answer)) {
            if (execution.terminal) {
                return;
            }
            if (execution.signal.aborted) {
                execution.emit('run.cancelled');
                return;
            }
            if (options.now() > deadline) {
                execution.emit('run.failed', { code: 'deadline_exceeded', message: 'The run exceeded its time limit.' });
                return;
            }

            execution.emit('assistant.delta', { text });
            await sleep(options.chunkDelayMs, undefined, { signal: execution.signal });
        }
    } catch (error) {
        if (execution.signal.aborted) {
            execution.emit('run.cancelled');
            return;
        }
        throw error;
    }

    if (execution.signal.aborted) {
        execution.emit('run.cancelled');
        return;
    }

    execution.emit('assistant.final', { text: answer });
    execution.emit('run.completed');
}
