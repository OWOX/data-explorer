import { AGG_LABELS, formatBucket, outputsOf, type Aggregation, type AggFn, type DateBucket } from '../model/aggregation';
import { columnTitle } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row } from '../sdk/types';
import { displayText } from '../ui/format';

// Tabs and line breaks become spaces: Sheets and Excel do not reliably keep a quoted line break from plain text.
const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

// A grouped number ("-1,223.5") is a plain number too: spreadsheets read it as one.
const PLAIN_NUMBER = /^[+-]?((\d{1,3}(,\d{3})+|\d+)(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
// Text a spreadsheet would run as a formula, or read a leading ' of as its text prefix, gets a leading apostrophe.
// Plain numbers stay as they are. Full-width ＝＋－＠ are not covered on purpose: neither app evaluates them on paste.
const guard = (t: string) => (/^[=+\-@']/.test(t) && !PLAIN_NUMBER.test(t) ? `'${t}` : t);
// A field with a quote is written as a quoted field, so the apps keep the quotes and the next tab stays a separator.
const quote = (t: string) => (t.includes('"') ? `"${t.replace(/"/g, '""')}"` : t);
const field = (s: string) => quote(guard(clean(s)));

/** One cell as the grid shows it, whole, with no tab or line break left in it, no formula start and quotes escaped. */
export const cellText = (v: unknown, type?: string): string => field(displayText(v, type));

export type TsvColumn = { key: string; title: string; type?: string; bucket?: DateBucket };

/** The grid's columns as the grid shows them: one per column, or per function of an aggregated column ("Amount · Sum"). The title keeps the data mart prefix. */
export function tsvColumns(fields: Field[], agg?: Aggregation): TsvColumn[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  return outputsOf(fields.map((f) => f.name), agg ?? { aggregations: [], dateTrunc: [] }).map((o) => {
    const f = byName.get(o.column)!;
    return { key: o.key, title: o.fn ? `${columnTitle(f)} · ${AGG_LABELS[o.fn]}` : columnTitle(f), type: typeOf(f.type, o.fn), ...(o.bucket ? { bucket: o.bucket } : {}) };
  });
}

const typeOf = (type: string, fn: AggFn | undefined) => (fn === 'COUNT' || fn === 'COUNT_DISTINCT' ? 'INTEGER' : fn === 'STRING_AGG' ? 'STRING' : fn === 'AVG' || fn === 'P25' || fn === 'P50' || fn === 'P75' || fn === 'P95' ? 'FLOAT' : type);

/** The grid as tab-separated values with a header row of the column titles; lines end with `\n`. A grouped grid is copied as shown. */
export function buildTsv(columns: TsvColumn[], rows: Row[]): string {
  const head = columns.map((c) => field(c.title)).join('\t');
  const cell = (r: Row, c: TsvColumn) => (c.bucket ? field(formatBucket(r[c.key], c.bucket) ?? '') : cellText(r[c.key], c.type));
  return [head, ...rows.map((r) => columns.map((c) => cell(r, c)).join('\t'))].join('\n');
}
