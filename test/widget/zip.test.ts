// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, dataUrlToBytes, makeZip } from '../../src/widget/zip';
// @ts-expect-error plain JS module
import { readZip } from '../../src/cli/zip-read.mjs';
// @ts-expect-error plain JS module
import { cmdImport, cmdList } from '../../src/cli/commands.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('zip', () => {
  it('crc32 matches the known value', () => { expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); });
  it('round-trips through the Node reader', () => {
    const zip = makeZip([{ name: 'a/x.txt', data: new TextEncoder().encode('hello') }, { name: 'a/y.png', data: dataUrlToBytes(PNG) }]);
    const out = readZip(Buffer.from(zip));
    expect(out.map((e: { name: string }) => e.name)).toEqual(['a/x.txt', 'a/y.png']);
    expect(out[0].data.toString()).toBe('hello'); expect(out[1].data.subarray(1, 4).toString()).toBe('PNG');
  });
  it('bugframe import unpacks a downloaded report and refuses junk entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-zip-'));
    const id = 'bug-20260101-120000-abcd', enc = (s: string) => new TextEncoder().encode(s);
    const zip = makeZip([
      { name: `${id}/report.json`, data: enc(JSON.stringify({ description: 'Looks wrong', types: ['Text'], createdAt: '2026-01-01T12:00:00Z', context: { url: 'https://a.test/x', evil: 1 } })) },
      { name: `${id}/region.png`, data: dataUrlToBytes(PNG) }, { name: `${id}/full.png`, data: dataUrlToBytes(PNG) },
      { name: '../../evil.txt', data: enc('x') }, { name: `${id}/extra.sh`, data: enc('x') },
      { name: 'bug-20260101-120000-eeee/report.json', data: enc('{}') },
    ]);
    const file = join(dir, 'r.zip'); await writeFile(file, zip);
    const res = await cmdImport(join(dir, 'reports'), file);
    expect(res.imported).toEqual([id]); expect(res.skipped.length).toBe(1);
    expect((await readdir(join(dir, 'reports', id))).sort()).toEqual(['full.png', 'region.png', 'report.json']);
    expect(await cmdList(join(dir, 'reports'), {})).toMatch(/Looks wrong/);
    expect((await cmdImport(join(dir, 'reports'), file)).skipped[0]).toMatch(/already imported/);
    await rm(dir, { recursive: true, force: true });
  });
});
