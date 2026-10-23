import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CredentialVault, UnreadableCredentialsError } from '../dist/auth/credential-vault.js';
import { installationId } from '../dist/auth/installation.js';

const credential = (access = 'secret-access-token') => ({
    type: 'oauth',
    access,
    refresh: 'secret-refresh-token',
    expires: 1_792_717_200_000,
    clientId: 'issued-client',
    scopes: ['chatgpt.tokens.use.direct'],
});

const directory = () => mkdtemp(join(tmpdir(), 'vault-'));

test('a stored credential round-trips but is encrypted and private on disk', async () => {
    const dir = await directory();
    const id = randomUUID();
    const vault = new CredentialVault(dir, id, randomBytes(32));

    assert.equal(await vault.read('openai'), undefined);
    assert.deepEqual(await vault.modify('openai', async () => credential()), credential());
    assert.deepEqual(await vault.read('openai'), credential());
    assert.deepEqual(await vault.list(), [{ providerId: 'openai', type: 'oauth' }]);

    const path = join(dir, `${id}.json.enc`);
    const raw = await readFile(path, 'utf8');
    assert.ok(!raw.includes('secret'), 'tokens must not appear in plain text');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(dir), [`${id}.json.enc`], 'no temporary files remain');

    await vault.delete('openai');
    assert.equal(await vault.read('openai'), undefined);
    assert.deepEqual(await readdir(dir), []);
});

test('a file moved to another connection or read with another key is unreadable', async () => {
    const dir = await directory();
    const key = randomBytes(32);
    const [first, second] = [randomUUID(), randomUUID()];
    await new CredentialVault(dir, first, key).modify('openai', async () => credential());

    // The connection ID is authenticated with the data, so a swapped file fails decryption.
    await copyFile(join(dir, `${first}.json.enc`), join(dir, `${second}.json.enc`));
    await assert.rejects(new CredentialVault(dir, second, key).read('openai'), UnreadableCredentialsError);

    const rotated = new CredentialVault(dir, first, randomBytes(32));
    await assert.rejects(rotated.read('openai'), UnreadableCredentialsError);
    await assert.rejects(rotated.list(), UnreadableCredentialsError);

    // A new sign-in replaces the unreadable file; a logout removes one.
    assert.deepEqual(await rotated.modify('openai', async (current) => (current === undefined ? credential('new') : current)), credential('new'));
    assert.deepEqual(await rotated.read('openai'), credential('new'));
    await new CredentialVault(dir, second, key).delete('openai');
    assert.deepEqual(await readdir(dir), [`${first}.json.enc`]);
});

test('writes are serialized, so a read-modify-write never sees a stale credential', async () => {
    const vault = new CredentialVault(await directory(), randomUUID(), randomBytes(32));
    await vault.modify('openai', async () => credential('0'));

    const increments = Array.from({ length: 5 }, () =>
        vault.modify('openai', async (current) => {
            await new Promise((resolve) => setTimeout(resolve, 2));

            return credential(String(Number(current.access) + 1));
        }),
    );
    await Promise.all(increments);
    assert.equal((await vault.read('openai')).access, '5');
});

test('a failed write leaves the stored credential unchanged and later writes still run', async () => {
    const vault = new CredentialVault(await directory(), randomUUID(), randomBytes(32));
    await vault.modify('openai', async () => credential('kept'));

    await assert.rejects(vault.modify('openai', async () => {
        throw new Error('refresh failed');
    }), /refresh failed/);
    assert.equal((await vault.read('openai')).access, 'kept');
    assert.equal((await vault.modify('openai', async () => credential('next'))).access, 'next');
});

test('the installation ID is a stable private UUID shared by concurrent first calls', async () => {
    const dir = join(await directory(), 'nested');
    const ids = await Promise.all([installationId(dir), installationId(dir), installationId(dir)]);

    assert.match(ids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(new Set(ids).size, 1);
    assert.equal(await installationId(dir), ids[0]);
    assert.equal((await stat(join(dir, 'installation-id'))).mode & 0o777, 0o600);
});
