import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Why a provider refused to renew a stored sign-in. Non-secret; shown to the connection's owner. */
export interface RenewalRejection {
    /** The provider's reason code, such as `refresh_token_invalidated`, or `refused` when it gave none. */
    reason: string;
    message: string;
    /** Unix milliseconds. */
    at: number;
}

/** More entries than Laravel can have connections is a sign of misuse; the oldest are dropped. */
const MAX_ENTRIES = 1_000;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Sign-ins whose renewal the provider refused. The credential stays stored until a new sign-in
 * replaces it, so without this record its status would read as connected again after a restart.
 * The file in the private data volume holds connection IDs, reason codes and times, never a secret.
 */
export class RenewalRejections {
    private entries: Promise<Map<string, RenewalRejection>> | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly directory: string,
        private readonly log: (message: string) => void,
    ) {}

    async get(key: string): Promise<RenewalRejection | null> {
        return (await this.load()).get(key) ?? null;
    }

    set(key: string, rejection: RenewalRejection): Promise<void> {
        return this.change((entries) => {
            entries.delete(key);
            entries.set(key, rejection);
            for (const oldest of entries.keys()) {
                if (entries.size <= MAX_ENTRIES) {
                    break;
                }
                entries.delete(oldest);
            }

            return true;
        });
    }

    delete(key: string): Promise<void> {
        return this.change((entries) => entries.delete(key));
    }

    /** Applies a change in memory at once, then writes the file; writes never interleave. */
    private change(apply: (entries: Map<string, RenewalRejection>) => boolean): Promise<void> {
        const run = this.queue.then(async () => {
            const entries = await this.load();
            if (apply(entries)) {
                await this.save(entries);
            }
        });
        this.queue = run.catch(() => undefined);

        return run;
    }

    private path(): string {
        return join(this.directory, 'renewal-rejections.json');
    }

    private load(): Promise<Map<string, RenewalRejection>> {
        this.entries ??= readFile(this.path(), 'utf8').then(
            (raw) => parse(raw, (problem) => this.log(`Ignoring ${this.path()}: ${problem}`)),
            (error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') {
                    this.log(`Ignoring ${this.path()}: ${error.message}`);
                }

                return new Map<string, RenewalRejection>();
            },
        );

        return this.entries;
    }

    private async save(entries: Map<string, RenewalRejection>): Promise<void> {
        // A private temporary file, then a rename, so a crash never leaves half a file.
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.path()}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
        await rename(temporary, this.path());
    }
}

function parse(raw: string, report: (problem: string) => void): Map<string, RenewalRejection> {
    const entries = new Map<string, RenewalRejection>();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        report('not valid JSON');

        return entries;
    }

    for (const [key, value] of Object.entries(typeof data === 'object' && data !== null ? data : {})) {
        const entry = value as Partial<RenewalRejection>;
        if (typeof entry.reason === 'string' && REASON.test(entry.reason) && typeof entry.message === 'string' && Number.isInteger(entry.at)) {
            entries.set(key, { reason: entry.reason, message: entry.message, at: entry.at as number });
        }
    }

    return entries;
}
