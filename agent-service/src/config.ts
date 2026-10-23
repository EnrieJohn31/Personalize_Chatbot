export const MIN_SIGNING_KEY_LENGTH = 32;

export interface ServerConfig {
    /** Key Laravel signs engine requests with; null keeps run endpoints closed. */
    requestSigningKey: string | null;
    /** Admit the deterministic `simulated` provider. Enable only for development and tests. */
    simulationEnabled: boolean;
    /** Pause between simulated text chunks, so streaming is visible in development. */
    simulationChunkDelayMs: number;
    maxRequestBytes: number;
    maxTrackedRuns: number;
    trackedRunTtlMs: number;
    /** Upper bound on retained events per run, including the terminal event. */
    maxEventsPerRun: number;
    /** Blank NDJSON lines keep an idle event stream's read timeout from expiring. */
    streamHeartbeatMs: number;
    signatureToleranceSeconds: number;
    now: () => number;
    log: (message: string) => void;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    const key = env.AGENT_REQUEST_SIGNING_KEY?.trim() ?? '';
    if (key !== '' && key.length < MIN_SIGNING_KEY_LENGTH) {
        throw new Error(`AGENT_REQUEST_SIGNING_KEY must be at least ${MIN_SIGNING_KEY_LENGTH} characters.`);
    }

    const chunkDelay = Number(env.AGENT_SIMULATION_CHUNK_DELAY_MS ?? 35);
    if (!Number.isInteger(chunkDelay) || chunkDelay < 0 || chunkDelay > 1000) {
        throw new Error('AGENT_SIMULATION_CHUNK_DELAY_MS must be an integer from 0 to 1000.');
    }

    return {
        requestSigningKey: key === '' ? null : key,
        simulationEnabled: env.AGENT_SIMULATION_ENABLED === 'true',
        simulationChunkDelayMs: chunkDelay,
        maxRequestBytes: 1_048_576,
        maxTrackedRuns: 256,
        // Longer than Laravel's queue deadline plus run deadline, so a resubmission stays idempotent.
        trackedRunTtlMs: 15 * 60_000,
        maxEventsPerRun: 2_000,
        streamHeartbeatMs: 15_000,
        signatureToleranceSeconds: 60,
        now: Date.now,
        log: (message) => console.warn(message),
    };
}
