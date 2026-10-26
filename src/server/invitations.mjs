// Invitations grant reporting permission to an existing, verified account. They never create login sessions.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ID = /^invite-[a-f0-9]{32}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
export const invitationEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
export const invitationSummary = ({ id, email, createdAt, expiresAt, status, acceptedAt }) => ({ id, email, createdAt, expiresAt, status, ...(acceptedAt ? { acceptedAt } : {}) });

/** Private persistent invitation records, separate from report folders. One server process per directory. */
export function createFileInvitationStorage({ dir }) {
  if (!dir) throw new Error('An invitation directory is required.');
  const get = async id => { if (!ID.test(id)) return null; try { return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  return {
    async list() {
      let names;
      try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return (await Promise.all(names.filter(name => ID.test(name.slice(0, -5)) && name.endsWith('.json')).map(name => get(name.slice(0, -5))))).filter(Boolean);
    },
    get,
    async set(record) {
      if (!ID.test(record.id)) throw new Error('Invalid invitation id.');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = join(dir, `${record.id}.${randomBytes(8).toString('hex')}.tmp`);
      try { await writeFile(tmp, JSON.stringify(record), { mode: 0o600, flag: 'wx' }); await rename(tmp, join(dir, `${record.id}.json`)); }
      finally { await rm(tmp, { force: true }); }
    },
  };
}
export function createMemoryInvitationStorage() {
  const records = new Map();
  return { async list() { return [...records.values()].map(record => structuredClone(record)); }, async get(id) { return structuredClone(records.get(id) ?? null); }, async set(record) { records.set(record.id, structuredClone(record)); } };
}

export function invitationService(storage, now) {
  // Serialize acceptance/revocation so a token cannot be consumed twice in this instance.
  let tail = Promise.resolve();
  const serial = operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  const live = record => record.status !== 'revoked' && Date.parse(record.expiresAt) > now().getTime();
  return {
    async allows(who) {
      if (!who.emailVerified || !who.email) return false;
      return (await storage.list()).some(record => live(record) && record.status === 'accepted' && record.reporter === who.reporter && record.email === who.email);
    },
    async list() { return (await storage.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(invitationSummary); },
    create(email, days) { return serial(async () => {
      const records = await storage.list();
      if (records.some(record => live(record) && record.email === email)) return { error: 'already_invited' };
      if (records.filter(live).length >= 1000) return null;
      const date = now(), token = randomBytes(32).toString('hex');
      const record = { id: `invite-${randomBytes(16).toString('hex')}`, email, tokenHash: hash(token), createdAt: date.toISOString(), expiresAt: new Date(date.getTime() + days * 86400000).toISOString(), status: 'pending' };
      await storage.set(record); return { ...invitationSummary(record), token };
    }); },
    accept(token, who) { return serial(async () => {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !who?.emailVerified || !who.email) return false;
      const record = (await storage.list()).find(record => record.status === 'pending' && live(record) && record.tokenHash === hash(token) && record.email === who.email);
      if (!record) return false;
      const { tokenHash: _consumed, ...rest } = record;
      await storage.set({ ...rest, status: 'accepted', reporter: who.reporter, acceptedAt: now().toISOString() }); return true;
    }); },
    revoke(id) { return serial(async () => {
      if (!ID.test(id)) return null;
      const record = await storage.get(id); if (!record) return null;
      const { tokenHash: _token, ...rest } = record;
      const next = { ...rest, status: 'revoked' }; await storage.set(next); return invitationSummary(next);
    }); },
  };
}
