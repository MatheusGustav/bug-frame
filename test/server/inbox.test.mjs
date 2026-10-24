import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBugframe, createInbox, createMemoryStorage } from '../../src/server/index.mjs';

const U = 'https://app.test/support/inbox';
const make = () => {
  let active = true;
  const bugframe = createBugframe({ basePath: '/api/bugs', storage: createMemoryStorage(), authorize: req => {
    if (!active) return null;
    const role = { admin: 'admin', tester: 'client' }[req.headers.get('cookie')];
    return role ? { id: 'account', role } : null;
  } });
  return { bugframe, revoke: () => { active = false; } };
};

test('inbox HTML requires admins, shared assets require approved accounts and honor revocation', async () => {
  const { bugframe, revoke } = make();
  const inbox = createInbox({ bugframe, basePath: '/support/inbox', siteName: 'Community reports', loginUrl: '/sign-in' });
  for (const asset of ['', '/', '/inbox.js', '/inbox.css']) {
    const request = cookie => new Request(U + asset, { headers: cookie ? { cookie } : {} });
    assert.equal((await inbox.handle(request())).status, 401);
    assert.equal((await inbox.handle(request('tester'))).status, asset.endsWith('.js') || asset.endsWith('.css') ? 200 : 403);
    const response = await inbox.handle(request('admin'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  revoke(); assert.equal((await inbox.handle(new Request(U, { headers: { cookie: 'admin' } }))).status, 401);
});

test('inbox paths, API base, labels and title are configurable without injecting HTML', async () => {
  const { bugframe } = make();
  const inbox = createInbox({ bugframe, basePath: '/support/inbox', apiBase: '/api/bugs', siteName: '<script>bad()</script>', labels: { refresh: '<img src=x onerror=bad()>' } });
  const html = await (await inbox.handle(new Request(U, { headers: { cookie: 'admin' } }))).text();
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>bad/);
  assert.match(html, /\/support\/inbox\/inbox.js/); assert.match(html, /&quot;apiBase&quot;:&quot;\/api\/bugs/);
  assert.equal(inbox.matches(U + '/inbox.js'), true); assert.equal(inbox.matches(U + '/secret'), false);
  assert.equal((await inbox.handle(new Request(U + '/secret'))).status, 404);
  assert.throws(() => createInbox({ bugframe, basePath: '/bugs/../private' }), /same-origin/);
  assert.throws(() => createInbox({ bugframe, apiBase: 'https://other.test/api' }), /same-origin/);
  assert.throws(() => createInbox({ bugframe, loginUrl: '//other.test/login' }), /same-origin/);
});

test('access checks disclose only verified role and cannot create a session or change permissions', async () => {
  const { bugframe } = make();
  const url = 'https://app.test/api/bugs/access';
  assert.equal((await bugframe.handle(new Request(url))).status, 401);
  assert.deepEqual(await (await bugframe.handle(new Request(url, { headers: { cookie: 'tester' } }))).json(), { role: 'client' });
  assert.deepEqual(await (await bugframe.handle(new Request(url, { headers: { cookie: 'admin' } }))).json(), { role: 'admin' });
  assert.equal((await bugframe.handle(new Request(url, { method: 'POST', headers: { cookie: 'admin' } }))).status, 405);
});

test('customer request page is approved-account only and the invitation shell is public only when enabled', async () => {
  const { bugframe } = make(); const inbox = createInbox({ bugframe, basePath: '/support/inbox' });
  assert.equal((await inbox.handle(new Request(U + '/review'))).status, 401);
  const client = await inbox.handle(new Request(U + '/review', { headers: { cookie: 'tester' } }));
  assert.equal(client.status, 200); assert.match(await client.text(), /&quot;customer&quot;:true/);
  assert.equal((await inbox.handle(new Request(U + '/invite'))).status, 404);
});
