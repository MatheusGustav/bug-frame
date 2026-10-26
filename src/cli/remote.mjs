// Remote mode: the CLI commands against a hosted server's admin API instead of a local folder. The admin token only travels
// over HTTPS (plain HTTP just to localhost), redirects are refused, and downloads are checked like imports: exact ids, cleaned fields, real PNGs.
import { lstat, mkdir, readFile as readLocal, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ID_RE, FEEDBACK_KINDS, FILE_NAMES, STATUSES, cleanContext, isPng, text } from '../server/util.mjs';
import { CliError } from './commands.mjs';

const MAX_BYTES = 32 * 1024 * 1024, TIMEOUT_MS = 60_000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const status = s => (STATUSES.includes(s) ? s : 'open');
const activityOf = a => (Array.isArray(a) ? a : []).slice(-100).map(e => ({ status: status(e?.status), note: text(e?.note, 2000), at: text(e?.at, 40), by: e?.by === 'customer' ? 'customer' : 'developer' }));
const fields = r => ({ id: r.id, status: status(r.status), note: text(r.note, 2000), createdAt: text(r.createdAt, 40),
  description: text(r.description, 4000), types: (Array.isArray(r.types) ? r.types : []).slice(0, 8).map(t => text(t, 40)).filter(Boolean),
  kind: FEEDBACK_KINDS.includes(r.kind) ? r.kind : 'bug', currentText: text(r.currentText, 2000), suggestedText: text(r.suggestedText, 2000),
  reviewVersion: Number.isInteger(r.reviewVersion) && r.reviewVersion >= 0 ? r.reviewVersion : 0, reviewNote: text(r.reviewNote, 2000), activity: activityOf(r.activity) });
/** A list row, as the server summarizes it. */
const summaryOf = r => ({ ...fields(r), page: text(r.page, 120) });
/** A full report, with the same fields and limits the server and `import` keep. */
const reportOf = r => ({ ...fields(r), closedAt: text(r.closedAt, 40) || null, reporter: text(r.reporter, 300), context: cleanContext(r.context), files: { region: 'region.png', full: 'full.png' } });
/** A problem with one report only: export skips it and goes on with the others. */
const broken = message => Object.assign(new CliError(message), { skip: true });

/**
 * The remote server's admin token: BUGFRAME_REMOTE_TOKEN, else adminToken from a private credential file (--credentials,
 * BUGFRAME_CREDENTIALS_FILE or ~/.config/bugframe/credentials.json). Never BUGFRAME_ADMIN_TOKEN: that is this machine's own server secret.
 */
export async function remoteCredentials(file, env = process.env) {
  const explicit = file ?? env.BUGFRAME_CREDENTIALS_FILE;
  const token = env.BUGFRAME_REMOTE_TOKEN || (await credentialFile(explicit || join(homedir(), '.config', 'bugframe', 'credentials.json'), Boolean(explicit)))?.adminToken;
  if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /[^\x21-\x7e]/.test(token))) throw new CliError('The admin token for --remote is malformed.');
  return token || undefined;
}

const isPrivate = stat => process.platform === 'win32' || (!(stat.mode & 0o077) && stat.uid === process.getuid());

/** The parsed credential file, or undefined when the default one does not exist. Only a private, user-owned regular file is read. */
async function credentialFile(path, explicit) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 16384 || !isPrivate(stat)) throw new CliError('The credential file must be a private, user-owned file (chmod 600), not a symlink.');
    return JSON.parse(await readLocal(path, 'utf8'));
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error.code !== 'ENOENT' || explicit) throw new CliError('Could not read the private credential file.');
  }
}

