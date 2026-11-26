import { AGG_LABELS, formatBucket, NO_AGGREGATION, outputsOf, outputType, type Aggregation, type DateBucket } from '../model/aggregation';
import { columnTitle } from '../model/fieldLabel';
import type { Field } from '../model/types';
import { uniqueField, uniqueKey, withUniqueAfter } from '../model/unique-count';
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
/** One value as a TSV field: tabs and line breaks become spaces, a formula start gets a leading apostrophe, and a value with a quote is quoted. */
export const tsvField = (s: string) => quote(guard(clean(s)));

/** One cell as the grid shows it (numbers ungrouped), whole, with no tab or line break left in it, no formula start and quotes escaped. */
// Numbers are copied as plain digits, not grouped as the grid shows them: see displayText.
export const cellText = (v: unknown, type?: string): string => tsvField(displayText(v, type, { group: false }));

export type TsvColumn = { key: string; title: string; type?: string; bucket?: DateBucket };

/**
 * The grid's columns as the grid shows them: one per column, or per function of an aggregated column ("Amount · Sum"). The title keeps the data mart prefix.
 * A data mart's Unique Count (`uniqueCount`, its alias paths) follows that mart's own columns, headed "Unique Count".
 */
export function tsvColumns(fields: Field[], agg?: Aggregation, uniqueCount: readonly string[] = []): TsvColumn[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const outputs = outputsOf(fields.map((f) => f.name), agg ?? NO_AGGREGATION);
  const cols = outputs.map((o): { col: TsvColumn; path: string; field: Field } => {
    const f = byName.get(o.column)!;
    return { col: { key: o.key, title: o.fn ? `${columnTitle(f)} · ${AGG_LABELS[o.fn]}` : columnTitle(f), type: outputType(f, o.fn), ...(o.bucket ? { bucket: o.bucket } : {}) }, path: f.joined?.aliasPath ?? '', field: f };
  });
  return withUniqueAfter(cols, (c) => c.path, uniqueCount, (path, last) => {
    const metric = uniqueField(path, { martId: last.field.joined?.martId ?? '', label: last.field.joined?.label ?? '' });
    return { col: { key: uniqueKey(path), title: columnTitle(metric), type: metric.type }, path, field: metric };
  }).map((c) => c.col);
}

/** The grid as tab-separated values with a header row of the column titles; lines end with `\n`. A grouped grid is copied as shown. */
export function buildTsv(columns: TsvColumn[], rows: Row[]): string {
  const head = columns.map((c) => tsvField(c.title)).join('\t');
  const cell = (r: Row, c: TsvColumn) => (c.bucket ? tsvField(formatBucket(r[c.key], c.bucket) ?? '') : cellText(r[c.key], c.type));
  return [head, ...rows.map((r) => columns.map((c) => cell(r, c)).join('\t'))].join('\n');
}
