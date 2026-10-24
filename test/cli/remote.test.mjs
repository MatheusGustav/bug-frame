import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { remoteCommand, remoteCredentials } from '../../src/cli/remote.mjs';
import { cleanup, tmpDir } from '../helpers.mjs';

const id = 'bug-20261023-050010-8b34';
const config = { endpoint: 'https://example.test/api/bugframe', token: 'private-test-credential' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('remote list/show/status commands use the same hosted API, never a local folder', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('?all=1')) return json({ reports: [{ id, status: 'open', description: 'Wrong total', context: {} }] });
    if (options.method === 'PATCH') return json({ id, ...JSON.parse(options.body) });
    return json({ id, description: 'Wrong total', files: { region: 'region.png', full: 'full.png' } });
  };
  const options = { ...config, fetch: request };
  assert.match(await remoteCommand('list', undefined, options), /Wrong total/);
  const shown = JSON.parse(await remoteCommand('show', id, options));
  assert.equal(shown.images.region, `${config.endpoint}/reports/${id}/region.png`);
  assert.match(await remoteCommand('close', id, { ...options, note: 'Deployed and verified' }), /marked fixed/);
  assert.match(await remoteCommand('reopen', id, options), /reopened/);
  assert.match(await remoteCommand('ready', id, { ...options, note: 'Please check the deployed update' }), /ready for customer review/);
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'ready_for_review', note: 'Please check the deployed update' });
  for (const { url, options } of calls) {
    assert.ok(url.startsWith(config.endpoint)); assert.equal(options.headers.authorization, 'Bearer private-test-credential');
    assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
  }
  assert.deepEqual(JSON.parse(calls[2].options.body), { status: 'fixed', note: 'Deployed and verified' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { status: 'open', note: '' });
});

test('remote validation refuses insecure URLs, invalid ids, missing fix notes and unsupported operations', async () => {
  let called = false;
  const options = { ...config, fetch: async () => { called = true; return json({}); } };
  for (const endpoint of ['http://example.test/api', 'https://user:secret@example.test/api', 'https://example.test/?key=x', 'https://example.test/#x', 'garbage']) {
    await assert.rejects(() => remoteCommand('list', undefined, { ...options, endpoint }), /HTTPS/);
  }
  await assert.rejects(() => remoteCommand('show', '../secret', options), /valid report id/);
  await assert.rejects(() => remoteCommand('ready', id, options), /requires --note/);
  await assert.rejects(() => remoteCommand('close', id, options), /requires --note/);
  await assert.rejects(() => remoteCommand('export', undefined, options), /supports list/);
  await assert.rejects(() => remoteCommand('list', undefined, { ...options, timeoutMs: NaN }), /timeout/);
  assert.equal(called, false);
});

test('remote redirects, unauthorized responses and network errors do not echo credentials', async () => {
  for (const status of [301, 302, 307, 308, 401, 403, 413, 429, 500]) {
    let calls = 0;
    await assert.rejects(() => remoteCommand('list', undefined, { ...config, fetch: async () => { calls++; return json({ message: config.token }, status); } }), error => {
      assert.doesNotMatch(error.message, /private-test-credential/); return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(() => remoteCommand('list', undefined, { ...config, fetch: async () => { throw new Error(config.token); } }), /Remote request failed/);
});

test('remote timeout aborts stalled requests and enforces a bounded response', async () => {
  await assert.rejects(() => remoteCommand('list', undefined, { ...config, timeoutMs: 10, fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }), /timed out/);
  await assert.rejects(() => remoteCommand('list', undefined, { ...config, fetch: async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)) }), /8 MB/);
});

test('credential files are private, environment credentials take precedence, and malformed files fail safely', async () => {
  const dir = await tmpDir(); const file = join(dir, 'credentials.json');
  try {
    await writeFile(file, JSON.stringify({ adminToken: 'file-token' }), { mode: 0o600 });
    assert.equal(await remoteCredentials(file, {}), 'file-token');
    assert.equal(await remoteCredentials(file, { BUGFRAME_ADMIN_TOKEN: 'env-token' }), 'env-token');
    if (process.platform !== 'win32') {
      await chmod(file, 0o644); await assert.rejects(() => remoteCredentials(file, {}), /private/); await chmod(file, 0o600);
    }
    await writeFile(file, '{bad json'); await assert.rejects(() => remoteCredentials(file, {}), /Could not read/);
    await assert.rejects(() => remoteCredentials(file + '-missing', {}), /Could not read/);
  } finally { await cleanup(dir); }
});

test('remote CLI protocol works end-to-end over verified HTTPS without following redirects', async () => {
  const { createServer } = await import('node:https');
  const { execFile, execFileSync } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  const { createBugframe, createMemoryStorage, toNodeListener } = await import('../../src/server/index.mjs');
  const { body, post } = await import('../helpers.mjs');
  const dir = await tmpDir(), key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  let server;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const token = 'https-fixture-secret';
    const bf = createBugframe({ storage: createMemoryStorage(), basePath: '/api/bugframe', adminToken: token });
    const report = await (await bf.handle(post('https://fixture.test/api/bugframe/reports', body(), { authorization: `Bearer ${token}` }))).json();
    const listener = toNodeListener(bf); let followed = false;
    server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
      if (req.url.startsWith('/redirect/')) { res.writeHead(302, { location: '/stolen' }); return res.end(); }
      if (req.url === '/stolen') { followed = true; res.end('{}'); return; }
      if (req.url.startsWith('/stall/')) return;
      listener(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const host = `https://127.0.0.1:${server.address().port}`;
    const bin = new URL('../../src/cli/bin.mjs', import.meta.url).pathname;
    const run = (endpoint, ...args) => promisify(execFile)(process.execPath, [bin, '--remote', endpoint, ...args], { env: { ...process.env, BUGFRAME_ADMIN_TOKEN: token, BUGFRAME_CREDENTIALS_FILE: '', NODE_EXTRA_CA_CERTS: cert } });
    const api = host + '/api/bugframe';
    assert.equal(JSON.parse((await run(api, 'list', '--json')).stdout)[0].id, report.id);
    assert.equal(JSON.parse((await run(api, 'show', report.id)).stdout).id, report.id);
    assert.match((await run(api, 'close', report.id, '--note', 'Deployed and verified')).stdout, /marked fixed/);
    assert.equal((await bf.storage.get(report.id)).status, 'fixed');
    assert.match((await run(api, 'reopen', report.id)).stdout, /reopened/);
    await assert.rejects(() => run(host + '/redirect', 'list'), error => /redirects are refused/.test(error.stderr));
    assert.equal(followed, false);
    await assert.rejects(() => run(host + '/stall', '--timeout', '20', 'list'), error => /timed out/.test(error.stderr));
  } finally { server?.close(); server?.closeAllConnections(); await cleanup(dir); }
});
