import { describe, expect, test } from 'vite-plus/test';
import type { RunAction, RunState, RunStreamEvent } from '@/lib/chat-run-state';
import {
    initialRunState,
    isResponding,
    needsConnectionFix,
    runReducer,
} from '@/lib/chat-run-state';
import type { ChatRun } from '@/types';

const run: ChatRun = {
    id: '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e',
    conversation_id: '0199f29f-1b2c-7d3e-8f40-516273849506',
    events_url: '/api/chat/runs/0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e/events',
};

const event = (
    type: RunStreamEvent['type'],
    sequence: number | null,
    data: Record<string, unknown> = {},
): RunAction => ({ type: 'event', event: { type, sequence, data } });

const reduce = (...actions: RunAction[]): RunState =>
    actions.reduce(runReducer, initialRunState);

const following: RunAction = { type: 'following', run };

describe('runReducer', () => {
    test('deltas accumulate into the draft while streaming', () => {
        const state = reduce(
            following,
            event('run.started', 1),
            event('run.progress', 2, { stage: 'answering' }),
            event('assistant.delta', 3, { text: 'Hello ' }),
            event('assistant.delta', 4, { text: '**world**' }),
        );

        expect(state.status).toBe('streaming');
        expect(state.draft).toBe('Hello **world**');
        expect(state.stage).toBe('answering');
        expect(isResponding(state.status)).toBe(true);
    });

    test('the final text replaces the draft instead of being appended', () => {
        const state = reduce(
            following,
            event('assistant.delta', 1, { text: 'Hello ' }),
            event('assistant.delta', 2, { text: 'wor' }),
            event('assistant.final', 3, { text: 'Hello world.' }),
            event('run.completed', 4),
        );

        expect(state.draft).toBe('Hello world.');
        expect(state.status).toBe('completed');
        expect(isResponding(state.status)).toBe(false);
    });

    test('events replayed after a reconnect are applied once', () => {
        const state = reduce(
            following,
            event('assistant.delta', 1, { text: 'One ' }),
            event('assistant.delta', 2, { text: 'two ' }),
            event('assistant.delta', 2, { text: 'two ' }),
            event('assistant.delta', 1, { text: 'One ' }),
            event('assistant.delta', 3, { text: 'three' }),
        );

        expect(state.draft).toBe('One two three');
        expect(state.lastSequence).toBe(3);
    });

    test('a resumable stream error keeps the reply and waits for the reconnect', () => {
        const interrupted = reduce(
            following,
            event('assistant.delta', 1, { text: 'Partial' }),
            event('stream.error', null, { resumable: true, message: 'Lost.' }),
        );
        expect(interrupted.status).toBe('streaming');
        expect(interrupted.reconnecting).toBe(true);

        const resumed = runReducer(
            interrupted,
            event('assistant.delta', 2, { text: ' reply' }),
        );
        expect(resumed.reconnecting).toBe(false);
        expect(resumed.draft).toBe('Partial reply');
    });

    test('a final stream error or engine failure ends the reply with its message', () => {
        const relay = reduce(
            following,
            event('stream.error', null, {
                resumable: false,
                message: 'Broken.',
            }),
        );
        expect([relay.status, relay.error, relay.resumable]).toEqual([
            'failed',
            'Broken.',
            false,
        ]);

        const engine = reduce(
            following,
            event('run.failed', 1, {
                code: 'deadline_exceeded',
                message: 'Too slow.',
            }),
        );
        expect([engine.status, engine.error]).toEqual(['failed', 'Too slow.']);
        expect(engine.errorCode).toBe('deadline_exceeded');
        expect(needsConnectionFix(engine.errorCode)).toBe(false);
    });

    test('account failures carry their code so the page can link to Connections', () => {
        const started = reduce({
            type: 'failed',
            message: 'Connect it again.',
            resumable: false,
            code: 'connection_required',
        });
        expect(started.errorCode).toBe('connection_required');
        expect(needsConnectionFix(started.errorCode)).toBe(true);

        const engine = reduce(
            following,
            event('run.failed', 1, {
                code: 'reauth_required',
                message: 'Sign in again.',
            }),
        );
        expect(needsConnectionFix(engine.errorCode)).toBe(true);
        expect(needsConnectionFix(null)).toBe(false);

        // Following the same run again clears the old failure.
        expect(runReducer(engine, following).errorCode).toBeNull();
    });

    test('stopping waits for the engine to confirm the cancellation', () => {
        const stopping = reduce(
            following,
            event('assistant.delta', 1, { text: 'Part' }),
            { type: 'stopping' },
        );
        expect(stopping.status).toBe('stopping');

        const cancelled = runReducer(stopping, event('run.cancelled', 2));
        expect([cancelled.status, cancelled.draft]).toEqual([
            'cancelled',
            'Part',
        ]);

        const kept = runReducer(stopping, {
            type: 'stopFailed',
            message: 'Could not stop.',
        });
        expect([kept.status, kept.error]).toEqual([
            'streaming',
            'Could not stop.',
        ]);
    });

    test('a late Stop cannot reopen a completed reply', () => {
        const completed = reduce(
            following,
            event('assistant.final', 1, { text: 'Done.' }),
            event('run.completed', 2),
        );
        expect(runReducer(completed, { type: 'stopping' })).toBe(completed);
    });

    test('following the same run again keeps its draft; a new run starts empty', () => {
        const partial = reduce(
            following,
            event('assistant.delta', 1, { text: 'Kept' }),
            {
                type: 'failed',
                message: 'Closed.',
                resumable: true,
            },
        );

        expect(runReducer(partial, following).draft).toBe('Kept');
        expect(
            runReducer(partial, {
                type: 'following',
                run: { ...run, id: 'other' },
            }).draft,
        ).toBe('');
    });
});
