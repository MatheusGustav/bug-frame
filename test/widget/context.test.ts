import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext, componentName, describeElements, domPath, installConsoleCapture, recentConsoleErrors, recordConsoleError, redactUrl, resetConsoleErrors } from '../../src/widget/context';
import { reset } from './helpers';

beforeEach(() => { reset(); resetConsoleErrors(); });
afterEach(() => { vi.useRealTimers(); delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint; });

describe('context', () => {
  it('redacts secret-looking query parameters', () => {
    expect(redactUrl('https://a.test/x?token=abc&page=2&API_KEY=z#/h')).toBe('https://a.test/x?token=%5Bredacted%5D&page=2&API_KEY=%5Bredacted%5D#/h');
    expect(redactUrl('not a url')).toBe('not a url');
    expect(redactUrl('https://a.test/?mine=1', ['mine'])).toContain('mine=%5Bredacted%5D');
  });
  it('names the component from the nearest data attribute', () => {
    document.body.innerHTML = '<section data-testid="invoice"><div><span id="t">hi</span></div></section>';
    expect(componentName(document.getElementById('t')!)).toBe('testid:invoice');
    expect(domPath(document.getElementById('t')!)).toBe('section > div > span#t');
  });
  it('describes elements under the box and hides masked text', () => {
    document.body.innerHTML = '<div id="a">Visible text</div><input id="b" data-bug-mask value="secret"><p id="c" data-bug-mask>Account 1234</p>';
    const stack = (id: string) => [document.getElementById(id)!, document.body, document.documentElement];
    let n = 0; const order = ['a', 'c', 'a', 'a', 'a'];
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => stack(order[n++ % order.length]);
    const out = describeElements({ x: 0, y: 0, w: 100, h: 100 }, '[data-bug-mask]');
    expect(out.find(e => e.path.includes('#a'))!.text).toBe('Visible text');
    expect(out.find(e => e.path.includes('#c'))!.text).toBe('');
  });
  it('ignores the tool\'s own UI', () => {
    document.body.innerHTML = '<div data-bug-ui id="ui">x</div>';
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => [document.getElementById('ui')!, document.body];
    expect(describeElements({ x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });
  it('records console errors only after install, and restores console', () => {
    const before = console.error; const spy = vi.fn(); console.error = spy;
    const off = installConsoleCapture();
    console.error('first', { a: 1 }, new Error('bad'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'uncaught', filename: 'http://x/app.js', lineno: 7 }));
    const list = recentConsoleErrors();
    expect(list.map(e => e.message)[0]).toContain('first {"a":1} Error: bad'); expect(list[1].message).toBe('uncaught (app.js:7)');
    expect(spy).toHaveBeenCalled();
    off(); expect(console.error).toBe(spy); console.error = before;
  });
  it('keeps only the last minute and 30 entries', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    recordConsoleError('old'); vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
    for (let i = 0; i < 40; i++) recordConsoleError(`m${i}`);
    const list = recentConsoleErrors(); expect(list.length).toBe(30); expect(list.some(e => e.message === 'old')).toBe(false);
  });
  it('buildContext gathers page facts and respects the console switch', () => {
    recordConsoleError('x'); history.replaceState(null, '', '/page?secret=1&a=2#/r'); document.title = 'T';
    const on = buildContext({ region: { x: 1, y: 2, w: 3, h: 4 }, metadata: { v: 1 }, includeConsole: true });
    expect(on.url).toContain('secret=%5Bredacted%5D'); expect(on.url).toContain('a=2'); expect(on.title).toBe('T'); expect(on.metadata).toEqual({ v: 1 }); expect(on.consoleErrors.length).toBe(1); expect(on.region).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(buildContext({ region: null, metadata: {}, includeConsole: false }).consoleErrors).toEqual([]);
  });
});
