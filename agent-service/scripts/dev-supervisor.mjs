// Development only: keeps the engine answering. `tsx watch` restarts it after a code change, but
// after a crash it waits for the next change. On 25 October a file that briefly disappeared
// during a Git operation left the engine down for 21 hours with the container still "up".
// This runs `tsx watch` and starts it again when it exits or the health endpoint stops answering.
import { spawn } from 'node:child_process';

const HEALTH_URL = `http://127.0.0.1:${process.env.PORT ?? 3101}/internal/health`;
const CHECK_EVERY_MS = 10_000;
/** Long enough for a normal restart after a code change, short enough that nobody waits long. */
const RESTART_AFTER_MS = 45_000;
const STOP_GRACE_MS = 5_000;

let child = null;
let lastAnswer = Date.now();
let stopping = false;

const log = (message) => console.warn(`[engine supervisor] ${message}`);

function start() {
    lastAnswer = Date.now();
    // Its own process group, so stopping it also stops the engine process tsx runs.
    child = spawn('node_modules/.bin/tsx', ['watch', '--clear-screen=false', 'src/index.ts'], { stdio: 'inherit', detached: true });
    child.on('exit', (code, signal) => {
        child = null;
        if (stopping) {
            process.exit(0);
        }
        log(`the engine watcher exited (${signal ?? `code ${code}`}); starting it again`);
        setTimeout(start, 1_000);
    });
}

function stopGroup(signal) {
    if (child === null) {
        return;
    }
    const group = -child.pid;
    try {
        process.kill(group, signal);
    } catch {
        return;
    }
    setTimeout(() => {
        try {
            process.kill(group, 'SIGKILL');
        } catch {
            // Already gone.
        }
    }, STOP_GRACE_MS).unref();
}

setInterval(async () => {
    try {
        const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3_000) });
        if (response.ok) {
            lastAnswer = Date.now();
            return;
        }
    } catch {
        // Not answering; judged below.
    }
    if (child !== null && Date.now() - lastAnswer > RESTART_AFTER_MS) {
        log(`the engine has not answered for ${Math.round((Date.now() - lastAnswer) / 1000)} seconds; restarting it`);
        lastAnswer = Date.now();
        stopGroup('SIGTERM');
    }
}, CHECK_EVERY_MS);

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
        stopping = true;
        if (child === null) {
            process.exit(0);
        }
        stopGroup(signal);
    });
}

start();
