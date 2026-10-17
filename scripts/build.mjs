// Builds dist/: an ES module (html-to-image stays a dependency), a self-contained minified script-tag bundle, and type declarations.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
const common = { entryPoints: ['src/widget/index.ts'], bundle: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };
const banner = { js: '/*! bugframe - MIT. Bundles html-to-image (MIT, (c) W.Y.). See THIRD_PARTY_NOTICES.md */' };
await build({ ...common, format: 'esm', outfile: 'dist/bugframe.mjs', external: ['html-to-image'], minify: false, sourcemap: true });
await build({ ...common, format: 'iife', globalName: 'Bugframe', outfile: 'dist/bugframe.min.js', minify: true, sourcemap: true, banner });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });

const sizes = {};
for (const f of ['dist/bugframe.min.js', 'dist/bugframe.mjs']) {
  const buf = readFileSync(f); sizes[f] = { bytes: statSync(f).size, gzip: gzipSync(buf, { level: 9 }).length };
}
writeFileSync('dist/size.json', JSON.stringify(sizes, null, 2));
for (const [f, s] of Object.entries(sizes)) console.log(`${f}: ${(s.bytes / 1024).toFixed(1)} KB, ${(s.gzip / 1024).toFixed(1)} KB gzip`);
