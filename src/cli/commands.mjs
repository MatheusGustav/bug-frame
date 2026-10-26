import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createFileStorage } from '../server/storage-fs.mjs';
import { FEEDBACK_KINDS, ID_RE, FILE_NAMES, isOpen, isActionable, cleanContext, isPng, text } from '../server/util.mjs';
import { buildWorklist, oneLine, showText } from './worklist.mjs';
import { readZip } from './zip-read.mjs';

export class CliError extends Error {}

export function openStore(dir) { return createFileStorage({ dir }); }

const where = (dir, remote) => (remote ? `on ${remote.url}` : `in ${resolve(dir)}`);

/**
 * close, ready and reopen. In remote mode the server changes (and a downloaded copy follows); locally the folder changes, but never
 * a downloaded copy: only the server's report reaches the reporter. `local` adds what the server adds on its own (review version, history).
 */
async function change(dir, id, patch, { remote, command, local = () => ({}) }) {
  const store = openStore(dir), current = remote ? null : await store.get(id);
  if (current?.downloadedFrom) throw new CliError(`${id} is a copy downloaded from ${current.downloadedFrom}. Change it on the server: bugframe --remote ${current.downloadedFrom} ${command}`);
  const r = remote ? await remote.update(id, patch) : current && await store.update(id, { ...patch, ...local(current) });
  if (!r) throw new CliError(`No report with id ${id} ${where(dir, remote)}`);
  if (remote && (await store.get(id))?.downloadedFrom === remote.url) await store.update(id, { status: r.status, note: r.note, closedAt: patch.closedAt });
}

export async function cmdList(dir, { open = false, json = false, remote } = {}) {
  const rows = (await (remote ?? openStore(dir)).list()).filter(r => !open || isOpen(r.status));
  if (json) return JSON.stringify(rows, null, 2);
  if (!rows.length) return open ? 'No open bug reports.' : 'No bug reports.';
  return rows.map(oneLine).join('\n');
}

export async function cmdShow(dir, id, { json = false, remote } = {}) {
  const r = remote ? await remote.download(id, dir) : await openStore(dir).get(id);
  if (!r) throw new CliError(`No report with id ${id} ${where(dir, remote)}`);
  return json ? JSON.stringify(r, null, 2) : showText(r, resolve(dir));
}

export async function cmdExport(dir, { all = false, out, now, remote } = {}) {
  let rows = (await (remote ?? openStore(dir)).list()).filter(r => all || isActionable(r.status));
  const skipped = [];
  if (remote) {
    const copies = [];
    for (const { id } of rows) {
      try { const r = await remote.download(id, dir); if (r && (all || isActionable(r.status))) copies.push(r); }
      catch (e) { if (!e.skip) throw e; skipped.push(e.message); }
    }
    rows = copies;
  }
  const target = resolve(out ?? join(dir, 'WORKLIST.md'));
  await mkdir(join(target, '..'), { recursive: true });
  const body = buildWorklist(rows, { dir: resolve(dir), out: target, label: all ? 'total' : 'open', now, remote: remote?.url });
  await writeFile(target, body);
  const from = remote ? ` (downloaded from ${remote.url})` : '', none = `No ${all ? '' : 'open '}bug reports${remote ? ` on ${remote.url}` : ''}; wrote ${target}`;
  const skip = skipped.length ? `; skipped ${skipped.length} (${skipped.join('; ')})` : '';
  return { path: target, count: rows.length, skipped, message: (rows.length ? `Wrote ${target}: ${rows.length} report${rows.length === 1 ? '' : 's'}${from}` : none) + skip };
}

export async function cmdClose(dir, id, { note, status = 'fixed', remote } = {}) {
  if (!note || !String(note).trim()) throw new CliError('close needs --note "what changed"');
  if (!['fixed', 'wontfix'].includes(status)) throw new CliError('--status must be fixed or wontfix');
  if (!ID_RE.test(id)) throw new CliError(`Not a report id: ${id}`);
  await change(dir, id, { status, note: text(note, 2000), closedAt: new Date().toISOString() }, { remote, command: `close ${id} --note "..."` });
  return `${id} marked ${status}`;
}

/** Deliver verified work to its original reporter without claiming customer approval. */
export async function cmdReady(dir, id, { note, remote } = {}) {
  if (!note || !String(note).trim()) throw new CliError('ready needs --note "what changed and what to review"');
  if (!ID_RE.test(id)) throw new CliError(`Not a report id: ${id}`);
  const at = new Date().toISOString(), message = text(note, 2000).trim();
  await change(dir, id, { status: 'ready_for_review', note: message, closedAt: null }, { remote, command: `ready ${id} --note "..."`, local: current => ({
    reviewVersion: (current.reviewVersion ?? 0) + 1,
    activity: [...(current.activity ?? []), { status: 'ready_for_review', note: message, at, by: 'developer' }].slice(-100),
  }) });
  return `${id} ready for customer review`;
}

export async function cmdReopen(dir, id, { remote } = {}) {
  if (!ID_RE.test(id)) throw new CliError(`Not a report id: ${id}`);
  await change(dir, id, { status: 'open', closedAt: null }, { remote, command: `reopen ${id}` });
  return `${id} reopened`;
}

/** Unpack a .zip made by download mode into the reports folder. Only well-formed report folders are accepted. */
export async function cmdImport(dir, zipPath) {
  const entries = readZip(await readFile(zipPath));
  const byId = new Map();
  for (const e of entries) {
    const m = /^([^/\\]+)\/(report\.json|region\.png|full\.png)$/.exec(e.name);
    if (!m || !ID_RE.test(m[1])) continue;
    if (!byId.has(m[1])) byId.set(m[1], {});
    byId.get(m[1])[m[2]] = e.data;
  }
  const store = openStore(dir); const imported = [], skipped = [];
  for (const [id, f] of byId) {
    try {
      if (!f['report.json'] || !isPng(f['region.png']) || !isPng(f['full.png'])) throw new Error('incomplete or not PNG');
      const raw = JSON.parse(f['report.json'].toString('utf8'));
      const report = { id, status: 'open', note: '', createdAt: text(raw.createdAt, 40) || new Date().toISOString(), reporter: 'imported', description: text(raw.description, 4000).trim(), kind: FEEDBACK_KINDS.includes(raw.kind) ? raw.kind : 'bug', currentText: text(raw.currentText, 2000), suggestedText: text(raw.suggestedText, 2000), types: (Array.isArray(raw.types) ? raw.types : []).slice(0, 8).map(t => text(t, 40)), context: cleanContext(raw.context), files: { region: 'region.png', full: 'full.png' } };
      if (!report.description) throw new Error('no description');
      await store.create(report, { region: f['region.png'], full: f['full.png'] });
      imported.push(id);
    } catch (e) { skipped.push(`${id}: ${e.code === 'EXISTS' ? 'already imported' : e.message}`); }
  }
  void FILE_NAMES; void basename;
  return { imported, skipped, message: `Imported ${imported.length} report${imported.length === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.length} (${skipped.join('; ')})` : ''}` };
}
