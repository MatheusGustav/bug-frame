import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBugframe } from '../../src/server/index.mjs';
import { body, cleanup, post, tmpDir } from '../helpers.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../src/cli/bin.mjs');
const run = (dir, ...args) => promisify(execFile)('node', [BIN, '--dir', dir, ...args]).then(r => r.stdout.trim(), e => { e.message = `${e.stderr}`; throw e; });
const seed = async dir => {
  const bf = createBugframe({ dir, rateLimit: false });
  const mk = async (description, url, extra = {}) => (await (await bf.handle(post('https://x.test/reports', body({ description, context: { ...body().context, url, ...extra } })))).json()).id;
  const a = await mk('Footer overlaps the button', 'https://app.test/settings#/billing');
  const b = await mk('Wrong total on invoice', 'https://app.test/invoices?id=4');
  const c = await mk('Another settings issue', 'https://app.test/settings#/billing');
  return { a, b, c };
};

test('list, show, export, close, reopen end to end', async () => {
  const dir = await tmpDir(); const { a, b, c } = await seed(dir);
  const listing = await run(dir, 'list');
  assert.match(listing, new RegExp(a)); assert.match(listing, /Wrong total on invoice/);
  assert.equal(JSON.parse(await run(dir, 'list', '--json')).length, 3);

  const shown = await run(dir, 'show', b);
  assert.match(shown, /Region picture:/); assert.match(shown, /Console errors/); assert.match(shown, /"version":"1.2.3"/);

  const out = await run(dir, 'export'); assert.match(out, /3 reports/);
  const md = await readFile(join(dir, 'WORKLIST.md'), 'utf8');
  assert.match(md, /3 open across 2 pages/); assert.match(md, /## \/settings#\/billing/); assert.match(md, /## \/invoices/);
  assert.match(md, new RegExp(`${a}/region\\.png`)); assert.doesNotMatch(md, /token=SECRET/);
  // picture paths in the worklist are relative to the worklist and must exist
  await access(join(dir, md.match(/`([^`]+region\.png)`/)[1]));

  assert.match(await run(dir, 'close', a, '--note', 'Moved the footer'), /fixed/);
  assert.match(await run(dir, 'close', b, '--note', 'Not reproducible', '--status', 'wontfix'), /wontfix/);
  assert.equal((await run(dir, 'list', '--open')).split('\n').length, 1);
  assert.match(await run(dir, 'show', a), /Note: Moved the footer/);
  await run(dir, 'export', '--out', join(dir, 'out/W.md'));
  assert.match(await readFile(join(dir, 'out/W.md'), 'utf8'), /1 open across 1 page/);
  assert.match(await run(dir, 'export', '--all', '--out', join(dir, 'ALL.md')), /3 reports/);
  assert.match(await run(dir, 'reopen', a), /reopened/);
  assert.equal((await run(dir, 'list', '--open')).split('\n').length, 2);
  void c; await cleanup(dir);
});

test('errors are plain and exit non-zero', async () => {
  const dir = await tmpDir();
  await assert.rejects(() => run(dir, 'close', 'bug-20260101-000000-aaaa', '--note', 'x'), /No report with id/);
  await assert.rejects(() => run(dir, 'close', 'bug-20260101-000000-aaaa'), /needs --note/);
  await assert.rejects(() => run(dir, 'show'), /needs an id/);
  await assert.rejects(() => run(dir, 'show', '../../etc/passwd'), /No report/);
  await assert.rejects(() => run(dir, 'bogus'), /Unknown command/);
  assert.equal(await run(dir, 'list'), 'No bug reports.');
  assert.match(await run(dir, 'export'), /No open bug reports/);
  assert.match(await run(dir, '--help'), /Usage: bugframe/);
  await cleanup(dir);
});