/** The API address, refusing anything that would expose the admin token. */
function apiAddress(url) {
  let u;
  try { u = new URL(url); } catch { throw new CliError('--remote needs the API address, like https://www.example.com/api/bugframe'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.includes(u.hostname))) throw new CliError('--remote must use https:// so the admin token is never sent in clear text (http:// works only for localhost).');
  if (u.username || u.password) throw new CliError('--remote must not carry a user name or password in the address. Put the admin token in BUGFRAME_REMOTE_TOKEN or --credentials.');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

/**
 * @param {{ url: string, token?: string, timeoutMs?: number }} options  the API address (the widget's data-endpoint), the server's admin token
 *   and how long one request may take
 */
export function createRemote({ url, token, timeoutMs = TIMEOUT_MS }) {
  const api = apiAddress(url);
  if (!token) throw new CliError("--remote needs the server's admin token: set BUGFRAME_REMOTE_TOKEN or put adminToken in a private credential file (--credentials).");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new CliError('--timeout must be between 1 and 300000 milliseconds.');
  const notApi = () => new CliError(`${api} did not answer like a Bugframe server. Use the widget's data-endpoint address, like https://www.example.com/api/bugframe`);

  async function read(res) {
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new CliError(`${api} sent more than 32 MB.`);
    const chunks = []; let size = 0;
    try {
      for await (const chunk of res.body ?? []) { size += chunk.length; if (size > MAX_BYTES) throw new CliError(`${api} sent more than 32 MB.`); chunks.push(chunk); }
    } catch (e) { throw e instanceof CliError ? e : new CliError(`Lost the connection to ${api}: ${e?.message}`); }
    return Buffer.concat(chunks);
  }
  const readJson = async res => { const buf = await read(res); try { return JSON.parse(buf.toString('utf8')); } catch { return null; } };

  const unreachable = e => new CliError(e?.name === 'TimeoutError' ? `${api} did not answer within ${timeoutMs} ms (--timeout).`
    : /redirect/i.test(e?.cause?.message) ? `${api} answered with a redirect, which remote mode never follows. Use the exact API address.`
      : `Could not reach ${api}: ${e?.cause?.message ?? e?.message}`);

  /** The response, or null for 404. Refused credentials and server errors become plain CLI errors. */
  async function call(path, init = {}) {
    let res;
    try { res = await fetch(api + path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw unreachable(e); }
    if (res.status === 401 || res.status === 403) throw new CliError(`${api} refused the admin token (HTTP ${res.status}).`);
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
    if (!res.ok) { const code = (await readJson(res).catch(() => null))?.error; throw new CliError(`${api} answered HTTP ${res.status}${typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? ` (${code})` : ''}.`); }
    return res;
  }

  /** Every report, as the server's short summaries, newest first. */
  async function list() {
    const res = await call('/reports?all=1'), data = res && await readJson(res);
    if (!Array.isArray(data?.reports)) throw notApi();
    return data.reports.filter(r => ID_RE.test(r?.id)).map(summaryOf);
  }

  async function get(id) {
    if (!ID_RE.test(id)) return null;
    const res = await call(`/reports/${id}`); if (!res) return null;
    const raw = await readJson(res);
    if (raw?.id !== id) throw notApi();
    return reportOf(raw);
  }

  async function readFile(id, name) {
    if (!ID_RE.test(id) || !FILE_NAMES.includes(name)) return null;
    const res = await call(`/reports/${id}/${name}`); if (!res) return null;
    const buf = await read(res);
    if (!isPng(buf, MAX_BYTES)) throw broken(`${api} sent a ${name} for ${id} that is not a PNG picture`);
    return buf;
  }

  /** The server replaces the note on every change, so a status-only change (reopen) sends the current note back. */
  async function update(id, patch) {
    if (!ID_RE.test(id)) return null;
    const note = patch.note ?? (await get(id))?.note;
    if (note === undefined) return null;
    const res = await call(`/reports/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: patch.status, note }) });
    if (!res) return null;
    const out = await readJson(res);
    if (out?.id !== id) throw notApi();
    return out;
  }

  /** Save one report into <dir>/<id>/ (pictures first, report.json last) and return it, or null when the server has no such report. */
  async function download(id, dir) {
    const report = await get(id); if (!report) return null;
    const folder = join(resolve(dir), id), existing = await readLocal(join(folder, 'report.json'), 'utf8').then(JSON.parse, () => null);
    if (existing && !existing.downloadedFrom) throw new CliError(`${folder} holds a report that was not downloaded (is --dir the server's own folder?). Use another --dir for remote mode.`);
    const [region, full] = await Promise.all(FILE_NAMES.map(name => readFile(id, name)));
    if (!region || !full) throw broken(`${api} has no pictures for ${id}`);
    const copy = { ...report, downloadedFrom: api };
    await mkdir(folder, { recursive: true });
    for (const [name, data] of [['region.png', region], ['full.png', full], ['report.json', JSON.stringify(copy, null, 2)]]) {
      const tmp = join(folder, `${name}.${randomBytes(4).toString('hex')}.tmp`);
      await writeFile(tmp, data); await rename(tmp, join(folder, name));
    }
    return copy;
  }

  return { kind: 'remote', url: api, list, get, readFile, update, download };
}
