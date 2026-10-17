// Local-only session demo. Integrate your application's verified login sessions in production.
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createBugframe, toNodeListener } from '../../src/server/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4455);
const dir = process.env.BUGFRAME_DIR ?? join(here, 'reports');
const adminToken = process.env.BUGFRAME_ADMIN_TOKEN ?? randomBytes(32).toString('hex');
const password = process.env.BUGFRAME_DEMO_PASSWORD ?? randomBytes(16).toString('hex');
const digest = value => createHash('sha256').update(value).digest();
const sessions = new Map();
let loginAttempts = [];
const cookieName = 'bugframe_demo_session';
const sessionId = cookie => cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const userFor = cookie => {
  const id = sessionId(cookie), session = sessions.get(id);
  if (!session || session.expires <= Date.now()) { if (id) sessions.delete(id); return null; }
  return session.user;
};
const bf = createBugframe({
  dir, basePath: '/api/bugframe', adminToken,
  authorize: req => userFor(req.headers.get('cookie')),
  rateLimit: { max: 30, windowMs: 60_000 }, logger: (...a) => console.error('[bugframe]', ...a),
});
const api = toNodeListener(bf);
const assets = { '/': ['index.html', 'text/html; charset=utf-8', here], '/login': ['login.html', 'text/html; charset=utf-8', here], '/bugframe.min.js': ['bugframe.min.js', 'text/javascript; charset=utf-8', join(here, '../../dist')] };
const redirect = res => { res.writeHead(303, { location: '/?bugs=1' }); res.end(); };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('cache-control', 'no-store');
  if (bf.matches(path)) return api(req, res);
  if (req.method === 'POST' && (path === '/login' || path === '/logout')) {
    // Forms only from this demo's own origin; cookie is also SameSite=Strict.
    if (req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); return res.end('Forbidden'); }
    if (path === '/logout') {
      sessions.delete(sessionId(req.headers.cookie));
      res.setHeader('set-cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return redirect(res);
    }
    loginAttempts = loginAttempts.filter(t => t > Date.now() - 60000);
    if (loginAttempts.length >= 20) { res.writeHead(429, { 'retry-after': '60' }); return res.end('Too many sign-in attempts.'); }
    loginAttempts.push(Date.now());
    if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') { res.writeHead(415); return res.end('Use the sign-in form.'); }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413); return res.end('Too large.'); } chunks.push(chunk); }
    const supplied = new URLSearchParams(Buffer.concat(chunks).toString()).get('password') ?? '';
    if (!timingSafeEqual(digest(supplied), digest(password))) { res.writeHead(401); return res.end('Incorrect demo password.'); }
    for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id);
    if (sessions.size >= 100) { res.writeHead(429); return res.end('Too many active demo sessions.'); }
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { user: { id: 'demo-approved-tester', role: 'client' }, expires: Date.now() + 3600000 });
    res.setHeader('set-cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    return redirect(res);
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  const hit = assets[path];
  if (!hit) { res.writeHead(404); return res.end('Not found'); }
  try {
    let content = await readFile(join(hit[2], hit[0]));
    if (path === '/') {
      const approved = Boolean(userFor(req.headers.cookie));
      content = content.toString().replace('<!-- BUGFRAME_SESSION -->', approved
        ? '<form action="/logout" method="post"><button type="submit">Sign out</button></form>'
        : '<p><a href="/login">Sign in as an approved tester</a> to report a problem.</p>')
        .replace('<!-- BUGFRAME_WIDGET -->', approved
          ? '<script src="/bugframe.min.js" data-autoinit data-endpoint="/api/bugframe" data-avoid="#chat" data-capture-console="true"></script>' : '');
    }
    res.setHeader('content-type', hit[1]); res.end(content);
  } catch { res.writeHead(500); res.end('Run `npm run build` first.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}/?bugs=1\nSign in at /login with the demo password: ${password}\nReports: ${dir}\nThis server binds to localhost only. Set BUGFRAME_DEMO_PASSWORD to choose the demo password.`));
