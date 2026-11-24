import { useLatest } from '../useLatest';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** The room the title keeps in the full layout before the badges give up their text. */
const TITLE_MIN = 40;
/** Extra width the row needs to be back in the full layout once it is compact: stops a flip-flop at the edge. */
const HYSTERESIS = 8;

/**
 * Whether a title cell's badges show an icon instead of their text. `needed` is the width the full layout takes (measured while it was
 * shown). With no measurement (either width 0: no layout, as in jsdom) the answer is the full text. Once compact, it takes a little
 * more room than `needed` to return.
 */
export function badgesCompact(available: number, needed: number, wasCompact: boolean): boolean {
  if (available <= 0 || needed <= 0) return false;
  return available < (wasCompact ? needed + HYSTERESIS : needed);
}

/** The width the full layout needs: every child of the row but the title at its own width, the gaps, and the title's minimum. */
function neededWidth(row: HTMLElement): number {
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const kids = [...row.children] as HTMLElement[];
  return kids.filter((k) => !k.hasAttribute('data-title-text')).reduce((sum, k) => sum + k.offsetWidth, 0) + gap * Math.max(0, kids.length - 1) + TITLE_MIN;
}

/**
 * A data mart title cell's flex row. It tells its badges (through the render prop) to go compact when the cell is too narrow for them:
 * the width the full layout needs is measured whenever the row is not compact, and the row is compact while less than that is available.
 * The title's own element carries `data-title-text`, so it is left out of the measure.
 */
export function TitleRow({ children }: { children: (compact: boolean) => ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const needed = useRef(0);
  const now = useLatest(compact);
  const measure = () => {
    const el = row.current;
    if (!el) return;
    if (!now.current) needed.current = neededWidth(el);
    setCompact(badgesCompact(el.clientWidth, needed.current, now.current));
  };
  // After each render in the full layout the need may have changed (a badge came or went); a resize of the cell is watched too.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !row.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(row.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={row} className="flex min-w-0 items-center gap-1">{children(compact)}</div>;
}
