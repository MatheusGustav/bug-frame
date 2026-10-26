import { readFile } from 'node:fs/promises';
import { resolveLocale, translator } from './inbox/i18n.js';

const headers = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const path = value => value === '' || /^\/[A-Za-z0-9_/-]+$/.test(value) && !value.startsWith('//') && !value.split('/').includes('..');

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const STRINGS = ['strings-en.js', 'strings-es.js', 'strings-pt.js'];
const PUBLIC = ['invite.html', 'invite.js', 'inbox.css', 'i18n.js', 'ui.js', ...STRINGS];

function checkOptions({ bugframe, basePath, apiBase, siteName, loginUrl, siteUrl, locale, labels }) {
  if (!bugframe?.handle || !basePath || !path(basePath) || typeof apiBase !== 'string' || !path(apiBase)) throw new Error('createInbox requires a Bugframe instance and same-origin base paths.');
  checkLinks(loginUrl, siteUrl);
  if (typeof siteName !== 'string' || siteName.length > 120 || Object.values(labels).some(v => typeof v !== 'string' || v.length > 300)) throw new Error('Inbox names and labels must be short strings.');
  if (!['auto', 'en', 'es', 'pt'].includes(locale)) throw new Error('Inbox locale must be auto, en, es or pt.');
}

function checkLinks(...links) {
  for (const location of links.filter(Boolean)) {
    const url = new URL(location, 'https://inbox.invalid');
    if (!location.startsWith('/') || url.origin !== 'https://inbox.invalid') throw new Error('Inbox loginUrl and siteUrl must be same-origin paths.');
  }
}

function routesFor(basePath, invitations) {
  const routes = { [basePath]: 'index.html', [`${basePath}/`]: 'index.html', [`${basePath}/inbox.js`]: 'inbox.js', [`${basePath}/inbox.css`]: 'inbox.css', [`${basePath}/review`]: 'index.html' };
  if (invitations) { routes[`${basePath}/invite`] = 'invite.html'; routes[`${basePath}/invite.js`] = 'invite.js'; }
  for (const file of ['i18n.js', 'ui.js', ...STRINGS]) routes[`${basePath}/${file}`] = file;
  return routes;
}

/** Optional admin inbox; all pages/assets reuse Bugframe's existing authorization hook. No new login system. */
export function createInbox({ bugframe, basePath = '/bugs', apiBase = bugframe?.basePath, siteName = 'Bugframe', loginUrl, siteUrl = '/?bugs=1', locale = 'auto', labels = {} } = {}) {
  basePath = basePath.replace(/\/+$/, '');
  apiBase = apiBase?.replace(/\/+$/, '');
  checkOptions({ bugframe, basePath, apiBase, siteName, loginUrl, siteUrl, locale, labels });
  const routes = routesFor(basePath, bugframe.invitationsEnabled);
  const assets = new Map();
  const asset = file => { if (!assets.has(file)) assets.set(file, readFile(new URL(`./inbox/${file}`, import.meta.url), 'utf8')); return assets.get(file); };
  const matches = input => Object.hasOwn(routes, new URL(input, 'http://localhost').pathname);

  /** An HTML template with every {{KEY}} filled in, escaped. T:key is a translation; customer pages swap the eyebrow and intro. */
  async function page(file, { language, t, customer, reason = '' }) {
    const config = { apiBase, labels, customer, basePath, siteUrl, loginUrl, siteName, locale: language, localePreference: locale, invitations: Boolean(bugframe.invitationsEnabled) };
    const values = { BASE: basePath, NAME: siteName, LANG: language, EYEBROW: customer ? 'myRequests' : 'eyebrow', INTRO: customer ? 'customerIntro' : 'intro', CONFIG: JSON.stringify(config),
      LOGIN_URL: loginUrl ?? '', LOGIN_HIDDEN: loginUrl ? '' : ' hidden', 'T:REASON': reason, 'T:eyebrow': customer ? 'myRequests' : 'eyebrow', 'T:intro': customer ? 'customerIntro' : 'intro' };
    return (await asset(file)).replace(/\{\{(SEL:\w+|T:\w+|\w+)\}\}/g, (_match, key) => {
      if (key.startsWith('SEL:')) return key.slice(4) === language ? ' selected' : '';
      if (key.startsWith('T:')) return escape(t(values[key] ?? key.slice(2), { name: siteName }));
      return key in values ? escape(values[key]) : _match;
    });
  }

  async function handle(req, ctx = {}) {
    const url = new URL(req.url), file = routes[url.pathname];
    const language = resolveLocale(url.searchParams.get('lang') ?? locale, req.headers.get('accept-language') ?? '');
    const t = translator(language, labels), customer = url.pathname === `${basePath}/review`;
    const response = (body, status = 200, type = TYPES.html) => new Response(req.method === 'HEAD' ? null : body, { status, headers: { ...headers, 'content-type': type } });
    if (!file) return response(t('notFound'), 404, 'text/plain');
    if (!['GET', 'HEAD'].includes(req.method)) return response(t('methodNotAllowed'), 405, 'text/plain');
    const denied = PUBLIC.includes(file) ? null : await deniedStatus(req, url, ctx, customer || file !== 'index.html');
    if (denied) return response(await page('denied.html', { language, t, reason: customer ? 'customerRequired' : 'adminRequired' }), denied);
    const type = TYPES[file.split('.').pop()];
    return response(type === TYPES.html ? await page(file, { language, t, customer }) : await asset(file), 200, type);
  }

  /** The status to refuse with, or null when the account may open the page (any approved account, or only an admin). */
  async function deniedStatus(req, url, ctx, anyAccount) {
    const access = await bugframe.handle(new Request(new URL(`${bugframe.basePath}/access`, url), { headers: req.headers }), ctx);
    if (!access.ok) return access.status;
    return anyAccount || (await access.json()).role === 'admin' ? null : 403;
  }
  return { handle, matches, basePath };
}
