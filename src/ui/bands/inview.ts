// One IntersectionObserver for every card: each asks to be told once, when it first scrolls near the viewport.
const callbacks = new WeakMap<Element, () => void>();
let shared: IntersectionObserver | null = null;
let sharedBy: typeof IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  // Keyed on the constructor so a stubbed one (tests) never reuses an observer built from another.
  if (!shared || sharedBy !== IntersectionObserver) {
    sharedBy = IntersectionObserver;
    shared = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = callbacks.get(entry.target);
        shared?.unobserve(entry.target);
        callbacks.delete(entry.target);
        cb?.();
      }
    }, { rootMargin: '200px' });
  }
  return shared;
}

/** Calls `cb` once when `el` comes into view. Without IntersectionObserver the card counts as in view. Returns a cancel. */
export function whenInView(el: Element, cb: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb();
    return () => undefined;
  }
  const o = observer();
  callbacks.set(el, cb);
  o.observe(el);
  return () => { callbacks.delete(el); o.unobserve(el); };
}
