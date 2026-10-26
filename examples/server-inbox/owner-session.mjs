// Optional single-owner demonstration. Production apps with users should keep their existing authorize hook.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest();
const sessionKey = value => digest(value).toString('hex');
const WINDOW = 900000, SESSION_MS = 28800000;
const isPrivate = stat => process.platform === 'win32' || (!(stat.mode & 0o077) && stat.uid === process.getuid());

/** The configured key, or the one kept in a private owner-access.json (created on first start). */
async function ownerKey(file, adminToken) {
  if (adminToken) return adminToken;
  try { await writeFile(file, JSON.stringify({ adminToken: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 4096 || !isPrivate(stat)) throw new Error('Owner access file must be private and owned by the runtime user (chmod 600).');
  return JSON.parse(await readFile(file, 'utf8')).adminToken;
}

/** True when this IP already used its 5 sign-in attempts in the last 15 minutes; otherwise counts this one. */
function tooManyAttempts(attempts, ip, now) {
  for (const [key, times] of attempts) if (!times.some(t => t > now - WINDOW)) attempts.delete(key);
  const hits = (attempts.get(ip) ?? []).filter(t => t > now - WINDOW);
  if (hits.length >= 5 || attempts.size >= 5000) return true;
  attempts.set(ip, [...hits, now]);
  return false;
}

/** The submitted key from a JSON body of at most 4 KB, or an HTTP status to answer with. */
async function submittedKey(req) {
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') return { status: 415 };
  if (!req.body) return { status: 400 };
  const chunks = []; let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > 4096) { await reader.cancel(); return { status: 413 }; } chunks.push(value);
  }
  try { return { key: JSON.parse(Buffer.concat(chunks).toString()).key }; } catch { return { status: 400 }; }
}

export async function ownerSessions({ dataDir, origin, adminToken }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  adminToken = await ownerKey(join(dataDir, 'owner-access.json'), adminToken);
  if (typeof adminToken !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(adminToken)) throw new Error('Use a random owner/admin key of at least 32 characters.');
  const sessions = new Map(), attempts = new Map();
  const cookie = 'bugframe_owner';
  const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  const current = req => {
    const token = req.headers.get('cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(cookie + '='))?.slice(cookie.length + 1);
    const key = token ? sessionKey(token) : null, session = sessions.get(key);
    if (!session || session <= Date.now()) { sessions.delete(key); return null; }
    return key;
  };
  const authorize = req => current(req) ? { id: 'demo-owner', role: 'admin' } : null;
  const matches = input => new URL(input, origin).pathname === '/owner/session';
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const result = (status, extra = {}) => new Response(JSON.stringify({ ok: status === 200 }), { status, headers: { ...headers, ...extra } });

  async function signIn(req, ctx) {
    const now = Date.now();
    if (tooManyAttempts(attempts, ctx.ip ?? 'unknown', now)) return result(429, { 'retry-after': '900' });
    const { key, status } = await submittedKey(req);
    if (status) return result(status);
    if (typeof key !== 'string' || !timingSafeEqual(digest(key), digest(adminToken))) return result(401);
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
    if (sessions.size >= 1000) return result(429);
    const token = randomBytes(32).toString('hex'); sessions.set(sessionKey(token), now + SESSION_MS);
    return result(200, { 'set-cookie': `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}` });
  }

  async function handle(req, ctx = {}) {
    if (req.method === 'GET') return result(current(req) ? 200 : 401);
    if (!['POST', 'DELETE'].includes(req.method)) return result(405);
    if (req.headers.get('origin') !== origin) return result(403);
    if (req.method === 'POST') return signIn(req, ctx);
    sessions.delete(current(req));
    return result(200, { 'set-cookie': `${cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}` });
  }
  return { authorize, handle, matches, adminToken, basePath: '/owner/session' };
}
