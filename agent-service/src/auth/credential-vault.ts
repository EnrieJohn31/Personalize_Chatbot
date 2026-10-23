import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';

interface Envelope {
    version: 1;
    iv: string;
    tag: string;
    data: string;
}

/** The stored file exists but cannot be decrypted, for example after AGENT_CREDENTIAL_KEY changed. */
export class UnreadableCredentialsError extends Error {}

/**
 * Pi credential store for one Laravel provider connection: one encrypted file per connection
 * (AES-256-GCM, authenticated with the connection ID so files cannot be swapped). Writes are
 * serialized, so Pi's locked OAuth refresh never interleaves with a login or logout. A file that
 * cannot be decrypted fails reads; a new sign-in replaces it and a logout removes it.
 */
export class CredentialVault implements CredentialStore {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly directory: string,
        private readonly connectionId: string,
        private readonly key: Buffer,
    ) {}

    async read(providerId: string): Promise<Credential | undefined> {
        return (await this.load())[providerId];
    }

    async list(): Promise<readonly CredentialInfo[]> {
        return Object.entries(await this.load()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
    }

    modify(
        providerId: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    ): Promise<Credential | undefined> {
        return this.serialize(async () => {
            const credentials = await this.load().catch(replaceUnreadable);
            const next = await fn(credentials[providerId]);

            if (next !== undefined) {
                credentials[providerId] = next;
                await this.save(credentials);
            }

            return credentials[providerId];
        });
    }

    delete(providerId: string): Promise<void> {
        return this.serialize(async () => {
            const credentials = await this.load().catch(replaceUnreadable);
            delete credentials[providerId];

            if (Object.keys(credentials).length === 0) {
                await rm(this.path(), { force: true });
            } else {
                await this.save(credentials);
            }
        });
    }

    private serialize<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work);
        this.queue = run.catch(() => undefined);

        return run;
    }

    private path(): string {
        return join(this.directory, `${this.connectionId}.json.enc`);
    }

    private additionalData(): Buffer {
        return Buffer.from(`assistant-foundation:credentials:${this.connectionId}`);
    }

    private async load(): Promise<Record<string, Credential>> {
        let raw: string;
        try {
            raw = await readFile(this.path(), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {};
            }
            throw error;
        }

        try {
            const envelope = JSON.parse(raw) as Envelope;
            const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
            decipher.setAAD(this.additionalData());
            decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);

            return JSON.parse(plain.toString('utf8')) as Record<string, Credential>;
        } catch (error) {
            throw new UnreadableCredentialsError(`The stored credentials of connection ${this.connectionId} cannot be decrypted.`, {
                cause: error,
            });
        }
    }

    private async save(credentials: Record<string, Credential>): Promise<void> {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(this.additionalData());
        const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
        const envelope: Envelope = {
            version: 1,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            data: data.toString('base64'),
        };

        // Write a private temporary file, then rename it, so a crash never leaves half a credential.
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.path()}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 });
        await rename(temporary, this.path());
    }
}

/** Writes start from an empty set when the old file is unreadable; nothing in it can be recovered. */
function replaceUnreadable(error: unknown): Record<string, Credential> {
    if (error instanceof UnreadableCredentialsError) {
        return {};
    }
    throw error;
}
