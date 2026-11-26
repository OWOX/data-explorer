export type Box = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
export type Place = { left: number; top: number; side: 'left' | 'right' };

/** The gap a floating menu keeps from the viewport edge. */
export const EDGE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Where a menu opens under its control: left edges aligned, or right edges when it would run past the viewport (flip left);
 * below the control, or above it when there is no room below (flip up); never outside the viewport.
 */
export function placeBelow(anchor: Box, size: Size, view: Size, edge = EDGE): Place {
  let left = anchor.left;
  let side: Place['side'] = 'right';
  if (left + size.width > view.width - edge) { left = anchor.right - size.width; side = 'left'; }
  let top = anchor.bottom + 2;
  if (top + size.height > view.height - edge) {
    const above = anchor.top - 2 - size.height;
    top = above >= edge ? above : view.height - edge - size.height;
  }
  return { left: clamp(left, edge, view.width - edge - size.width), top: clamp(top, edge, view.height - edge - size.height), side };
}

/**
 * Where a submenu opens beside its row: to the right of the parent menu, or to the left when there is no room; its first row lines
 * up with the parent row (shifted by the panel's 8px padding), and it is pulled up when it would run past the bottom edge.
 */
export function placeBeside(row: Box, size: Size, view: Size, edge = EDGE): Place {
  let left = row.right;
  let side: Place['side'] = 'right';
  if (left + size.width > view.width - edge) { left = row.left - size.width; side = 'left'; }
  return { left: clamp(left, edge, view.width - edge - size.width), top: clamp(row.top - 8, edge, view.height - edge - size.height), side };
}
