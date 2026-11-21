// Suggested values for a text filter input: the query that reads them and the pure text edits that pick one.
import type { Field } from '../model/types';
import type { TraverseFilter, TraverseOptions } from '../sdk/types';

export const SUGGEST_LIMIT = 50;
/** The row key of the mart's unique count: the order the values come in. */
const COUNT_KEY = 'Unique Count';

/** The operators whose value is a list (`a, b` reads as `in`), so a pick adds to what is typed. The others take one text: a pick replaces it. */
export const LIST_OPS: ReadonlySet<string> = new Set(['eq', 'neq']);

/** Values are suggested for text columns only. */
export const canSuggest = (field: Field): boolean => field.category === 'string';

/**
 * The distinct values of a column, most rows first, under `filter` (the grid's rules without this column's own). A HAVING rule does not
 * apply to a read of one column, so it is dropped; blank values are left out. The count is the mart's unique count, so the mart needs a primary key.
 */
export function valuesQuery(field: Field, filter: TraverseFilter[]): TraverseOptions {
  const kept: TraverseFilter[] = [...filter.filter((f) => !f.function), { column: field.name, operator: 'is_not_blank' }];
  return { column: [field.name], uniqueCount: [''], sort: [{ column: COUNT_KEY, direction: 'desc' }], filter: kept, limit: SUGGEST_LIMIT };
}

/** The values of a values read, in row order: text, no blanks, none twice. */
export function valuesOf(rows: Record<string, unknown>[], field: Field): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[field.name];
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s.trim() !== '') seen.add(s);
  }
  return [...seen];
}

/** What is typed, split at commas and trimmed; empty pieces dropped. */
export const tokensOf = (text: string): string[] => text.split(',').map((t) => t.trim()).filter(Boolean);

/** The text after the last comma, trimmed: what narrows the list. */
export const lastToken = (text: string): string => text.slice(text.lastIndexOf(',') + 1).trim();

const finished = (text: string): string[] => tokensOf(text.slice(0, text.lastIndexOf(',') + 1));

/** The options that contain the text after the last comma (case-insensitive), minus values already in the text. */
export function narrow(options: string[], text: string): string[] {
  const q = lastToken(text).toLowerCase();
  const have = new Set(finished(text).map((t) => t.toLowerCase()));
  return options.filter((o) => !have.has(o.toLowerCase()) && o.toLowerCase().includes(q));
}

/**
 * The text with `value` added to the values already typed, separated by ", " and ending in ", " so the next pick or word follows.
 * The half-typed piece after the last comma is what the pick completes. A value already typed leaves the text as it was.
 */
export function addValue(text: string, value: string): string {
  const done = finished(text);
  if (done.some((t) => t.toLowerCase() === value.toLowerCase())) return text;
  return `${[...done, value].join(', ')}, `;
}
