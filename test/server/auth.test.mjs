import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBugframe, createMemoryStorage } from '../../src/server/index.mjs';
import { body, post } from '../helpers.mjs';

const U = 'https://app.test/reports';
// These bearer values stand in for sessions verified by the host application's auth service.
const authorize = req => {
  const session = { 'Bearer alice-session': { id: 'alice', role: 'client' }, 'Bearer bob-session': { id: 'bob', role: 'client' }, 'Bearer admin-session': { id: 'owner', role: 'admin' } }[req.headers.get('authorization')];
  return session ?? null;
};
const headers = user => ({ authorization: `Bearer ${user}-session` });
const server = options => createBugframe({ storage: createMemoryStorage(), ...options });

test('default access is closed, including when the public client token and reporter id are copied', async () => {
  let saved = 0;
  for (const clientTokens of [undefined, ['public-token']]) {
    const bf = server({ clientTokens, onReport: () => saved++ });
    for (const h of [{}, { 'x-bugframe-token': 'public-token', 'x-bugframe-reporter': 'admin', authorization: 'Bearer guessed' }]) {
      assert.equal((await bf.handle(post(`${U}?bugs=1`, body(), h))).status, 401);
      assert.equal((await bf.handle(new Request(U, { headers: h }))).status, 401);
    }
    assert.equal((await bf.storage.list()).length, 0);
  }
  assert.equal(saved, 0);
});

test('denied, malformed, legacy and failing authorization decisions cannot create reports', async () => {
  const decisions = [null, false, true, 'client', 'admin', {}, { role: 'user', id: 'customer' }, { role: 'client' }, { role: 'client', id: '' }, { role: 'client', id: '   ' }, { role: 'client', id: 42 }, { role: 'client', id: 'x'.repeat(257) }];
  for (const decision of decisions) {
    const bf = server({ authorize: () => decision });
    assert.equal((await bf.handle(post(U, body(), headers('alice')))).status, 401, JSON.stringify(decision));
    assert.equal((await bf.storage.list()).length, 0);
  }
  const bf = server({ authorize: async () => { throw new Error('session service unavailable'); } });
  assert.equal((await bf.handle(post(U, body()))).status, 401);
  assert.equal((await bf.storage.list()).length, 0);
});

test('approved accounts and admins can submit; the server owns reporter identity and access to images', async () => {
  const bf = server({ authorize, adminToken: 'ops-secret' });
  const a = await (await bf.handle(post(U, body(), { ...headers('alice'), 'x-bugframe-reporter': 'bob' }))).json();
  const b = await (await bf.handle(post(U, body(), { ...headers('bob'), 'x-bugframe-reporter': 'alice' }))).json();
  const owner = await bf.handle(post(U, body(), headers('admin')));
  const ops = await bf.handle(post(U, body(), { authorization: 'Bearer ops-secret' }));
  assert.equal(owner.status, 201); assert.equal(ops.status, 201);
  assert.ok(a.id); assert.ok(b.id);
  const storedA = await bf.storage.get(a.id), storedB = await bf.storage.get(b.id);
  assert.notEqual(storedA.reporter, storedB.reporter);
  const spoofed = { ...headers('alice'), 'x-bugframe-reporter': storedB.reporter };
  const mine = await (await bf.handle(new Request(U, { headers: spoofed }))).json();
  assert.deepEqual(mine.reports.map(r => r.id), [a.id]);
  assert.equal((await bf.handle(new Request(`${U}/${b.id}/region.png`, { headers: spoofed }))).status, 404);
  assert.equal((await bf.handle(new Request(`${U}/${a.id}/region.png`, { headers: headers('alice') }))).status, 200);
  assert.equal((await bf.handle(new Request(`${U}/${b.id}`, { headers: headers('alice') }))).status, 403);
  const patch = new Request(`${U}/${a.id}`, { method: 'PATCH', headers: { ...headers('alice'), 'content-type': 'application/json' }, body: '{"status":"fixed"}' });
  assert.equal((await bf.handle(patch)).status, 403);
  const all = await (await bf.handle(new Request(`${U}?all=1`, { headers: headers('admin') }))).json();
  assert.equal(all.reports.length, 4);
});

test('a session revoked after opening the widget loses access on the next request', async () => {
  let active = true;
  const bf = server({ authorize: req => active ? authorize(req) : null });
  const first = await (await bf.handle(post(U, body(), headers('alice')))).json();
  active = false;
  for (const req of [post(U, body(), headers('alice')), new Request(U, { headers: headers('alice') }), new Request(`${U}/${first.id}/full.png`, { headers: headers('alice') })]) {
    assert.equal((await bf.handle(req)).status, 401);
  }
  assert.equal((await bf.storage.list()).length, 1);
});

test('changing reporter headers or IP addresses cannot reset an account submission limit', async () => {
  const bf = server({ authorize, rateLimit: { max: 2, windowMs: 60000 } });
  const send = (i, user = 'alice') => bf.handle(post(U, body(), { ...headers(user), 'x-bugframe-reporter': `fake-${i}` }), { ip: `10.0.0.${i}` });
  assert.equal((await send(1)).status, 201);
  assert.equal((await send(2)).status, 201);
  const blocked = await send(3);
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await send(4, 'bob')).status, 201);
});

test('approved users also share an IP limit, and disallowed origins cannot submit', async () => {
  const bf = server({ authorize, rateLimit: { max: 1, windowMs: 60000 } });
  assert.equal((await bf.handle(post(U, body(), headers('alice')), { ip: 'same-ip' })).status, 201);
  assert.equal((await bf.handle(post(U, body(), headers('bob')), { ip: 'same-ip' })).status, 429);
  assert.equal((await bf.handle(post(U, body(), { ...headers('bob'), origin: 'https://evil.test' }), { ip: 'other-ip' })).status, 403);
});

test('authenticated requests still require an actual JSON content type', async () => {
  const bf = server({ authorize });
  for (const contentType of ['text/plain; note=json', 'application/not-json', 'text/json']) {
    const req = new Request(U, { method: 'POST', headers: { ...headers('alice'), 'content-type': contentType }, body: JSON.stringify(body()) });
    assert.equal((await bf.handle(req)).status, 415);
  }
});
