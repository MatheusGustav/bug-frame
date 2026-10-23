// Filesystem storage: one folder per report, <dir>/<id>/{report.json, region.png, full.png}. Nothing else is needed to run the tool.
import { mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ID_RE, FILE_NAMES, STATUSES } from './util.mjs';

/**
 * @param {{ dir: string }} options
 * @returns {import('../../types/server.js').StorageAdapter}
 */
export function createFileStorage({ dir }) {
  if (!dir) throw new Error('createFileStorage needs a dir');
  const root = resolve(dir);
  /** Resolve an id to its folder, refusing anything that is not exactly a report id. */
  const folderOf = id => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const p = resolve(root, id);
    return p.startsWith(root + sep) ? p : null;
  };
  const readJson = async folder => { try { return JSON.parse(await readFile(join(folder, 'report.json'), 'utf8')); } catch { return null; } };
  const writeJson = async (folder, data) => {
    const tmp = join(folder, `report.json.${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' }); await rename(tmp, join(folder, 'report.json'));
  };
  return {
    kind: 'filesystem', dir: root,
    async create(report, files) {
      const folder = folderOf(report.id); if (!folder) throw new Error('bad report id');
      await mkdir(root, { recursive: true, mode: 0o700 });
      try { await mkdir(folder, { mode: 0o700 }); } catch (e) { if (e?.code === 'EEXIST') { const err = new Error('exists'); err.code = 'EXISTS'; throw err; } throw e; }
      try {
        await writeFile(join(folder, 'region.png'), files.region, { mode: 0o600 }); await writeFile(join(folder, 'full.png'), files.full, { mode: 0o600 }); await writeJson(folder, report);
      } catch (e) { await rm(folder, { recursive: true, force: true }); throw e; }
    },
    async get(id) { const f = folderOf(id); return f ? readJson(f) : null; },
    async list() {
      let names = []; try { names = await readdir(root); } catch { return []; }
      const out = [];
      for (const n of names.filter(n => ID_RE.test(n))) { const r = await readJson(join(root, n)); if (r && r.id === n) out.push(r); }
      return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async update(id, patch) {
      const f = folderOf(id); if (!f) return null;
      const r = await readJson(f); if (!r) return null;
      const next = { ...r, ...patch, id: r.id };
      if (!STATUSES.includes(next.status)) throw new Error('bad status');
      await writeJson(f, next); return next;
    },
    async readFile(id, name) {
      const f = folderOf(id); if (!f || !FILE_NAMES.includes(name)) return null;
      try { return await readFile(join(f, name)); } catch { return null; }
    },
  };
}

/** In-memory storage for tests and demos. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    kind: 'memory',
    async create(report, files) { if (map.has(report.id)) { const e = new Error('exists'); e.code = 'EXISTS'; throw e; } map.set(report.id, { report: structuredClone(report), files }); },
    async get(id) { return map.get(id)?.report ? structuredClone(map.get(id).report) : null; },
    async list() { return [...map.values()].map(v => structuredClone(v.report)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); },
    async update(id, patch) { const v = map.get(id); if (!v) return null; v.report = { ...v.report, ...patch, id }; return structuredClone(v.report); },
    async readFile(id, name) { const v = map.get(id); return v && FILE_NAMES.includes(name) ? v.files[name === 'region.png' ? 'region' : 'full'] : null; },
  };
}
