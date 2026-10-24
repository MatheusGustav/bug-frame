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
    assert.equal((await inbox.handle(request())).status, asset.endsWith('.css') ? 200 : 401);
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

test('all portal languages have complete keys and server-rendered text follows explicit locale and Accept-Language', async () => {
  const { LOCALES, resolveLocale } = await import('../../src/server/inbox/i18n.js');
  const keys = Object.keys(LOCALES.en).sort();
  for (const dictionary of Object.values(LOCALES)) assert.deepEqual(Object.keys(dictionary).sort(), keys);
  assert.equal(resolveLocale('auto', 'fr;q=1,pt-BR;q=0.8,es;q=0.7'), 'pt');
  assert.equal(resolveLocale('auto', 'es;q=0,pt;q=0.9,en;q=0.4'), 'pt');
  assert.equal(resolveLocale('auto', 'fr'), 'en');
  const { bugframe } = make();
  const inbox = createInbox({ bugframe, basePath: '/support/inbox' });
  for (const [locale, heading, signIn] of [['en', 'Customer invitations', 'Sign in'], ['es', 'Invitaciones de clientes', 'Iniciar sesión'], ['pt', 'Convites de clientes', 'Entrar']]) {
    const html = await (await inbox.handle(new Request(U + '?lang=' + locale, { headers: { cookie: 'admin' } }))).text();
    assert.match(html, new RegExp(`<html lang="${locale}">`)); assert.ok(html.includes(heading)); assert.doesNotMatch(html, /\{\{T:/);
    const denied = await (await createInbox({ bugframe, basePath: '/support/inbox', loginUrl: '/login' }).handle(new Request(U, { headers: { 'accept-language': locale } }))).text();
    assert.ok(denied.includes(signIn)); assert.ok(denied.includes(`lang="${locale}"`));
  }
  const configured = createInbox({ bugframe, basePath: '/support/inbox', locale: 'pt' });
  assert.match(await (await configured.handle(new Request(U, { headers: { cookie: 'admin', 'accept-language': 'en' } }))).text(), /lang="pt"/);
  assert.throws(() => createInbox({ bugframe, locale: 'fr' }), /locale/);
});

test('public invitation styling and language assets expose no project or account data', async () => {
  const { createMemoryInvitationStorage } = await import('../../src/server/index.mjs');
  const bugframe = createBugframe({ storage: createMemoryStorage(), invitations: { storage: createMemoryInvitationStorage() } });
  const inbox = createInbox({ bugframe, basePath: '/support/inbox', siteName: 'Private project name' });
  for (const file of ['inbox.css', 'i18n.js', 'ui.js', 'invite.js']) {
    const response = await inbox.handle(new Request(U + '/' + file));
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('Private project name'));
  }
  assert.match(await (await inbox.handle(new Request(U + '/invite?lang=es'))).text(), /Aceptar invitación/);
  assert.equal((await inbox.handle(new Request(U + '/review'))).status, 401);
  assert.equal((await inbox.handle(new Request(U + '/inbox.js'))).status, 401);
});
