import { vi } from 'vitest';
import { copyChart, inlineStyles } from './copyImage';

function section(withSvg = true) {
  const el = document.createElement('section');
  el.innerHTML = withSvg ? '<svg role="img" width="100" height="50" viewBox="0 0 100 50"><rect class="x" width="10" height="10" style="fill: var(--dm-series-1)"></rect></svg><ul class="dm-chart-legend"><li><span class="dm-chart-swatch" style="background: red"></span>A</li></ul>' : '<div>loading</div>';
  document.body.appendChild(el);
  return el;
}
const png = new Blob(['x'], { type: 'image/png' });

const urlOriginals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); URL.createObjectURL = urlOriginals.create; URL.revokeObjectURL = urlOriginals.revoke; document.body.innerHTML = ''; });

test('inlineStyles writes computed fill and stroke onto the clone', () => {
  const s = section();
  const svg = s.querySelector('svg')!;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ getPropertyValue: (p: string) => (p === 'fill' ? 'rgb(66, 134, 222)' : '') }) as never);
  const clone = svg.cloneNode(true) as SVGElement;
  inlineStyles(svg, clone);
  expect(clone.querySelector('rect')!.getAttribute('fill')).toBe('rgb(66, 134, 222)');
});

test('copyChart: nothing to copy without a chart SVG', async () => {
  expect(await copyChart(section(false), 'T')).toBe('empty');
});

test('copyChart: the PNG goes through the clipboard API when it is allowed', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('ClipboardItem', class { constructor(public items: object) {} });
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
  const mod = await import('./copyImage');
  vi.spyOn(mod.internals, 'render').mockResolvedValue(png);
  expect(await mod.copyChart(section(), 'T')).toBe('copied');
  expect(write).toHaveBeenCalledOnce();
});

test('copyChart: a blocked clipboard falls back to an HTML image, then to a download', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')) }, configurable: true });
  const mod = await import('./copyImage');
  vi.spyOn(mod.internals, 'render').mockResolvedValue(png);
  vi.spyOn(mod.internals, 'dataUrl').mockResolvedValue('data:image/png;base64,eA==');
  const html = vi.spyOn(mod.internals, 'copyHtml').mockReturnValueOnce(true).mockReturnValueOnce(false);
  const download = vi.spyOn(mod.internals, 'download').mockImplementation(() => {});
  expect(await mod.copyChart(section(), 'T')).toBe('copied');
  expect(html.mock.calls[0]![0]).toContain('<img src="data:image/png;base64,eA=="');
  expect(await mod.copyChart(section(), 'Sales / day')).toBe('downloaded');
  expect(download).toHaveBeenCalledWith(png, 'Sales - day.png');
});

test('copyHtml puts text/html and text/plain on the copy event', async () => {
  const mod = await vi.importActual<typeof import('./copyImage')>('./copyImage');
  const set = vi.fn();
  document.execCommand = vi.fn(() => { document.dispatchEvent(Object.assign(new Event('copy'), { clipboardData: { setData: set } })); return true; }) as never;
  expect(mod.internals.copyHtml('<img>', 'T')).toBe(true);
  expect(set).toHaveBeenCalledWith('text/html', '<img>');
  expect(set).toHaveBeenCalledWith('text/plain', 'T');
});

test('inlineStyles carries stroke-linejoin and stroke-linecap, so an exported pie keeps its round joins', () => {
  const s = section();
  const svg = s.querySelector('svg')!;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ getPropertyValue: (p: string) => (p === 'stroke-linejoin' ? 'round' : p === 'stroke-linecap' ? 'round' : p === 'fill' ? 'url("#dm-blank-x")' : '') }) as never);
  const clone = svg.cloneNode(true) as SVGElement;
  inlineStyles(svg, clone);
  expect(clone.querySelector('rect')!.getAttribute('stroke-linejoin')).toBe('round');
  expect(clone.querySelector('rect')!.getAttribute('stroke-linecap')).toBe('round');
  expect(clone.querySelector('rect')!.getAttribute('fill')).toBe('url("#dm-blank-x")');
});
