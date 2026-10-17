import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileStorage } from '../../src/server/index.mjs';
import { cleanup, tmpDir } from '../helpers.mjs';

const rep = (id, over = {}) => ({ id, status: 'open', note: '', createdAt: new Date().toISOString(), reporter: 'r', description: 'd', types: [], context: {}, files: {}, ...over });
const files = { region: Buffer.from('a'), full: Buffer.from('b') };

test('file storage: create/get/list/update/readFile', async () => {
  const dir = await tmpDir(); const s = createFileStorage({ dir });
  await s.create(rep('bug-20260101-000001-aaaa', { createdAt: '2026-01-01T00:00:01Z' }), files);
  await s.create(rep('bug-20260101-000002-bbbb', { createdAt: '2026-01-01T00:00:02Z' }), files);
  assert.deepEqual((await s.list()).map(r => r.id), ['bug-20260101-000002-bbbb', 'bug-20260101-000001-aaaa']);
  const up = await s.update('bug-20260101-000001-aaaa', { status: 'fixed', note: 'n' });
  assert.equal(up.status, 'fixed'); assert.equal((await s.get('bug-20260101-000001-aaaa')).note, 'n');
  assert.equal((await s.readFile('bug-20260101-000001-aaaa', 'full.png')).toString(), 'b');
  assert.equal(await s.readFile('bug-20260101-000001-aaaa', 'report.json'), null);
  await assert.rejects(() => s.update('bug-20260101-000001-aaaa', { status: 'nonsense' }));
  assert.equal(await s.update('bug-20260101-000009-cccc', { status: 'fixed' }), null);
  await assert.rejects(() => s.create(rep('bug-20260101-000001-aaaa'), files), e => e.code === 'EXISTS');
  await cleanup(dir);
});

test('file storage: refuses ids that are not exact report ids and leaves no tmp files', async () => {
  const dir = await tmpDir(); const s = createFileStorage({ dir });
  for (const bad of ['../evil', '/etc/passwd', 'bug-1', 'bug-20260101-000001-AAAA', '']) {
    assert.equal(await s.get(bad), null, bad); assert.equal(await s.readFile(bad, 'full.png'), null);
    assert.equal(await s.update(bad, { status: 'fixed' }), null);
    await assert.rejects(() => s.create(rep(bad), files));
  }
  await s.create(rep('bug-20260101-000001-aaaa'), files);
  await s.update('bug-20260101-000001-aaaa', { note: 'x' });
  assert.deepEqual((await readdir(join(dir, 'bug-20260101-000001-aaaa'))).sort(), ['full.png', 'region.png', 'report.json']);
  await cleanup(dir);
});

test('file storage: ignores stray folders and corrupt report.json', async () => {
  const dir = await tmpDir(); const s = createFileStorage({ dir });
  await mkdir(join(dir, 'random-folder')); await mkdir(join(dir, 'bug-20260101-000003-cccc')); await writeFile(join(dir, 'bug-20260101-000003-cccc', 'report.json'), '{broken');
  await s.create(rep('bug-20260101-000001-aaaa'), files);
  assert.equal((await s.list()).length, 1);
  await cleanup(dir);
});
