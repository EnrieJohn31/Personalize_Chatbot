// Reply state for one run, kept free of React so it can be unit tested.

import type { ChatRun, ProgressStage, RunEventType } from '@/types';

export type RunStatus =
    | 'idle'
    | 'starting'
    | 'streaming'
    | 'stopping'
    | 'completed'
    | 'cancelled'
    | 'failed';

export type RunState = {
    status: RunStatus;
    run: ChatRun | null;
    /** Accumulated deltas, replaced by the final text when it arrives. */
    draft: string;
    stage: ProgressStage | null;
    /** Highest engine event sequence applied; replayed events at or below it are ignored. */
    lastSequence: number;
    /** True while the browser is reconnecting after a resumable stream error. */
    reconnecting: boolean;
    error: string | null;
    /** Whether following the same run again can still succeed. */
    resumable: boolean;
};

export type RunStreamEvent = {
    type: RunEventType;
    /** The SSE id for engine events; null for the relay's own `stream.error`. */
    sequence: number | null;
    data: Record<string, unknown>;
};

export type RunAction =
    | { type: 'starting' }
    | { type: 'following'; run: ChatRun }
    | { type: 'event'; event: RunStreamEvent }
    | { type: 'stopping' }
    | { type: 'stopFailed'; message: string }
    | { type: 'failed'; message: string; resumable: boolean };

export const initialRunState: RunState = {
    status: 'idle',
    run: null,
    draft: '',
    stage: null,
    lastSequence: 0,
    reconnecting: false,
    error: null,
    resumable: false,
};

export const TERMINAL_EVENTS: readonly RunEventType[] = [
    'run.completed',
    'run.failed',
    'run.cancelled',
];

export function isResponding(status: RunStatus): boolean {
    return (
        status === 'starting' || status === 'streaming' || status === 'stopping'
    );
}

const text = (data: Record<string, unknown>): string =>
    typeof data.text === 'string' ? data.text : '';

export function runReducer(state: RunState, action: RunAction): RunState {
    switch (action.type) {
        case 'starting':
            return { ...initialRunState, status: 'starting' };
        case 'following':
            // A different run starts from scratch; the same run keeps what it already shows.
            return action.run.id === state.run?.id
                ? {
                      ...state,
                      status: 'streaming',
                      error: null,
                      resumable: false,
                  }
                : { ...initialRunState, status: 'streaming', run: action.run };
        case 'stopping':
            return isResponding(state.status)
                ? { ...state, status: 'stopping' }
                : state;
        case 'stopFailed':
            return state.status === 'stopping'
                ? { ...state, status: 'streaming', error: action.message }
                : state;
        case 'failed':
            return {
                ...state,
                status: 'failed',
                reconnecting: false,
                error: action.message,
                resumable: action.resumable,
            };
        case 'event':
            return applyEvent(state, action.event);
    }
}

function applyEvent(state: RunState, event: RunStreamEvent): RunState {
    if (event.type === 'stream.error') {
        const resumable = event.data.resumable === true;
        const message =
            typeof event.data.message === 'string'
                ? event.data.message
                : 'The reply stream was interrupted.';

        return resumable
            ? { ...state, reconnecting: true }
            : { ...state, status: 'failed', error: message, resumable: false };
    }

    // EventSource replays events after reconnecting; apply each sequence once.
    if (event.sequence !== null && event.sequence <= state.lastSequence) {
        return state;
    }

    const next: RunState = {
        ...state,
        lastSequence: event.sequence ?? state.lastSequence,
        reconnecting: false,
    };

    switch (event.type) {
        case 'run.progress':
            return { ...next, stage: event.data.stage as ProgressStage };
        case 'assistant.delta':
            return {
                ...next,
                draft: state.draft + text(event.data),
                stage: 'answering',
            };
        case 'assistant.final':
            // The final text replaces the draft; it is never appended to it.
            return { ...next, draft: text(event.data) };
        case 'run.completed':
            return { ...next, status: 'completed', error: null };
        case 'run.cancelled':
            return { ...next, status: 'cancelled', error: null };
        case 'run.failed':
            return {
                ...next,
                status: 'failed',
                error:
                    typeof event.data.message === 'string'
                        ? event.data.message
                        : 'The reply could not be completed.',
                resumable: false,
            };
        default:
            return next;
    }
}
