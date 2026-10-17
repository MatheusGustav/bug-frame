import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readParam, resolveEnabled } from '../../src/widget/enabled';
import { reset } from './helpers';

const cfg = { param: 'bugs', storageKey: 'bf:test' };
beforeEach(reset);

describe('enable modes', () => {
  it('query mode is off by default', () => { expect(resolveEnabled({ ...cfg, enable: 'query', search: '', hash: '' })).toBe(false); });
  it('?bugs=1 switches on and is remembered; ?bugs=0 switches off', () => {
    expect(resolveEnabled({ ...cfg, enable: 'query', search: '?bugs=1', hash: '' })).toBe(true);
    expect(resolveEnabled({ ...cfg, enable: 'query', search: '', hash: '' })).toBe(true);
    expect(resolveEnabled({ ...cfg, enable: 'query', search: '?bugs=0', hash: '' })).toBe(false);
    expect(resolveEnabled({ ...cfg, enable: 'query', search: '', hash: '' })).toBe(false);
  });
  it('reads the flag from a hash route too', () => { expect(readParam('bugs', '', '#/settings?bugs=1')).toBe('1'); expect(readParam('bugs', '?x=1', '')).toBeNull(); expect(readParam('bugs', '?bugs=yes', '')).toBeNull(); });
  it('storage mode ignores the query string', () => {
    expect(resolveEnabled({ ...cfg, enable: 'storage', search: '?bugs=1', hash: '' })).toBe(false);
    localStorage.setItem('bf:test', '1'); expect(resolveEnabled({ ...cfg, enable: 'storage' })).toBe(true);
  });
  it('always / never / boolean / function', () => {
    expect(resolveEnabled({ ...cfg, enable: 'always' })).toBe(true); expect(resolveEnabled({ ...cfg, enable: 'never' })).toBe(false);
    expect(resolveEnabled({ ...cfg, enable: true })).toBe(true); expect(resolveEnabled({ ...cfg, enable: () => true })).toBe(true);
    expect(resolveEnabled({ ...cfg, enable: () => { throw new Error('x'); } })).toBe(false);
  });
  it('survives blocked storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(resolveEnabled({ ...cfg, enable: 'storage' })).toBe(false);
  });
});
