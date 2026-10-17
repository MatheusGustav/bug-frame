import type { EnableMode } from './types';

export type EnableConfig = { enable: EnableMode | boolean; param: string; storageKey: string; search?: string; hash?: string };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, on: boolean) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* storage blocked: the switch will not stick */ } };

/** `bugs=1|0` from the query string (?bugs=1#/route) or from a hash route (#/route?bugs=1). */
export function readParam(param: string, search: string, hash: string): '1' | '0' | null {
  const v = new URLSearchParams(search).get(param) ?? new URLSearchParams(hash.split('?')[1] ?? '').get(param);
  return v === '1' || v === '0' ? v : null;
}

/** Resolves whether the widget should show right now. In 'query' mode a `?bugs=1` / `?bugs=0` is remembered until changed. */
export function resolveEnabled(c: EnableConfig): boolean {
  const { enable } = c;
  if (typeof enable === 'boolean') return enable;
  if (typeof enable === 'function') { try { return Boolean(enable()); } catch { return false; } }
  if (enable === 'always') return true;
  if (enable === 'never') return false;
  if (enable === 'query') {
    const p = readParam(c.param, c.search ?? (typeof location !== 'undefined' ? location.search : ''), c.hash ?? (typeof location !== 'undefined' ? location.hash : ''));
    if (p) write(c.storageKey, p === '1');
  }
  return read(c.storageKey) === '1';
}

export const setStored = write;
export const isStored = (key: string) => read(key) === '1';
