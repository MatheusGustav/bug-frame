// Runs the demo page and the report API on one port: `npm run build && npm run example`, then open http://localhost:4455/?bugs=1
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createBugframe, toNodeListener } from '../../src/server/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4455);
const dir = process.env.BUGFRAME_DIR ?? join(here, 'reports');
const adminToken = process.env.BUGFRAME_ADMIN_TOKEN ?? 'demo-admin-token';

const bf = createBugframe({ dir, basePath: '/api/bugframe', clientTokens: ['demo-public-token'], adminToken, rateLimit: { max: 30, windowMs: 60_000 }, logger: (...a) => console.error('[bugframe]', ...a) });
const api = toNodeListener(bf);
const assets = { '/': ['index.html', 'text/html; charset=utf-8', here], '/bugframe.min.js': ['bugframe.min.js', 'text/javascript; charset=utf-8', join(here, '../../dist')] };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (bf.matches(path)) return api(req, res);
  const hit = assets[path];
  if (!hit) { res.statusCode = 404; return res.end('Not found'); }
  try { res.setHeader('content-type', hit[1]); res.end(await readFile(join(hit[2], hit[0]))); } catch { res.statusCode = 500; res.end('Run `npm run build` first.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo on http://127.0.0.1:${port}/?bugs=1  (reports go to ${dir}; admin token: ${adminToken})`));
