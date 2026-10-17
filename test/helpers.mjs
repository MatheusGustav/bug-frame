import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const PNG_URL = `data:image/png;base64,${PNG_B64}`;
export const tmpDir = () => mkdtemp(join(tmpdir(), 'bugframe-test-'));
export const cleanup = dir => rm(dir, { recursive: true, force: true });

export const body = (over = {}) => ({ description: 'The save button overlaps the footer', types: ['Wrong layout'], region: PNG_URL, full: PNG_URL,
  context: { url: 'https://app.test/settings?tab=billing&token=SECRET#/billing', title: 'Billing', viewport: { w: 1280, h: 720, dpr: 2 }, scroll: { x: 0, y: 40 }, region: { x: 10, y: 20, w: 300, h: 100 }, userAgent: 'UA', language: 'en', capturedAt: '2026-01-01T00:00:00Z', elements: [{ path: 'div#a > button.b', component: 'testid:save', text: 'Save' }], consoleErrors: [{ at: 'x', message: 'boom' }], metadata: { version: '1.2.3' } },
  ...over });

export const post = (url, data, headers = {}) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof data === 'string' ? data : JSON.stringify(data) });
