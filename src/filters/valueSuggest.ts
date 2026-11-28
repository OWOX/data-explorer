// Suggested values for a text filter input: the query that reads them and the pure text edits that pick one.
import type { Field } from '../model/types';
import { uniqueKey } from '../model/unique-count';
import { formatListText, listPieces, parseListText } from './list-text';
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

/** What is typed as its values: split at commas outside double quotes, trimmed, quotes removed; empty pieces dropped. */
export const tokensOf = parseListText;

/** The piece after the last comma outside quotes, as its value: what narrows the list. A quote left open runs to the end. */
export const lastToken = (text: string): string => parseListText(listPieces(text).at(-1)!.raw)[0] ?? '';

const finished = (text: string): string[] => listPieces(text).slice(0, -1).flatMap((p) => parseListText(p.raw));

/** The options that contain the text after the last comma (case-insensitive), minus values already in the text. */
export function narrow(options: string[], text: string): string[] {
  const q = lastToken(text).toLowerCase();
  const have = new Set(finished(text).map((t) => t.toLowerCase()));
  return options.filter((o) => !have.has(o.toLowerCase()) && o.toLowerCase().includes(q));
}

/**
 * The text with `value` added to the values already typed, separated by ", "; a value with a comma or a quote is written in double quotes.
 * No comma trails the last value: it comes with the next one. The half-typed piece after the last comma is what the pick completes.
 * A value already typed leaves the values as they were.
 */
export function addValue(text: string, value: string): string {
  const done = finished(text);
  return formatListText(done.some((t) => t.toLowerCase() === value.toLowerCase()) ? done : [...done, value]);
}

/**
 * The text a list's suggestions read: when the text is exactly `finished` (what the last pick produced, or the value the editor opened with)
 * its last piece is a finished pick, so a ", " is put after it and the next pick follows. Text typed by hand is never closed: it narrows by its last piece.
 */
export function closePick(text: string, finished: string | null): string {
  return finished !== null && text === finished && lastToken(text) !== '' ? `${text.trimEnd()}, ` : text;
}

/**
 * Whether `text` still starts with the picked values in `base` followed by a comma (spaces around the comma do not matter, a comma inside quotes is no separator).
 * A base that does not end in a separator is a single reopened value, so the text may also be just that value.
 */
export function keepsPicks(base: string, text: string): boolean {
  const want = parseListText(base);
  if (!want.length) return false;
  const pieces = listPieces(text);
  const open = listPieces(base).at(-1)!.raw.trim() !== '';
  if (pieces.length < want.length) return false;
  return want.every((w, i) => {
    const p = pieces[i]!;
    if (parseListText(p.raw)[0] !== w) return false;
    return p.ended || (i === want.length - 1 && open);
  });
}
