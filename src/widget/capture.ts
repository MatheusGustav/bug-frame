/* Renders the visible viewport to a PNG in the browser (html-to-image, MIT) and crops it to the chosen rectangle.
   Inputs and anything marked for masking are painted over *in the picture*, so nothing flashes on the page. */
import type { Rect } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** html-to-image clones the DOM, which loses the scroll position of inner scrollers: shift their children by hand while it runs. */
function freezeScrolled(): () => void {
  const undo: (() => void)[] = [];
  document.querySelectorAll<HTMLElement>('*').forEach(el => {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight && el !== document.documentElement && el !== document.body) {
      const shift = el.scrollTop;
      Array.from(el.children).forEach(child => { const c = child as HTMLElement, before = c.style.translate; c.style.translate = `0 ${-shift}px`; undo.push(() => { c.style.translate = before; }); });
    }
  });
  return () => undo.forEach(fn => fn());
}

export type CaptureOptions = { maxPixelRatio?: number; exclude?: string[] };

export async function captureViewport(opts: CaptureOptions = {}): Promise<string> {
  const { toPng } = await import('html-to-image');
  const w = window.innerWidth, h = window.innerHeight, pixelRatio = Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2);
  const exclude = (opts.exclude ?? []).filter(Boolean).join(',');
  const options = {
    width: w, height: h, pixelRatio, cacheBust: false, backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: 'top left', width: `${document.documentElement.scrollWidth}px`, height: `${document.documentElement.scrollHeight}px` },
    filter: (node: Node) => {
      if (!(node instanceof Element)) return true;
      if (node.hasAttribute('data-bug-ui')) return false;
      if (exclude) { try { if (node.matches(exclude)) return false; } catch { /* a bad selector is ignored */ } }
      return true;
    },
  };
  const restore = freezeScrolled();
  try {
    // Safari draws images late on the first render; a short first pass warms its cache, the second one is kept.
    try { await toPng(document.body, options); } catch { /* the second pass reports the real error */ }
    await sleep(60);
    return await toPng(document.body, options);
  } finally { restore(); }
}

/** Viewport rectangles to paint over: inputs, password fields, [data-bug-mask] and the host's own selectors. */
export function maskRects(opts: { maskInputs: boolean; selectors: string[] }): Rect[] {
  const selectors = ['[data-bug-mask]', 'input[type="password"]', ...opts.selectors];
  if (opts.maskInputs) selectors.push('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])', 'textarea', 'select', '[contenteditable=""]', '[contenteditable="true"]');
  const rects: Rect[] = [], seen = new Set<Element>();
  for (const sel of selectors.filter(Boolean)) {
    let list: Element[] = [];
    try { list = Array.from(document.querySelectorAll(sel)); } catch { continue; }
    for (const el of list) {
      if (seen.has(el) || el.closest('[data-bug-ui]')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return rects;
}
export const selectorList = (selectors: string[]) => ['[data-bug-mask]', 'input[type="password"]', ...selectors].join(',');

const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The screenshot could not be read.')); img.src = src; });

/** Paint opaque boxes over viewport rectangles (any capture scale). */
export async function maskImage(full: string, rects: Rect[], viewport: { w: number; h: number }): Promise<string> {
  if (!rects.length) return full;
  const img = await load(full), sx = img.naturalWidth / viewport.w, sy = img.naturalHeight / viewport.h;
  const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot mask the screenshot.');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '#3a3f4b';
  for (const r of rects) ctx.fillRect(Math.floor(r.x * sx), Math.floor(r.y * sy), Math.ceil(r.w * sx), Math.ceil(r.h * sy));
  return canvas.toDataURL('image/png');
}

/** Crop a full-viewport PNG to a viewport-pixel rectangle (works for any scale the capture used). */
export async function cropImage(full: string, rect: Rect, viewport: { w: number; h: number }): Promise<string> {
  const img = await load(full), sx = img.naturalWidth / viewport.w, sy = img.naturalHeight / viewport.h;
  const x = Math.max(0, Math.round(rect.x * sx)), y = Math.max(0, Math.round(rect.y * sy));
  const w = Math.max(1, Math.min(img.naturalWidth - x, Math.round(rect.w * sx))), h = Math.max(1, Math.min(img.naturalHeight - y, Math.round(rect.h * sy)));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot crop the screenshot.');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}
