// Node 25+ ships an experimental global `localStorage` that shadows jsdom's and is unusable without a flag. Use a plain in-memory shim.
function shim() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; } };
}
let ok = false; try { ok = typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function'; } catch { ok = false; }
if (!ok) { const s = shim(); Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true }); try { Object.defineProperty(window, 'localStorage', { value: s, configurable: true }); } catch { /* same object */ } }
