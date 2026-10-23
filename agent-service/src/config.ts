export const MIN_SIGNING_KEY_LENGTH = 32;

export interface ServerConfig {
    /** Key Laravel signs engine requests with; null keeps run endpoints closed. */
    requestSigningKey: string | null;
    /** Admit the deterministic `simulated` provider. Enable only for development and tests. */
    simulationEnabled: boolean;
    maxRequestBytes: number;
    maxTrackedRuns: number;
    trackedRunTtlMs: number;
    signatureToleranceSeconds: number;
    now: () => number;
    log: (message: string) => void;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    const key = env.AGENT_REQUEST_SIGNING_KEY?.trim() ?? '';
    if (key !== '' && key.length < MIN_SIGNING_KEY_LENGTH) {
        throw new Error(`AGENT_REQUEST_SIGNING_KEY must be at least ${MIN_SIGNING_KEY_LENGTH} characters.`);
    }

    return {
        requestSigningKey: key === '' ? null : key,
        simulationEnabled: env.AGENT_SIMULATION_ENABLED === 'true',
        maxRequestBytes: 1_048_576,
        maxTrackedRuns: 256,
        // Longer than Laravel's queue deadline plus run deadline, so a resubmission stays idempotent.
        trackedRunTtlMs: 15 * 60_000,
        signatureToleranceSeconds: 60,
        now: Date.now,
        log: (message) => console.warn(message),
    };
}
