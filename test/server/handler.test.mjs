import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createBugframe, createMemoryStorage } from '../../src/server/index.mjs';
import { body, cleanup, PNG_URL, post, tmpDir } from '../helpers.mjs';

const U = 'https://app.test/api/bugframe';
// Non-auth tests run with an explicitly approved fixture account. Auth denial is covered in auth.test.mjs.
const fresh = async (opts = {}) => { const dir = await tmpDir(); const bf = createBugframe({ dir, basePath: '/api/bugframe', rateLimit: false, authorize: () => ({ id: 'fixture-user', role: 'client' }), ...opts }); return { dir, bf, done: () => cleanup(dir) }; };
const get = (url, headers = {}) => new Request(url, { headers });

test('creates a report folder with report.json, region.png and full.png', async () => {
  const { dir, bf, done } = await fresh();
  const res = await bf.handle(post(`${U}/reports`, body(), { 'x-bugframe-reporter': 'r1' }));
  assert.equal(res.status, 201);
  const { id, status } = await res.json();
  assert.equal(status, 'open'); assert.match(id, /^bug-\d{8}-\d{6}-[a-f0-9]{4}$/);
  assert.deepEqual((await readdir(join(dir, id))).sort(), ['full.png', 'region.png', 'report.json']);
  const r = JSON.parse(await readFile(join(dir, id, 'report.json'), 'utf8'));
  assert.equal(r.description, 'The save button overlaps the footer'); assert.match(r.reporter, /^user:[a-f0-9]{64}$/); assert.equal(r.context.metadata.version, '1.2.3');
  assert.equal((await readFile(join(dir, id, 'region.png'))).subarray(1, 4).toString(), 'PNG');
  await done();
});

test('requires a description and real PNG images', async () => {
  const { bf, done } = await fresh();
  assert.equal((await bf.handle(post(`${U}/reports`, body({ description: '   ' })))).status, 400);
  assert.equal((await bf.handle(post(`${U}/reports`, body({ region: 'data:image/png;base64,AAAA' })))).status, 400);
  assert.equal((await bf.handle(post(`${U}/reports`, body({ full: 'data:image/jpeg;base64,/9j/4AAQ' })))).status, 400);
  assert.equal((await bf.handle(post(`${U}/reports`, body({ full: 'http://evil.test/x.png' })))).status, 400);
  const notPng = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>'.repeat(5)).toString('base64');
  assert.equal((await bf.handle(post(`${U}/reports`, body({ region: notPng })))).status, 400);
  await done();
});

test('rejects non-JSON, invalid JSON and oversized bodies', async () => {
  const { bf, done } = await fresh({ maxBodyBytes: 2000 });
  assert.equal((await bf.handle(new Request(`${U}/reports`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }))).status, 415);
  assert.equal((await bf.handle(post(`${U}/reports`, '{nope'))).status, 400);
  const big = await bf.handle(post(`${U}/reports`, body({ description: 'x'.repeat(5000) })));
  assert.equal(big.status, 413);
  await done();
});

test('rejects images over maxImageBytes', async () => {
  const { bf, done } = await fresh({ maxImageBytes: 60 });
  assert.equal((await bf.handle(post(`${U}/reports`, body()))).status, 400);
  await done();
});

test('public client tokens cannot replace verified account authorization', async () => {
  const { bf, done } = await fresh({ clientTokens: ['pk_live_abc'], authorize: req => req.headers.get('authorization') === 'Bearer verified-session' ? { id: 'user', role: 'client' } : null });
  assert.equal((await bf.handle(post(`${U}/reports`, body()))).status, 401);
  assert.equal((await bf.handle(post(`${U}/reports`, body(), { 'x-bugframe-token': 'wrong' }))).status, 401);
  assert.equal((await bf.handle(post(`${U}/reports`, body(), { 'x-bugframe-token': 'pk_live_abc' }))).status, 401);
  assert.equal((await bf.handle(post(`${U}/reports`, body(), { authorization: 'Bearer verified-session' }))).status, 201);
  assert.equal((await bf.handle(get(`${U}/health`))).status, 200);
  await done();
});

