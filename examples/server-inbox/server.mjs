import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBugframe, createInbox, toNodeListener } from '../../src/server/index.mjs';
import { ownerSessions } from './owner-session.mjs';

let dataDir = process.env.BUGFRAME_DATA_DIR;
if (!dataDir || !isAbsolute(dataDir) || resolve(dataDir) === process.cwd() || resolve(dataDir).startsWith(process.cwd() + sep)) throw new Error('Set an absolute BUGFRAME_DATA_DIR outside the source/deployment directory.');
const configuredOrigin = new URL(process.env.BUGFRAME_ORIGIN ?? 'http://127.0.0.1:4455');
if (configuredOrigin.username || configuredOrigin.password || configuredOrigin.search || configuredOrigin.hash || configuredOrigin.pathname !== '/') throw new Error('BUGFRAME_ORIGIN must be an origin without credentials or a path.');
const origin = configuredOrigin.origin;
if (!origin.startsWith('https:') && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Public hosting requires an HTTPS BUGFRAME_ORIGIN.');
const trustProxy = process.env.BUGFRAME_TRUST_PROXY === '1';
await mkdir(dataDir, { recursive: true, mode: 0o700 });
dataDir = await realpath(dataDir);
const source = await realpath(process.cwd());
if (dataDir === source || dataDir.startsWith(source + sep)) throw new Error('The private data directory must resolve outside the source/deployment directory.');
const demo = process.env.BUGFRAME_OWNER_DEMO === '1';
if (demo && process.env.BUGFRAME_AUTH_MODULE) throw new Error('Choose the owner demo OR your existing auth module; do not combine them.');
const owner = demo ? await ownerSessions({ dataDir, origin, adminToken: process.env.BUGFRAME_ADMIN_TOKEN }) : null;
let authorize;
if (owner) authorize = owner.authorize;
else if (process.env.BUGFRAME_AUTH_MODULE) {
  const module = await import(pathToFileURL(resolve(process.env.BUGFRAME_AUTH_MODULE)).href);
  if (typeof module.authorize !== 'function') throw new Error('BUGFRAME_AUTH_MODULE must export authorize(request).');
  authorize = module.authorize;
}
if (!authorize && !process.env.BUGFRAME_ADMIN_TOKEN) throw new Error('Configure BUGFRAME_AUTH_MODULE, BUGFRAME_ADMIN_TOKEN, or explicitly opt into BUGFRAME_OWNER_DEMO=1.');
const bf = createBugframe({
  dir: join(dataDir, 'reports'), invitations: !owner && Boolean(authorize) ? true : undefined, basePath: '/api/bugframe', authorize, adminToken: owner?.adminToken ?? process.env.BUGFRAME_ADMIN_TOKEN,
  onReport: report => appendFile(join(dataDir, 'events.ndjson'), JSON.stringify({ event: 'report.created', id: report.id, at: report.createdAt }) + '\n', { mode: 0o600 }),
});
const inbox = createInbox({ bugframe: bf, siteName: process.env.BUGFRAME_SITE_NAME ?? 'Report inbox', loginUrl: owner ? '/owner' : process.env.BUGFRAME_LOGIN_URL });
const api = toNodeListener(bf, { trustProxy }), review = toNodeListener(inbox, { trustProxy });
const session = owner ? toNodeListener(owner, { trustProxy }) : null;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, origin).pathname;
    if (owner?.matches(path)) return await session(req, res);
    if (bf.matches(path)) {
      await api(req, res); console.info(JSON.stringify({ event: 'bugframe.request', method: req.method, path: path.endsWith('.png') ? '/api/bugframe/reports/:id/image.png' : path, status: res.statusCode })); return;
    }
    if (inbox.matches(path)) return await review(req, res);
    const files = { '/owner': ['login.html', 'text/html'], '/owner/login.js': ['login.js', 'text/javascript'], '/': ['demo.html', 'text/html'] };
    if (path === '/bugframe.min.js') {
      const access = await bf.handle(new Request(new URL('/api/bugframe/access', origin), { headers: req.headers }));
      if (!access.ok) { res.writeHead(401, headers); return res.end('Sign in first.'); }
      res.writeHead(200, { ...headers, 'content-type': 'text/javascript' }); return res.end(await readFile(new URL('../../dist/bugframe.min.js', import.meta.url)));
    }
    const file = files[path];
    if (!file || (path.startsWith('/owner') && !owner) || req.method !== 'GET') { res.writeHead(404, headers); return res.end('Not found'); }
    res.writeHead(200, { ...headers, ...(path === '/' ? { 'content-security-policy': headers['content-security-policy'].replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") } : {}), 'content-type': file[1] }); res.end(await readFile(new URL(file[0], import.meta.url)));
  } catch { res.writeHead(500, headers); res.end('Server request failed.'); }
});
const port = Number(process.env.PORT ?? 4455), host = process.env.HOST ?? '127.0.0.1';
server.listen(port, host, () => console.info(`Bugframe inbox on ${origin}/bugs/; reports in ${dataDir}. ${owner ? 'Retrieve the private owner-access.json key through your server file manager.' : 'Existing account authorization is required.'}`));
