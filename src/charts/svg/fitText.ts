const CHAR_W = 6;
const SIZE = 11;
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
export const textWidth = (text: string): number => measurer()?.measureText(text).width ?? text.length * CHAR_W;

/** `text` cut with an ellipsis so it is at most `room` px wide; the text itself when it fits. */
export function fitText(text: string, room: number): string {
  if (textWidth(text) <= room) return text;
  let n = text.length;
  while (n > 0 && textWidth(`${text.slice(0, n)}…`) > room) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}
