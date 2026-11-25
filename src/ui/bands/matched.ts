// How many records of each data mart in the report the grid's filters and slices keep, handed from the grid up to the cards.
import { uniqueKey } from '../../model/unique-count';
import type { Row } from '../../sdk/types';

/** The matched counts of the main mart's report, by alias path ('' is the main mart). Kept in the page's memory only: never saved, never an Undo step. */
export type Matched = { martId: string; byPath: ReadonlyMap<string, number> };

/** The counts of `paths` in the scorecard row, by path. A path whose count is missing or not a number is left out. */
export function matchedFrom(row: Row | undefined, paths: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!row) return out;
  for (const path of paths) {
    const value = row[uniqueKey(path)];
    const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
    if (Number.isFinite(n) && n >= 0) out.set(path, n);
  }
  return out;
}
