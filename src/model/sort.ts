import type { Schema } from './types';

export type SortDirection = 'asc' | 'desc';
/** One sorted column; the list's order is the order of precedence. */
export type SortKey = { field: string; direction: SortDirection };

/** none -> ascending -> descending -> none. A cycled column keeps its place; a removed one drops out. */
export function cycleSort(sorts: SortKey[], field: string): SortKey[] {
  const cur = sorts.find((s) => s.field === field);
  if (!cur) return [...sorts, { field, direction: 'asc' }];
  if (cur.direction === 'asc') return sorts.map((s) => (s.field === field ? { field, direction: 'desc' } : s));
  return sorts.filter((s) => s.field !== field);
}

/** The sorts whose column is shown; a hidden column leaves no invisible ordering behind. */
export const sortsOnColumns = (sorts: SortKey[], columns: string[]): SortKey[] => (sorts.every((s) => columns.includes(s.field)) ? sorts : sorts.filter((s) => columns.includes(s.field)));

/**
 * The order a grid opens in when the member has set none: the first DATE, DATETIME or TIMESTAMP field,
 * newest first. A date among the columns on screen wins over one that is not shown; else the first in
 * schema order. A mart with no date field has no default.
 */
export function defaultSort(schema: Schema, visible: string[]): SortKey[] {
  const dates = schema.filter((f) => f.category === 'date' && !f.isCalculated && !f.isHidden);
  const field = dates.find((f) => visible.includes(f.name)) ?? dates[0];
  return field ? [{ field: field.name, direction: 'desc' }] : [];
}
