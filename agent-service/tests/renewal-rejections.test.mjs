import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RenewalRejections } from '../dist/auth/renewal-rejections.js';

const valid = { reason: 'invalid_grant', message: 'Sign in again.', at: 1_792_713_600_000 };

test('malformed rejection entries are skipped without losing valid records or breaking later writes', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'rejections-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'renewal-rejections.json'), JSON.stringify({
        null_value: null,
        string_value: 'invalid',
        array_value: [],
        empty_message: { ...valid, message: '' },
        long_message: { ...valid, message: 'x'.repeat(501) },
        negative_time: { ...valid, at: -1 },
        extra_field: { ...valid, access: 'private' },
        valid,
    }));
    const store = new RenewalRejections(directory, () => {});

    assert.deepEqual(await store.get('valid'), valid);
    for (const key of ['null_value', 'string_value', 'array_value', 'empty_message', 'long_message', 'negative_time', 'extra_field']) {
        assert.equal(await store.get(key), null, key);
    }
    await store.set('later', valid);
    assert.deepEqual(await new RenewalRejections(directory, () => {}).get('later'), valid);
});

test('a non-object rejection file is ignored and oversized saved maps retain only the newest entries', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'rejections-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'renewal-rejections.json');
    await writeFile(path, JSON.stringify([valid]));
    assert.equal(await new RenewalRejections(directory, () => {}).get('0'), null);

    await writeFile(path, JSON.stringify(Object.fromEntries(Array.from({ length: 1002 }, (_, i) => [`entry_${i}`, valid]))));
    const store = new RenewalRejections(directory, () => {});
    assert.equal(await store.get('entry_0'), null);
    assert.equal(await store.get('entry_1'), null);
    assert.deepEqual(await store.get('entry_2'), valid);
    assert.deepEqual(await store.get('entry_1001'), valid);
});
