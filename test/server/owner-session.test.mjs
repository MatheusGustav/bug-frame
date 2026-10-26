import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ownerSessions } from '../../examples/server-inbox/owner-session.mjs';
import { cleanup, post, tmpDir } from '../helpers.mjs';

const origin = 'https://example.test';
const U = origin + '/owner/session';
test('optional owner sessions use private persistent keys, expire, revoke, and reset on runtime replacement', async () => {
  const dataDir = await tmpDir(); const originalNow = Date.now;
  try {
    const owner = await ownerSessions({ dataDir, origin });
    const persisted = JSON.parse(await readFile(join(dataDir, 'owner-access.json'), 'utf8')).adminToken;
    assert.equal(persisted.length, 64);
    if (process.platform !== 'win32') assert.equal((await stat(join(dataDir, 'owner-access.json'))).mode & 0o077, 0);
    assert.equal((await owner.handle(post(U, { key: persisted }, { origin: 'https://evil.test' }))).status, 403);
    const login = await owner.handle(post(U, { key: persisted }, { origin }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    const request = () => new Request(U, { headers: { cookie } });
    assert.equal(owner.authorize(request()).role, 'admin');
    const replacement = await ownerSessions({ dataDir, origin });
    assert.equal(replacement.adminToken, persisted); assert.equal(replacement.authorize(request()), null);
    assert.equal((await owner.handle(new Request(U, { method: 'DELETE', headers: { cookie, origin } }))).status, 200);
    assert.equal(owner.authorize(request()), null);
    const next = await owner.handle(post(U, { key: persisted }, { origin }));
    const future = originalNow() + 28800001; Date.now = () => future;
    assert.equal(owner.authorize(new Request(U, { headers: { cookie: next.headers.get('set-cookie') } })), null);
  } finally { Date.now = originalNow; await cleanup(dataDir); }
});

test('optional owner sign-in has bounded input, same-origin checks, and per-IP attempt limits', async () => {
  const dataDir = await tmpDir();
  try {
    const owner = await ownerSessions({ dataDir, origin, adminToken: 'x'.repeat(64) });
    for (let n = 0; n < 5; n++) assert.equal((await owner.handle(post(U, { key: 'wrong' }, { origin }), { ip: 'one' })).status, 401);
    assert.equal((await owner.handle(post(U, { key: 'x'.repeat(64) }, { origin }), { ip: 'one' })).status, 429);
    assert.equal((await owner.handle(post(U, { key: 'x'.repeat(64) }, { origin }), { ip: 'other' })).status, 200);
    assert.equal((await owner.handle(post(U, { key: 'x'.repeat(5000) }, { origin }), { ip: 'third' })).status, 413);
  } finally { await cleanup(dataDir); }
});
