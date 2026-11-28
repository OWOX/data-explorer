// Suggested values for a text filter input: the query that reads them and the pure text edits that pick one.
import type { Field } from '../model/types';
import { uniqueKey } from '../model/unique-count';
import type { TraverseFilter, TraverseOptions } from '../sdk/types';

export const SUGGEST_LIMIT = 50;

/**
 * The server's values per read key (mart, field and the other rules), kept for the browser session: a read is made once per key
 * until the member asks for a reload. Not tied to an open menu, so closing and reopening it does not query again.
 */
export const valueCache = new Map<string, string[]>();

/** `first` then `then`, each value once. */
export const mergeValues = (first: string[], then: string[]): string[] => [...new Set([...first, ...then])];

/** The operators whose value is a comma-separated list (is any of / is none of), so a pick adds to what is typed. The others take one text: a pick replaces it. */
export const LIST_OPS: ReadonlySet<string> = new Set(['in', 'not_in']);

/** Values are suggested for text columns only. */
export const canSuggest = (field: Field): boolean => field.category === 'string';

/**
 * The distinct values of a column, most rows first, under `filter` (the grid's rules without this column's own). A HAVING rule does not
 * apply to a read of one column, so it is dropped; blank values are left out. The count is the mart's unique count, so the mart needs a primary key.
 */
export function valuesQuery(field: Field, filter: TraverseFilter[]): TraverseOptions {
  const kept: TraverseFilter[] = [...filter.filter((f) => !f.function), { column: field.name, operator: 'is_not_blank' }];
  return { column: [field.name], uniqueCount: [''], sort: [{ column: uniqueKey(''), direction: 'desc' }], filter: kept, limit: SUGGEST_LIMIT };
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
 * The text with `value` added to the values already typed, separated by ", ". No comma trails the last value: it comes with the next one.
 * The half-typed piece after the last comma is what the pick completes. A value already typed leaves the values as they were.
 */
export function addValue(text: string, value: string): string {
  const done = finished(text);
  return (done.some((t) => t.toLowerCase() === value.toLowerCase()) ? done : [...done, value]).join(', ');
}

/**
 * The text a list's suggestions read: when the piece after the last comma is exactly a known value it is a finished pick, so a ", " is put after it
 * and the next pick or word follows.
 */
export function closePick(text: string, known: string[]): string {
  return known.includes(lastToken(text)) && lastToken(text) !== '' ? `${text.trimEnd()}, ` : text;
}

/**
 * Whether `text` still starts with the picked values in `base` followed by a comma (spaces around the comma do not matter).
 * A base that does not end in a separator is a single reopened value, so the text may also be just that value.
 */
export function keepsPicks(base: string, text: string): boolean {
  const toks = tokensOf(base);
  if (!toks.length) return false;
  const esc = toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const end = base.trimEnd().endsWith(',') ? ',' : '(?:,|$)';
  return new RegExp(`^\\s*${esc.join('\\s*,\\s*')}\\s*${end}`).test(text);
}
