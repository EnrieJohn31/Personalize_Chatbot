import { CONTRACT_VERSION, isTerminal, type RunEvent, type RunEventType } from '../contracts.js';

type Listener = (event: RunEvent) => void;

/**
 * Ordered, bounded events of one run. Subscribers receive events after the ones they have
 * already read; nothing is accepted after a terminal event. Process-local Stage A state:
 * Laravel's persisted event store (task 4.3) replaces it for durable replay.
 */
export class RunExecution {
    private readonly events: RunEvent[] = [];
    private readonly listeners = new Set<Listener>();
    private readonly controller = new AbortController();

    constructor(
        readonly runId: string,
        private readonly maxEvents: number,
    ) {}

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    get terminal(): boolean {
        const last = this.events.at(-1);

        return last !== undefined && isTerminal(last.type);
    }

    /** Appends an event and notifies subscribers; returns null once the run has ended. */
    emit(type: RunEventType, data: Record<string, unknown> = {}): RunEvent | null {
        if (this.terminal) {
            return null;
        }

        // Keep the final slot for a terminal event so a run can always report how it ended.
        if (this.events.length >= this.maxEvents - 1 && !isTerminal(type)) {
            return this.emit('run.failed', { code: 'event_limit_exceeded', message: 'The run produced too many events.' });
        }

        const event: RunEvent = {
            contractVersion: CONTRACT_VERSION,
            runId: this.runId,
            sequence: this.events.length + 1,
            type,
            data,
        };
        this.events.push(event);

        for (const listener of this.listeners) {
            listener(event);
        }
        if (isTerminal(type)) {
            this.listeners.clear();
        }

        return event;
    }

    after(sequence: number): RunEvent[] {
        return this.events.slice(Math.max(0, sequence));
    }

    subscribe(listener: Listener): () => void {
        if (this.terminal) {
            return () => {};
        }

        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    /** Requests a stop; the running work decides when to emit `run.cancelled`. */
    cancel(): void {
        this.controller.abort();
    }
}
