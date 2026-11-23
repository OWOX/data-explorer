const CHAR_W = 6;
const SIZE = 11;
const widths = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;

/** The 2D context text is measured with, once; null where there is no canvas (jsdom), so callers fall back to a per-character estimate. */
function measurer(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = null;
  if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return ctx;
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (c) { c.font = `${SIZE}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`; ctx = c; }
  } catch { /* no canvas: estimate */ }
  return ctx;
}

/** The width in px of a chart label (11px, the page font): measured on a canvas, else 6px per character. */
export function textWidth(text: string): number {
  const hit = widths.get(text);
  if (hit !== undefined) return hit;
  const w = measurer()?.measureText(text).width ?? text.length * CHAR_W;
  if (ctx) widths.set(text, w); // the font never changes, so a measured width is final; estimates are cheap
  return w;
}

/** `text` cut with an ellipsis so it is at most `room` px wide; the text itself when it fits. */
export function fitText(text: string, room: number): string {
  if (textWidth(text) <= room) return text;
  const chars = Array.from(text); // code points, so an emoji is never split
  let lo = 0; let hi = chars.length; // the longest prefix that fits, by binary search
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${chars.slice(0, mid).join('')}…`) <= room) lo = mid; else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}
