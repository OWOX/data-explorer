import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FillContext } from './resize';

/**
 * The wrapper's measured width, and its height inside a chart panel whose height is set (null elsewhere, and until measured).
 * The width is 600 until measured: jsdom has no layout, and the first paint needs some width.
 * While `active` is false the latest width is only remembered, so a consumer that does not draw (the grid in Table mode)
 * is not re-rendered by every resize; it catches up once when active turns true.
 */
export function useWidth<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  const fill = useContext(FillContext);
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState<number | null>(null);
  const latest = useRef<number | null>(null);
  const latestHeight = useRef<number | null>(null);
  const live = useRef(active);
  const filling = useRef(fill);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w <= 0) return;
      latest.current = w;
      latestHeight.current = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (live.current) setWidth(w);
      if (live.current && filling.current) setHeight(latestHeight.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Layout, so the catch-up width is in the same paint that turns Charts on.
  useLayoutEffect(() => {
    live.current = active;
    if (active && latest.current !== null) setWidth(latest.current);
  }, [active]);
  useLayoutEffect(() => {
    filling.current = fill;
    if (fill && latestHeight.current !== null) setHeight(latestHeight.current);
  }, [fill]);
  return { ref, width, height: fill ? height : null };
}
