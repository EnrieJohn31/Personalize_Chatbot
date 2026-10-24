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
    /** The failure's code, for example `reauth_required`, so the page can offer the right next step. */
    errorCode: string | null;
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
    | {
          type: 'failed';
          message: string;
          resumable: boolean;
          code?: string | null;
      };

export const initialRunState: RunState = {
    status: 'idle',
    run: null,
    draft: '',
    stage: null,
    lastSequence: 0,
    reconnecting: false,
    error: null,
    errorCode: null,
    resumable: false,
};

/** Failures that the user fixes on the Connections page rather than by retrying. */
export const CONNECTION_ERROR_CODES: readonly string[] = [
    'connection_required',
    'connection_not_ready',
    'not_connected',
    'reauth_required',
    'credentials_unreadable',
];

export const needsConnectionFix = (code: string | null): boolean =>
    code !== null && CONNECTION_ERROR_CODES.includes(code);

const code = (data: Record<string, unknown>): string | null =>
    typeof data.code === 'string' ? data.code : null;

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
                      errorCode: null,
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
                errorCode: action.code ?? null,
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
            : {
                  ...state,
                  status: 'failed',
                  error: message,
                  errorCode: code(event.data),
                  resumable: false,
              };
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
                errorCode: code(event.data),
                resumable: false,
            };
        default:
            return next;
    }
}
