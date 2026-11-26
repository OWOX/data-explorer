import { afterEach, expect, test, vi } from 'vitest';
import { whenInView } from './inview';

afterEach(() => vi.unstubAllGlobals());

test('each scrolling root gets its own observer, and both fire', () => {
  const made: { root: Element | null; cb: (e: Partial<IntersectionObserverEntry>[]) => void }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: Partial<IntersectionObserverEntry>[]) => void, o: { root: Element | null }) { made.push({ root: o.root, cb }); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const a = document.createElement('div'); a.setAttribute('data-scroll-root', '');
  const b = document.createElement('div'); b.setAttribute('data-scroll-root', '');
  const x = document.createElement('p'); a.append(x);
  const y = document.createElement('p'); b.append(y);
  const x2 = document.createElement('p'); a.append(x2);
  document.body.append(a, b);
  const seenX = vi.fn(); const seenY = vi.fn(); const seenX2 = vi.fn();
  whenInView(x, seenX); whenInView(y, seenY); whenInView(x2, seenX2);
  expect(made.map((m) => m.root)).toEqual([a, b]);
  made[0]!.cb([{ target: x, isIntersecting: true }]);
  made[1]!.cb([{ target: y, isIntersecting: true }]);
  expect(seenX).toHaveBeenCalledTimes(1);
  expect(seenY).toHaveBeenCalledTimes(1);
  expect(seenX2).not.toHaveBeenCalled();
  a.remove(); b.remove();
});
