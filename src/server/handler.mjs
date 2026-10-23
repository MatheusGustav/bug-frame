// The report API as a plain fetch handler: (Request) => Promise<Response>. Works in Node 18+, Bun, Deno, Cloudflare Workers
// (with a custom storage adapter) and behind any framework through the adapters in node.mjs.
import { createHash, createHmac } from 'node:crypto';
import { createFileStorage } from './storage-fs.mjs';
import { ID_RE, STATUSES, cleanContext, decodePng, newReportId, safeEqual, summarize, text } from './util.mjs';

const MB = 1024 * 1024;
const DEFAULTS = { maxBodyBytes: 24 * MB, maxImageBytes: 10 * MB, maxDescription: 4000, rateLimit: { max: 10, windowMs: 60_000 } };

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const err = (status, error, message, extra) => json(status, { error, message }, extra);

/**
 * @param {import('../../types/server.js').BugframeOptions} options
 * @returns {import('../../types/server.js').Bugframe}
 */
export function createBugframe(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const storage = o.storage ?? (o.dir ? createFileStorage({ dir: o.dir }) : null);
  if (!storage) throw new Error('createBugframe needs `dir` (filesystem) or a `storage` adapter');
  const basePath = (o.basePath ?? '').replace(/\/+$/, '');
  const log = o.logger ?? (() => {});
  const rate = o.rateLimit === false ? null : { ...DEFAULTS.rateLimit, ...(o.rateLimit ?? {}) };
  const hits = new Map();

  // ---- helpers
  const limited = key => {
    if (!rate) return false;
    const now = Date.now(), cutoff = now - rate.windowMs;
    const list = (hits.get(key) ?? []).filter(t => t > cutoff);
    if (list.length >= rate.max) { hits.set(key, list); return true; }
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > cutoff)) hits.delete(k);
    return false;
  };
  const allowedOrigin = (origin, url) => {
    if (!origin) return true; // not a browser cross-site request (curl, CLI, server to server)
    try { if (new URL(origin).host === url.host) return true; } catch { return false; }
    const a = o.allowedOrigins;
    if (a === '*') return true;
    if (typeof a === 'function') return Boolean(a(origin));
    return Array.isArray(a) && a.includes(origin);
  };
  const cors = (origin, url) => {
    if (!origin || !allowedOrigin(origin, url)) return {};
    return { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'content-type,x-bugframe-token,x-bugframe-reporter,authorization', 'access-control-max-age': '600' };
  };
  // Only a server-verified principal grants access. Public widget tokens and reporter headers never do.
  const principal = async req => {
    const bearer = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    if (o.adminToken && bearer && safeEqual(bearer, o.adminToken)) return { role: 'admin', reporter: 'admin:token' };
    if (o.authorize) {
      try {
        const p = await o.authorize(req);
        if (p && typeof p === 'object' && (p.role === 'admin' || p.role === 'client') && typeof p.id === 'string' && p.id.trim() && p.id.length <= 256) {
          return { role: p.role, reporter: `user:${createHash('sha256').update(p.id).digest('hex')}` };
        }
      } catch { /* unavailable or expired session verification means no access */ }
    }
    return null;
  };
  const clientIp = (req, ctx) => ctx?.ip || (o.trustProxy ? (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() : '') || 'unknown';

  async function readJsonBody(req) {
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { error: err(415, 'unsupported_media_type', 'Send application/json.') };
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > o.maxBodyBytes) return { error: err(413, 'too_large', 'The report is too large.') };
    if (!req.body) return { error: err(400, 'bad_json', 'Empty body.') };
    const reader = req.body.getReader(), chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > o.maxBodyBytes) { try { await reader.cancel(); } catch { /* already closed */ } return { error: err(413, 'too_large', 'The report is too large.') }; }
      chunks.push(value);
    }
    try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; } catch { return { error: err(400, 'bad_json', 'The body is not valid JSON.') }; }
  }

  async function forward(report, files) {
    const w = o.webhook; if (!w?.url) return;
    const payload = { event: 'report.created', report: summarize(report), context: report.context, ...(w.includeImages ? { images: { region: files.region.toString('base64'), full: files.full.toString('base64') } } : {}) };
    const body = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', 'user-agent': 'bugframe-webhook' };
    if (w.secret) headers['x-bugframe-signature'] = 'sha256=' + createHmac('sha256', w.secret).update(body).digest('hex');
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), w.timeoutMs ?? 5000);
    try { const res = await (o.fetch ?? fetch)(w.url, { method: 'POST', headers, body, signal: ctl.signal }); if (!res.ok) log('webhook', res.status); }
    catch (e) { log('webhook', String(e?.message ?? e)); } finally { clearTimeout(timer); }
  }

  // ---- routes
  async function create(req, ctx, who) {
    if (limited(`account:${who.reporter}`) || limited(`ip:${clientIp(req, ctx)}`)) return err(429, 'rate_limited', 'Too many reports. Try again in a minute.', { 'retry-after': String(Math.ceil((rate?.windowMs ?? 60000) / 1000)) });
    const { body, error } = await readJsonBody(req); if (error) return error;
    const b = body && typeof body === 'object' ? body : {};
    const description = text(b.description, o.maxDescription).trim();
    if (!description) return err(400, 'description_required', 'Describe what is wrong or missing.');
    const region = decodePng(b.region, o.maxImageBytes), full = decodePng(b.full, o.maxImageBytes);
    if (!region || !full) return err(400, 'images_required', 'The screenshots are missing, too large, or not PNG files.');
    let report;
    for (let attempt = 0; attempt < 5; attempt++) {
      const d = (o.now ?? (() => new Date()))(), id = (o.generateId ?? newReportId)(d);
      report = { id, status: 'open', note: '', createdAt: d.toISOString(), reporter: who.reporter, description, types: (Array.isArray(b.types) ? b.types : []).slice(0, 8).map(t => text(t, 40)).filter(Boolean), context: cleanContext(b.context), files: { region: 'region.png', full: 'full.png' } };
      try { await storage.create(report, { region, full }); break; } catch (e) { if (e?.code === 'EXISTS' && attempt < 4) continue; log('store', String(e?.message ?? e)); return err(500, 'store_failed', 'The report could not be saved.'); }
    }
    try { await o.onReport?.(report); } catch (e) { log('onReport', String(e?.message ?? e)); }
    void forward(report, { region, full });
    return json(201, { id: report.id, status: 'open' });
  }

  async function list(req, who, url) {
    const all = who.role === 'admin' && url.searchParams.get('all') === '1';
    if (o.publicList === false && who.role !== 'admin') return json(200, { reports: [] });
    const reporter = who.reporter;
    const rows = (await storage.list()).filter(r => all || r.reporter === reporter);
    return json(200, { reports: rows.map(summarize) });
  }

  async function image(req, who, id, file) {
    if (!ID_RE.test(id)) return err(404, 'not_found', 'Not found.');
    const r = await storage.get(id);
    if (!r || (who.role !== 'admin' && r.reporter !== who.reporter)) return err(404, 'not_found', 'Not found.');
    const buf = await storage.readFile(id, file);
    if (!buf) return err(404, 'not_found', 'Not found.');
    return new Response(buf, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'content-length': String(buf.length) } });
  }

  async function patch(req, id) {
    if (!ID_RE.test(id)) return err(404, 'not_found', 'Not found.');
    const { body, error } = await readJsonBody(req); if (error) return error;
    const status = body?.status;
    if (!STATUSES.includes(status)) return err(400, 'bad_status', 'Status must be open, fixed or wontfix.');
    const next = await storage.update(id, { status, note: text(body?.note, 2000), closedAt: status === 'open' ? null : new Date().toISOString() });
    if (!next) return err(404, 'not_found', 'Not found.');
    return json(200, { id: next.id, status: next.status, note: next.note });
  }

  /** True when the URL belongs to this API (so a framework can fall through to its own routes otherwise). */
  const matches = url => { const u = typeof url === 'string' ? new URL(url, 'http://x') : url; return u.pathname === basePath + '/health' || u.pathname === basePath + '/access' || u.pathname === basePath + '/reports' || u.pathname.startsWith(basePath + '/reports/'); };

  async function handle(req, ctx = {}) {
    const url = new URL(req.url), origin = req.headers.get('origin');
    const c = cors(origin, url);
    const withCors = res => { for (const [k, v] of Object.entries(c)) res.headers.set(k, v); return res; };
    try {
      if (!matches(url)) return withCors(err(404, 'not_found', 'Not found.'));
      if (req.method === 'OPTIONS') return origin && allowedOrigin(origin, url) ? new Response(null, { status: 204, headers: c }) : new Response(null, { status: 403 });
      if (origin && !allowedOrigin(origin, url)) return err(403, 'origin_not_allowed', 'This origin is not allowed.');
      const path = url.pathname.slice(basePath.length);
      if (path === '/health') return withCors(json(200, { ok: true }));
      const who = await principal(req);
      if (!who) return withCors(err(401, 'unauthorized', 'Sign in with an account authorized to report bugs.'));
      if (path === '/access') return withCors(req.method === 'GET' ? json(200, { role: who.role }) : err(405, 'method_not_allowed', 'Not supported.'));
      const parts = path.split('/').filter(Boolean); // ['reports', id?, file?]
      if (parts[0] === 'reports') {
        if (parts.length === 1 && req.method === 'POST') return withCors(await create(req, ctx, who));
        if (parts.length === 1 && req.method === 'GET') return withCors(await list(req, who, url));
        if (parts.length === 3 && req.method === 'GET' && (parts[2] === 'region.png' || parts[2] === 'full.png')) return withCors(await image(req, who, parts[1], parts[2]));
        if (parts.length === 2 && req.method === 'GET') {
          if (who.role !== 'admin') return withCors(err(403, 'forbidden', 'Admin only.'));
          if (!ID_RE.test(parts[1])) return withCors(err(404, 'not_found', 'Not found.'));
          const r = await storage.get(parts[1]); return withCors(r ? json(200, r) : err(404, 'not_found', 'Not found.'));
        }
        if (parts.length === 2 && req.method === 'PATCH') { if (who.role !== 'admin') return withCors(err(403, 'forbidden', 'Admin only.')); return withCors(await patch(req, parts[1])); }
      }
      return withCors(err(405, 'method_not_allowed', 'Not supported.'));
    } catch (e) { log('handler', String(e?.stack ?? e)); return withCors(err(500, 'server_error', 'Something went wrong.')); }
  }

  return { handle, matches, storage, basePath };
}
