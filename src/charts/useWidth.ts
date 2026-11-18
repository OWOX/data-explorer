import { useEffect, useRef, useState } from 'react';

/**
 * The wrapper's measured width. 600 until measured: jsdom has no layout, and the first paint needs some width.
 * While `active` is false the latest width is only remembered, so a consumer that does not draw (the grid in Table mode)
 * is not re-rendered by every resize; it catches up once when active turns true.
 */
export function useWidth<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  const latest = useRef<number | null>(null);
  const live = useRef(active);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w <= 0) return;
      latest.current = w;
      if (live.current) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    live.current = active;
    if (active && latest.current !== null) setWidth(latest.current);
  }, [active]);
  return { ref, width };
}
