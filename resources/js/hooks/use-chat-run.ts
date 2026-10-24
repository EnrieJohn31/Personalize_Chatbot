import { useEffect, useReducer, useRef } from 'react';
import { ChatApiError, startRun, stopRun } from '@/lib/chat-api';
import type { RunState } from '@/lib/chat-run-state';
import {
    TERMINAL_EVENTS,
    initialRunState,
    runReducer,
} from '@/lib/chat-run-state';
import type { ChatMessage, ChatRun, RunEventType } from '@/types';

const EVENT_TYPES: RunEventType[] = [
    'run.started',
    'run.progress',
    'assistant.delta',
    'assistant.final',
    'run.completed',
    'run.failed',
    'run.cancelled',
    'stream.error',
];

export type UseChatRunReturn = {
    state: RunState;
    /** Asks the server for a reply; resolves to the run, or null after reporting the failure. */
    start: (conversationId: string) => Promise<ChatRun | null>;
    /** Streams a run's events. The browser resumes with Last-Event-ID after dropped connections. */
    follow: (run: ChatRun) => void;
    stop: () => Promise<void>;
};

const errorMessage = (caught: unknown, fallback: string): string =>
    caught instanceof ChatApiError ? caught.message : fallback;

/** One reply at a time: admission, the EventSource stream, Stop and the final saved message. */
export function useChatRun(
    onCompleted: (message: ChatMessage) => void,
): UseChatRunReturn {
    const [state, dispatch] = useReducer(runReducer, initialRunState);
    const source = useRef<EventSource | null>(null);
    const completed = useRef(onCompleted);

    useEffect(() => {
        completed.current = onCompleted;
    });

    const close = (): void => {
        source.current?.close();
        source.current = null;
    };

    useEffect(
        () => () => {
            source.current?.close();
            source.current = null;
        },
        [],
    );

    const follow = (run: ChatRun): void => {
        close();
        dispatch({ type: 'following', run });

        const events = new EventSource(run.events_url);
        source.current = events;

        for (const type of EVENT_TYPES) {
            events.addEventListener(type, (message: MessageEvent<string>) => {
                const data = JSON.parse(message.data) as Record<
                    string,
                    unknown
                >;
                // stream.error has no id of its own; EventSource would repeat the previous one.
                const sequence =
                    type === 'stream.error' || message.lastEventId === ''
                        ? null
                        : Number(message.lastEventId);

                dispatch({ type: 'event', event: { type, sequence, data } });

                if (type === 'stream.error' && data.resumable !== true) {
                    close();
                }
                if (TERMINAL_EVENTS.includes(type)) {
                    close();
                    if (type === 'run.completed') {
                        completed.current(data.message as ChatMessage);
                    }
                }
            });
        }

        events.onerror = () => {
            // CONNECTING means the browser is already retrying; CLOSED means it gave up.
            if (
                events.readyState === EventSource.CLOSED &&
                source.current === events
            ) {
                close();
                dispatch({
                    type: 'failed',
                    message:
                        'The reply stream closed before the reply finished.',
                    resumable: true,
                });
            }
        };
    };

    const start = async (conversationId: string): Promise<ChatRun | null> => {
        close();
        dispatch({ type: 'starting' });

        try {
            return await startRun(conversationId);
        } catch (caught) {
            dispatch({
                type: 'failed',
                message: errorMessage(
                    caught,
                    'The reply could not be started.',
                ),
                resumable: false,
                code: caught instanceof ChatApiError ? caught.code : null,
            });

            return null;
        }
    };

    const stop = async (): Promise<void> => {
        if (state.run === null) {
            return;
        }

        dispatch({ type: 'stopping' });

        try {
            await stopRun(state.run.id);
        } catch (caught) {
            dispatch({
                type: 'stopFailed',
                message: errorMessage(
                    caught,
                    'The reply could not be stopped.',
                ),
            });
        }
    };

    return { state, start, follow, stop };
}
