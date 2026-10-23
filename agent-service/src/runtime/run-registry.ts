export type TrackedStatus = 'accepted' | 'cancel_requested';

export type Admission =
    | { outcome: 'accepted' | 'duplicate'; status: TrackedStatus }
    | { outcome: 'conflict' }
    | { outcome: 'full' };

interface TrackedRun {
    fingerprint: string;
    status: TrackedStatus;
    trackedAt: number;
}

/**
 * Stage A admission memory. It makes resubmitting the same run idempotent, rejects a
 * conflicting reuse of a run ID and stays bounded. It is process-local and lost on restart;
 * Laravel's durable claim (task 4.2) becomes the authority once runs are persisted.
 */
export class RunRegistry {
    private readonly runs = new Map<string, TrackedRun>();

    constructor(
        private readonly capacity: number,
        private readonly ttlMs: number,
        private readonly now: () => number,
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

        this.runs.set(runId, { fingerprint, status: 'accepted', trackedAt: this.now() });

        return { outcome: 'accepted', status: 'accepted' };
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

        return { duplicate };
    }

    private prune(): void {
        const cutoff = this.now() - this.ttlMs;
        // Insertion order is admission order, so the oldest entries come first.
        for (const [runId, run] of this.runs) {
            if (run.trackedAt > cutoff) {
                return;
            }
            this.runs.delete(runId);
        }
    }
}