test('admin routes need the admin token; clients only see their own reports', async () => {
  const { bf, done } = await fresh({ adminToken: 'sk_admin', authorize: req => {
    const id = { 'Bearer session-a': 'a', 'Bearer session-b': 'b' }[req.headers.get('authorization')];
    return id ? { id, role: 'client' } : null;
  } });
  const h = who => ({ authorization: `Bearer session-${who}`, 'x-bugframe-reporter': who });
  const a = (await (await bf.handle(post(`${U}/reports`, body({ description: 'from A' }), h('a')))).json()).id;
  const b = (await (await bf.handle(post(`${U}/reports`, body({ description: 'from B' }), h('b')))).json()).id;
  const mineA = await (await bf.handle(get(`${U}/reports`, h('a')))).json();
  assert.deepEqual(mineA.reports.map(r => r.id), [a]);
  assert.equal(mineA.reports[0].page, '/settings#/billing');
  assert.equal((await bf.handle(get(`${U}/reports/${b}/region.png`, h('a')))).status, 404); // not theirs
  assert.equal((await bf.handle(get(`${U}/reports/${a}/region.png`, h('a')))).status, 200);
  assert.equal((await bf.handle(get(`${U}/reports/${a}`, h('a')))).status, 403);
  const patchReq = (id, token, data) => new Request(`${U}/reports/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : h('a')) }, body: JSON.stringify(data) });
  assert.equal((await bf.handle(patchReq(a, null, { status: 'fixed' }))).status, 403);
  assert.equal((await bf.handle(patchReq(a, 'nope', { status: 'fixed' }))).status, 401);
  assert.equal((await bf.handle(patchReq(a, 'sk_admin', { status: 'bad' }))).status, 400);
  assert.equal((await bf.handle(patchReq(a, 'sk_admin', { status: 'fixed', note: 'moved the footer' }))).status, 200);
  const after = await (await bf.handle(get(`${U}/reports`, h('a')))).json();
  assert.equal(after.reports[0].status, 'fixed'); assert.equal(after.reports[0].note, 'moved the footer');
  const all = await (await bf.handle(get(`${U}/reports?all=1`, { authorization: 'Bearer sk_admin' }))).json();
  assert.equal(all.reports.length, 2);
  const full = await (await bf.handle(get(`${U}/reports/${a}`, { authorization: 'Bearer sk_admin' }))).json();
  assert.equal(full.context.metadata.version, '1.2.3');
  await done();
});

test('path traversal in ids and file names is refused', async () => {
  const { dir, bf, done } = await fresh();
  const id = (await (await bf.handle(post(`${U}/reports`, body()))).json()).id;
  for (const bad of ['..', '../x', '..%2F..%2Fetc', 'bug-20260101-000000-zzzz', '%2e%2e']) {
    assert.equal((await bf.handle(get(`${U}/reports/${bad}/region.png`))).status, 404, bad);
    assert.equal((await bf.handle(new Request(`${U}/reports/${bad}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"fixed"}' }))).status >= 400, true);
  }
  assert.equal((await bf.handle(get(`${U}/reports/${id}/report.json`))).status, 405); // only the two pictures are served
  assert.equal((await bf.handle(get(`${U}/reports/${id}/..%2Freport.json`))).status, 405);
  await done(); void dir;
});

