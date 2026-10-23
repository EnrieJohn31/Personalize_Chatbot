import { RunExecution } from './run-execution.js';

export type TrackedStatus = 'accepted' | 'cancel_requested';

export type Admission =
    | { outcome: 'accepted'; status: TrackedStatus; execution: RunExecution }
    | { outcome: 'duplicate'; status: TrackedStatus }
    | { outcome: 'conflict' }
    | { outcome: 'full' };

interface TrackedRun {
    fingerprint: string;
    status: TrackedStatus;
    trackedAt: number;
    execution: RunExecution;
}

/**
 * Stage A admission memory. It makes resubmitting the same run idempotent, rejects a
 * conflicting reuse of a run ID, keeps each run's events for replay and stays bounded. It is
 * process-local and lost on restart; Laravel's durable claim and event store (tasks 4.2–4.3)
 * become the authority once runs are persisted.
 */
export class RunRegistry {
    private readonly runs = new Map<string, TrackedRun>();

    constructor(
        private readonly capacity: number,
        private readonly ttlMs: number,
        private readonly now: () => number,
        private readonly maxEventsPerRun: number,
    ) {}

    admit(runId: string, fingerprint: string): Admission {
        this.prune();
        const existing = this.runs.get(runId);
        if (existing !== undefined) {
            return existing.fingerprint === fingerprint
                ? { outcome: 'duplicate', status: existing.status }
                : { outcome: 'conflict' };
        }
        if (this.runs.size >= this.capacity) {
            return { outcome: 'full' };
        }

        const execution = new RunExecution(runId, this.maxEventsPerRun);
        this.runs.set(runId, { fingerprint, status: 'accepted', trackedAt: this.now(), execution });

        return { outcome: 'accepted', status: 'accepted', execution };
    }

    execution(runId: string): RunExecution | null {
        this.prune();

        return this.runs.get(runId)?.execution ?? null;
    }

    /** Returns null for an unknown run, otherwise whether cancellation was already requested. */
    requestCancel(runId: string): { duplicate: boolean } | null {
        this.prune();
        const run = this.runs.get(runId);
        if (run === undefined) {
            return null;
        }

        const duplicate = run.status === 'cancel_requested';
        run.status = 'cancel_requested';
        run.execution.cancel();

        return { duplicate };
    }

    private prune(): void {
        const cutoff = this.now() - this.ttlMs;
        // Insertion order is admission order, so the oldest entries come first.
        for (const [runId, run] of this.runs) {
            if (run.trackedAt > cutoff) {
                return;
            }
            run.execution.cancel();
            this.runs.delete(runId);
        }
    }
}
