// A chart's size in cells of a virtual grid, which is never drawn. The gap between charts is one cell too, so sized charts line up across rows.
import { createContext } from 'react';

export const CELL = 24;
/** In cells. The smallest chart still shows a title, its menu and a plot. */
export const COLS = { min: 8, max: 100 };
export const ROWS = { min: 7, max: 60 };

/** A chart's saved size. A side that is absent follows the content. */
export type ChartSize = { cols?: number; rows?: number };
/** The sides a handle moves. */
export type Edge = 'e' | 's' | 'se';

const between = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));
/** The nearest whole number of cells, within the limits; `room` (px) caps it, never under the smallest. */
export const toCells = (px: number, limits: { min: number; max: number }, room = Number.POSITIVE_INFINITY): number =>
  between(Math.min(Math.round(px / CELL), Math.floor(room / CELL)), limits);

/** The size after a handle was moved by (dx, dy) px from a box of `w` by `h`. Only the sides the handle moves are set. */
export function dragged(size: ChartSize, edge: Edge, box: { w: number; h: number }, dx: number, dy: number, room: number): ChartSize {
  return {
    ...size,
    ...(edge !== 's' ? { cols: toCells(box.w + dx, COLS, room) } : {}),
    ...(edge !== 'e' ? { rows: toCells(box.h + dy, ROWS) } : {}),
  };
}

/** What is stored, with anything that is not a whole number of cells within the limits left out; undefined when nothing is left. */
export function cleanSize(v: unknown): ChartSize | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { cols, rows } = v as Record<string, unknown>;
  const ok = (n: unknown, l: { min: number; max: number }): n is number => Number.isInteger(n) && (n as number) >= l.min && (n as number) <= l.max;
  const out: ChartSize = { ...(ok(cols, COLS) ? { cols } : {}), ...(ok(rows, ROWS) ? { rows } : {}) };
  return out.cols === undefined && out.rows === undefined ? undefined : out;
}

/** The panel's width: the saved cells, else the width its content needs rounded up to whole cells; at most the whole cells the band has. */
export const panelWidth = (size: ChartSize, auto: string): string => `min(round(down, 100%, ${CELL}px), ${size.cols !== undefined ? `${size.cols * CELL}px` : `round(up, ${auto}, ${CELL}px)`})`;

/** What ChartsBody hands each panel; null outside it (a panel alone is not resizable). */
export type ChartFrame = {
  size: ChartSize;
  /** Resize mode is on: the panels show their handles. */
  resizing: boolean;
  onResize: (size: ChartSize) => void;
  /** Set while a drag is out: Escape calls it to put the size back. */
  cancelDrag: { current: (() => void) | null };
};
export const ChartFrameContext = createContext<ChartFrame | null>(null);
/** True inside a panel whose height is set: its chart fills the room it is given instead of taking its own height. */
export const FillContext = createContext(false);
