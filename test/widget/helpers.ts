export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
export const flush = async () => { for (let i = 0; i < 5; i++) await tick(0); };
export function shadow(): ShadowRoot { const host = document.querySelector('[data-bugframe]') as HTMLElement | null; if (!host?.shadowRoot) throw new Error('widget not mounted'); return host.shadowRoot; }
export const q = <T extends HTMLElement = HTMLElement>(sel: string) => shadow().querySelector(sel) as T | null;
export const reset = () => { document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* */ } history.replaceState(null, '', '/'); };
