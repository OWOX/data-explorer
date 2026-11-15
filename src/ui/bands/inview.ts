// One IntersectionObserver for every card: each asks to be told once, when it first scrolls near the viewport.
const callbacks = new WeakMap<Element, () => void>();
let shared: IntersectionObserver | null = null;
let sharedBy: typeof IntersectionObserver | null = null;
let sharedRoot: Element | null = null;

// The page scrolls inside the App's `[data-scroll-root]` element, not the viewport, so that element is the
// observer's root: against the viewport the 200px margin would never reach the clipped content.

function observer(root: Element | null): IntersectionObserver {
  // Keyed on the constructor so a stubbed one (tests) never reuses an observer built from another.
  if (!shared || sharedBy !== IntersectionObserver || sharedRoot !== root) {
    sharedBy = IntersectionObserver;
    sharedRoot = root;
    shared = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = callbacks.get(entry.target);
        shared?.unobserve(entry.target);
        callbacks.delete(entry.target);
        cb?.();
      }
    }, { root, rootMargin: '200px' });
  }
  return shared;
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
