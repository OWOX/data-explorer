import { cleanup, render } from '@testing-library/react';
import { fillHeight, useFillHeight } from './useFillHeight';

function Band() {
  useFillHeight('band');
  return <main style={{ paddingBottom: '48px' }}><section id="band" /></main>;
}

test('the fill is the viewport below the band, less the page padding', () => {
  const { container } = render(<main style={{ paddingBottom: '48px' }}><section /></main>);
  const el = container.querySelector('section')!;
  el.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  expect(fillHeight(el)).toBe(552);
});

test('the hook writes --dm-fill and follows a resize', () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  const proto = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({ top: 200 }) as DOMRect;
  try {
    render(<Band />);
    const el = document.getElementById('band')!;
    expect(el.style.getPropertyValue('--dm-fill')).toBe('652px');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    window.dispatchEvent(new Event('resize'));
    expect(el.style.getPropertyValue('--dm-fill')).toBe('352px');
  } finally {
    HTMLElement.prototype.getBoundingClientRect = proto;
  }
});

test('a scrolled page measures the same: the top is the document top', () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  const { container } = render(<main style={{ paddingBottom: '48px' }}><section /></main>);
  const el = container.querySelector('section')!;
  // At the top of the page the band sits at 300; scrolled down 120 it reads 180 in the viewport.
  el.getBoundingClientRect = () => ({ top: 180 }) as DOMRect;
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
  try {
    expect(fillHeight(el)).toBe(552);
  } finally {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  }
});

test('only the siblings before the band are observed', () => {
  const seen: Element[] = [];
  const Real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(public cb: () => void) {} observe(e: Element) { seen.push(e); } unobserve() {} disconnect() {} } as never;
  try {
    render(<div><header id="a" /><section id="band" /><footer id="after" /></div>);
    function H() { useFillHeight('band'); return null; }
    render(<H />);
    expect(seen.map((e) => e.id)).toEqual(['a']);
  } finally {
    globalThis.ResizeObserver = Real;
  }
});

test('a band mounted above later is observed too, and the watchers are cleaned up', async () => {
  const seen: string[] = [];
  let disconnected = 0;
  const Real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(public cb: () => void) {} observe(e: Element) { seen.push(e.id); } unobserve() {} disconnect() { disconnected++; } } as never;
  try {
    const { container, unmount } = render(<div><header id="a" /><section id="band" /></div>);
    function H() { useFillHeight('band'); return null; }
    render(<H />);
    expect(seen).toEqual(['a']);
    const late = document.createElement('div');
    late.id = 'late';
    container.firstElementChild!.insertBefore(late, document.getElementById('band'));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain('late');
    unmount();
    cleanup();
    expect(disconnected).toBeGreaterThan(0);
  } finally {
    globalThis.ResizeObserver = Real;
  }
});
