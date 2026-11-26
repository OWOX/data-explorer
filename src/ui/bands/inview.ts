// One IntersectionObserver per scrolling root: each element asks to be told once, when it first scrolls near that root.
const callbacks = new WeakMap<Element, () => void>();
let made: typeof IntersectionObserver | null = null;
let observers = new WeakMap<Element | Document, IntersectionObserver>();
// A null root is the viewport; a Document stands for it as a map key.
const VIEWPORT = document;

// A page scrolls inside the nearest `[data-scroll-root]` element, not the viewport, so that element is the
// observer's root: against the viewport the 200px margin would never reach the clipped content.

function observer(root: Element | null): IntersectionObserver {
  // Keyed on the constructor so a stubbed one (tests) never reuses observers built from another.
  if (made !== IntersectionObserver) {
    made = IntersectionObserver;
    observers = new WeakMap();
  }
  let o = observers.get(root ?? VIEWPORT);
  if (!o) {
    const own: IntersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = callbacks.get(entry.target);
        own.unobserve(entry.target);
        callbacks.delete(entry.target);
        cb?.();
      }
    }, { root, rootMargin: '200px' });
    observers.set(root ?? VIEWPORT, own);
    o = own;
  }
  return o;
}

/** Calls `cb` once when `el` comes into view. Without IntersectionObserver the card counts as in view. Returns a cancel. */
export function whenInView(el: Element, cb: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb();
    return () => undefined;
  }
  const o = observer(el.closest('[data-scroll-root]'));
  callbacks.set(el, cb);
  o.observe(el);
  return () => { callbacks.delete(el); o.unobserve(el); };
}