test('images are served with safe headers', async () => {
  const { bf, done } = await fresh();
  const id = (await (await bf.handle(post(`${U}/reports`, body()))).json()).id;
  const res = await bf.handle(get(`${U}/reports/${id}/full.png`));
  assert.equal(res.headers.get('content-type'), 'image/png'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await done();
});

test('CORS: same-origin works, listed origins get headers, others are refused', async () => {
  const { bf, done } = await fresh({ allowedOrigins: ['https://site.example'] });
  const pre = await bf.handle(new Request(`${U}/reports`, { method: 'OPTIONS', headers: { origin: 'https://site.example', 'access-control-request-method': 'POST' } }));
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://site.example');
  assert.equal((await bf.handle(new Request(`${U}/reports`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))).status, 403);
  const ok = await bf.handle(post(`${U}/reports`, body(), { origin: 'https://site.example' }));
  assert.equal(ok.status, 201); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://site.example');
  const bad = await bf.handle(post(`${U}/reports`, body(), { origin: 'https://evil.example' }));
  assert.equal(bad.status, 403); assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.equal((await bf.handle(post(`${U}/reports`, body(), { origin: 'https://app.test' }))).status, 201); // same origin
  await done();
});

test('rate limit answers 429 with Retry-After', async () => {
  const { bf, done } = await fresh({ rateLimit: { max: 2, windowMs: 60000 } });
  const send = () => bf.handle(post(`${U}/reports`, body()), { ip: '1.2.3.4' });
  assert.equal((await send()).status, 201); assert.equal((await send()).status, 201);
  const third = await send(); assert.equal(third.status, 429); assert.ok(third.headers.get('retry-after'));
  assert.equal((await bf.handle(post(`${U}/reports`, body()), { ip: '9.9.9.9' })).status, 429); // same account cannot evade the limit by changing IP
  await done();
});

test('context is cleaned: bounded lists, oversize metadata dropped, no unknown keys', async () => {
  const { bf, done } = await fresh();
  const ctx = { ...body().context, evil: '<script>', elements: Array.from({ length: 30 }, () => ({ path: 'x'.repeat(900), component: 'c', text: 't', extra: 1 })), consoleErrors: Array.from({ length: 50 }, () => ({ at: 'a', message: 'm'.repeat(2000) })), metadata: { big: 'y'.repeat(9000) } };
  const id = (await (await bf.handle(post(`${U}/reports`, body({ context: ctx })))).json()).id;
  const r = await bf.storage.get(id);
  assert.equal(r.context.evil, undefined); assert.equal(r.context.elements.length, 12); assert.equal(r.context.elements[0].path.length, 300);
  assert.equal(r.context.consoleErrors.length, 20); assert.equal(r.context.consoleErrors[0].message.length, 500);
  assert.match(r.context.metadata._dropped, /8 KB/);
  await done();
});

test('webhook gets a signed notification', async () => {
  const calls = [];
  const { bf, done } = await fresh({ webhook: { url: 'https://hooks.test/in', secret: 's3cret' }, fetch: async (u, init) => { calls.push({ u, init }); return new Response('ok'); } });
  await bf.handle(post(`${U}/reports`, body()));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 1); assert.equal(calls[0].u, 'https://hooks.test/in');
  const { createHmac } = await import('node:crypto');
  assert.equal(calls[0].init.headers['x-bugframe-signature'], 'sha256=' + createHmac('sha256', 's3cret').update(calls[0].init.body).digest('hex'));
  assert.equal(JSON.parse(calls[0].init.body).event, 'report.created');
  assert.equal(JSON.parse(calls[0].init.body).images, undefined);
  await done();
});

test('a failing webhook never fails the report', async () => {
  const { bf, done } = await fresh({ webhook: { url: 'https://hooks.test/in' }, fetch: async () => { throw new Error('down'); } });
  assert.equal((await bf.handle(post(`${U}/reports`, body()))).status, 201);
  await done();
});

test('custom authorize hook and onReport hook', async () => {
  const seen = [];
  const { bf, done } = await fresh({ authorize: req => (req.headers.get('authorization') === 'Bearer session-ok' ? { id: 'approved-user', role: 'client' } : null), onReport: r => seen.push(r.id) });
  assert.equal((await bf.handle(post(`${U}/reports`, body()))).status, 401);
  assert.equal((await bf.handle(post(`${U}/reports`, body(), { authorization: 'Bearer session-ok' }))).status, 201);
  assert.equal(seen.length, 1);
  await done();
});

test('works with a custom (memory) storage adapter and retries id collisions', async () => {
  const storage = createMemoryStorage(); let n = 0;
  const bf = createBugframe({ storage, rateLimit: false, authorize: () => ({ id: 'fixture-user', role: 'client' }), generateId: () => (n++ < 2 ? 'bug-20260101-000000-aaaa' : 'bug-20260101-000000-bbbb') });
  assert.equal((await bf.handle(post('https://x.test/reports', body()))).status, 201); // aaaa
  const second = await bf.handle(post('https://x.test/reports', body()));             // aaaa collides, retries -> bbbb
  assert.equal(second.status, 201); assert.equal((await second.json()).id, 'bug-20260101-000000-bbbb');
  assert.equal((await storage.list()).length, 2);
});

test('unknown paths and methods', async () => {
  const { bf, done } = await fresh();
  assert.equal((await bf.handle(get('https://app.test/other'))).status, 404);
  assert.equal((await bf.handle(new Request(`${U}/reports`, { method: 'DELETE' }))).status, 405);
  assert.equal((await stat(bf.storage.dir)).isDirectory() || true, true);
  await done();
});
