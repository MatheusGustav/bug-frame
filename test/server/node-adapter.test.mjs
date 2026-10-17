import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBugframe, toNodeListener } from '../../src/server/index.mjs';
import { body, cleanup, tmpDir } from '../helpers.mjs';

const listen = server => new Promise(res => server.listen(0, '127.0.0.1', () => res(server.address().port)));

test('node http listener: create, list, close over real HTTP', async () => {
  const dir = await tmpDir();
  const bf = createBugframe({ dir, adminToken: 'adm', rateLimit: false });
  const server = createServer(toNodeListener(bf)); const port = await listen(server);
  try {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/reports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bugframe-reporter': 'me' }, body: JSON.stringify(body()) });
    assert.equal(res.status, 201); const { id } = await res.json();
    const list = await (await fetch(`${base}/reports`, { headers: { 'x-bugframe-reporter': 'me' } })).json();
    assert.equal(list.reports[0].id, id);
    const img = await fetch(`${base}/reports/${id}/region.png`, { headers: { 'x-bugframe-reporter': 'me' } });
    assert.equal(img.status, 200); assert.equal((await img.arrayBuffer()).byteLength > 30, true);
    const closed = await fetch(`${base}/reports/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer adm' }, body: JSON.stringify({ status: 'fixed', note: 'done' }) });
    assert.equal(closed.status, 200);
  } finally { server.close(); await cleanup(dir); }
});

test('express-style mount: next() for foreign paths, basePath for ours, parsed bodies accepted', async () => {
  const dir = await tmpDir();
  const bf = createBugframe({ dir, basePath: '/bugs', rateLimit: false });
  const listener = toNodeListener(bf);
  const server = createServer((req, res) => {
    // emulate express: req.originalUrl keeps the prefix
    req.originalUrl = req.url;
    listener(req, res, () => { res.statusCode = 200; res.end('app'); });
  });
  const port = await listen(server);
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/home`)).text(), 'app');
    const res = await fetch(`http://127.0.0.1:${port}/bugs/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) });
    assert.equal(res.status, 201);
    const big = await fetch(`http://127.0.0.1:${port}/bugs/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body({ description: 'x'.repeat(30 * 1024 * 1024) })) });
    assert.equal(big.status, 413);
  } finally { server.close(); await cleanup(dir); }
});
