import { columnTitle } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row } from '../sdk/types';
import { displayText } from '../ui/format';

// Tabs and line breaks become spaces: Sheets and Excel do not reliably keep a quoted line break from plain text.
const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
// Text a spreadsheet would run as a formula, or read a leading ' of as its text prefix, gets a leading apostrophe.
// Plain numbers stay as they are. Full-width ＝＋－＠ are not covered on purpose: neither app evaluates them on paste.
const guard = (t: string) => (/^[=+\-@']/.test(t) && !PLAIN_NUMBER.test(t) ? `'${t}` : t);
// A field with a quote is written as a quoted field, so the apps keep the quotes and the next tab stays a separator.
const quote = (t: string) => (t.includes('"') ? `"${t.replace(/"/g, '""')}"` : t);
const field = (s: string) => quote(guard(clean(s)));

/** One cell as the grid shows it, whole, with no tab or line break left in it, no formula start and quotes escaped. */
export const cellText = (v: unknown, type?: string): string => field(displayText(v, type));

/** The grid as tab-separated values with a header row of the column titles; lines end with `\n`. */
export function buildTsv(fields: Field[], rows: Row[]): string {
  const head = fields.map((f) => field(columnTitle(f))).join('\t');
  return [head, ...rows.map((r) => fields.map((f) => cellText(r[f.name], f.type)).join('\t'))].join('\n');
}
