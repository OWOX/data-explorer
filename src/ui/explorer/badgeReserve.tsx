import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** A badge at rest: 1px border, 4px padding each side, a 12px icon. Kept in step with `.dm-rule-badge` in bands.css. */
export const BADGE_REST = 22;
/** The x an unfolded badge adds: 14px and its 1px margin. */
const X_WIDTH = 15;
/** The icon an unfolded badge drops for its label. */
const ICON = 12;

/**
 * How much wider than its rest width the widest badge gets unfolded: its label, its x when it has one, less the icon it hides.
 * The title cell reserves this much, so one unfolded badge never widens the column.
 */
export function unfoldExtra(badges: { label: number; x: boolean }[]): number {
  return Math.max(0, ...badges.map((b) => b.label + (b.x ? X_WIDTH : 0) - ICON));
}

/**
 * The badges of a data mart's title cell. Their row keeps room for all of them at rest plus the widest one unfolded (see bands.css), so
 * hovering one never changes the column's width. A label's scrollWidth is its full width even while folded, so the measure is the same at rest and on hover.
 */
export function BadgeRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const badges = [...el.querySelectorAll<HTMLElement>('.dm-rule-badge')];
      el.style.setProperty('--badge-count', String(badges.length));
      el.style.setProperty('--badge-extra', `${unfoldExtra(badges.map((b) => ({ label: b.querySelector<HTMLElement>('.dm-badge-label')?.scrollWidth ?? 0, x: !!b.querySelector('.dm-rule-badge-x') })))}px`);
    };
    measure();
    // A web font that arrives later changes the labels' widths.
    void document.fonts?.ready.then(() => { if (row.current) measure(); });
  });
  return <span ref={row} className="dm-badges">{children}</span>;
}
