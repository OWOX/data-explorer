import { vi } from 'vitest';
import { copyChart, copyHtml, inlineStyles } from './copyImage';

function section(withSvg = true) {
  const el = document.createElement('section');
  el.innerHTML = withSvg ? '<svg role="img" width="100" height="50" viewBox="0 0 100 50"><rect class="x" width="10" height="10" style="fill: var(--dm-series-1)"></rect></svg><ul class="dm-chart-legend"><li><span class="dm-chart-swatch" style="background: red"></span>A</li></ul>' : '<div>loading</div>';
  document.body.appendChild(el);
  return el;
}
const png = new Blob(['x'], { type: 'image/png' });

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

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

test('copyHtml puts text/html and text/plain on the copy event', () => {
  const set = vi.fn();
  document.execCommand = vi.fn(() => { document.dispatchEvent(Object.assign(new Event('copy'), { clipboardData: { setData: set } })); return true; }) as never;
  expect(copyHtml('<img>', 'T')).toBe(true);
  expect(set).toHaveBeenCalledWith('text/html', '<img>');
  expect(set).toHaveBeenCalledWith('text/plain', 'T');
});

test('copyImage strokes a bordered legend swatch and leaves a plain one unstroked', async () => {
  const el = document.createElement('section');
  el.innerHTML = '<svg role="img" width="100" height="50" viewBox="0 0 100 50"></svg><ul class="dm-chart-legend"><li><span class="dm-chart-swatch" style="background: red"></span>A</li><li><span class="dm-chart-swatch" style="background: #ddd; border: 1px solid rgb(10, 20, 30)"></span>(blank)</li></ul>';
  document.body.appendChild(el);
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'strokeRect' ? () => calls.push('strokeRect') : () => {}), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(png));
  vi.stubGlobal('Image', class { onload: () => void = () => {}; set src(_v: string) { queueMicrotask(() => this.onload()); } });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const mod = await import('./copyImage');
  await mod.internals.render(el, 'T');
  expect(calls).toEqual(['strokeRect']);
  vi.unstubAllGlobals();
});
