// What Ctrl/Cmd+C puts on the clipboard for the grid's selection: tab-separated text, as Google Sheets copies it.
import { tsvField } from '../../export/tsv';

type Cell = { row: number; col: number };
export type GridSelection = ({ kind: 'cell' } & Cell & { to?: Cell }) | { kind: 'col' | 'row'; from: number; to: number };

/** The rectangle a selection covers (inclusive), and whether it includes the column titles (whole columns do). */
export type Block = { r0: number; r1: number; c0: number; c1: number; header: boolean };

export function blockOf(sel: GridSelection, rowCount: number, colCount: number): Block | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  if (sel.kind === 'cell') {
    const end = sel.to ?? sel;
    return { r0: Math.min(sel.row, end.row), r1: Math.max(sel.row, end.row), c0: Math.min(sel.col, end.col), c1: Math.max(sel.col, end.col), header: false };
  }
  const lo = Math.min(sel.from, sel.to);
  const hi = Math.max(sel.from, sel.to);
  return sel.kind === 'col' ? { r0: 0, r1: rowCount - 1, c0: lo, c1: hi, header: true } : { r0: lo, r1: hi, c0: 0, c1: colCount - 1, header: false };
}

const toTsv = (rows: string[][]): string => rows.map((r) => r.map(tsvField).join('\t')).join('\n');

/** The text for a selection, or null when it covers nothing. `cell` and `header` give the text as it is displayed. */
export function selectionTsv(sel: GridSelection, size: { rows: number; cols: number }, read: { cell: (row: number, col: number) => string; header: (col: number) => string }): string | null {
  const b = blockOf(sel, size.rows, size.cols);
  if (!b) return null;
  const out: string[][] = [];
  const cols = Array.from({ length: b.c1 - b.c0 + 1 }, (_, i) => b.c0 + i);
  if (b.header) out.push(cols.map(read.header));
  for (let r = b.r0; r <= b.r1; r++) out.push(cols.map((c) => read.cell(r, c)));
  return toTsv(out);
}
