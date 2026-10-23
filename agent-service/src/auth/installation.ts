import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The stable ID of this engine installation. OpenAI's Sign in with ChatGPT registers it as the
 * agent host, so it must survive restarts; it lives in the engine's private volume.
 */
export async function installationId(directory: string): Promise<string> {
    const path = join(directory, 'installation-id');

    const existing = await readId(path);
    if (existing !== null) {
        return existing;
    }

    // Write a complete private file, then link it into place: the link fails if another caller
    // created the ID first, theirs then wins, and no reader ever sees a partly written file.
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${randomUUID()}\n`, { mode: 0o600 });
    try {
        await link(temporary, path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    } finally {
        await rm(temporary, { force: true });
    }

    const created = await readId(path);
    if (created === null) {
        throw new Error(`The installation ID file at ${path} is not a UUID.`);
    }

    return created;
}

async function readId(path: string): Promise<string | null> {
    try {
        const value = (await readFile(path, 'utf8')).trim().toLowerCase();

        return UUID.test(value) ? value : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
