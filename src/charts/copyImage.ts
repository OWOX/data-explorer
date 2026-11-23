// A chart as a PNG on the clipboard. The OWOX host grants clipboard-write only to privileged plugins (OWOX/owox-data-marts#1922),
// so a copy event with an HTML image follows, and a download when that fails too. Each route was checked against the host's frame.

const SCALE = 2;
const PAD = 16;
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'opacity', 'font-size', 'font-family', 'font-weight'] as const;

/** Writes each element's computed paint and font onto the clone, so the image needs no stylesheet or CSS variable. */
export function inlineStyles(source: SVGElement, clone: SVGElement): void {
  const from = [source, ...source.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) to[i]!.setAttribute(p, v);
    }
    to[i]!.removeAttribute('class');
  });
}

/** The swatch's outline colour, or null when it has none (only the blank colour's swatch has one). */
const swatchBorder = (el: Element): string | null => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? cs.borderTopColor : null; };
const loadImage = (url: string) => new Promise<HTMLImageElement>((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = url; });
const background = (el: HTMLElement): string => {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
  }
  return '#ffffff';
};

async function render(section: HTMLElement, title: string): Promise<Blob | null> {
  const svg = section.querySelector<SVGSVGElement>('svg[role]');
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width || Number(svg.getAttribute('width')) || 600));
  const h = Math.max(1, Math.round(box.height || Number(svg.getAttribute('height')) || 300));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const legend = [...section.querySelectorAll('.dm-chart-legend li')].map((li) => ({ color: getComputedStyle(li.querySelector('.dm-chart-swatch')!).backgroundColor, border: swatchBorder(li.querySelector('.dm-chart-swatch')!), text: li.textContent ?? '' }));
    const font = getComputedStyle(section).fontFamily || 'sans-serif';
    const fg = getComputedStyle(section).color || '#000';
    const titleH = 24;
    const legendH = legend.length ? Math.ceil(legend.length / 4) * 18 + 8 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = (w + PAD * 2) * SCALE;
    canvas.height = (titleH + h + legendH + PAD * 2) * SCALE;
    const g = canvas.getContext('2d')!;
    g.scale(SCALE, SCALE);
    g.fillStyle = background(section);
    g.fillRect(0, 0, w + PAD * 2, titleH + h + legendH + PAD * 2);
    g.fillStyle = fg;
    g.font = `600 14px ${font}`;
    g.textBaseline = 'top';
    g.fillText(title, PAD, PAD);
    g.drawImage(img, PAD, PAD + titleH, w, h);
    g.font = `12px ${font}`;
    legend.forEach((l, i) => {
      const x = PAD + (i % 4) * (w / 4);
      const y = PAD + titleH + h + 8 + Math.floor(i / 4) * 18;
      g.fillStyle = l.color;
      g.fillRect(x, y + 1, 10, 10);
      if (l.border) { g.strokeStyle = l.border; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 1.5, 9, 9); }
      g.fillStyle = fg;
      g.fillText(l.text, x + 16, y);
    });
    return await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dataUrl = (blob: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = fail; r.readAsDataURL(blob); });

/** The copy event route: needs no clipboard permission, carries text formats only. */
export function copyHtml(html: string, text: string): boolean {
  const on = (e: ClipboardEvent) => { e.preventDefault(); e.clipboardData?.setData('text/html', html); e.clipboardData?.setData('text/plain', text); };
  document.addEventListener('copy', on as EventListener, { once: true });
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', on as EventListener);
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim() || 'chart'}.png`;

/** Seams for tests: the canvas and file APIs jsdom lacks. */
export const internals = { render, dataUrl, copyHtml, download };

export async function copyChart(section: HTMLElement, title: string): Promise<'copied' | 'downloaded' | 'empty'> {
  const blob = await internals.render(section, title);
  if (!blob) return 'empty';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch { /* blocked by the host's permissions policy: next route */ }
  if (internals.copyHtml(`<img src="${await internals.dataUrl(blob)}" alt="${escapeAttr(title)}">`, title)) return 'copied';
  internals.download(blob, fileName(title));
  return 'downloaded';
}
