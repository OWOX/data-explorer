import { columnTitle } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row } from '../sdk/types';
import { displayText } from '../ui/format';

const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
/** Text a spreadsheet would run as a formula gets a leading apostrophe, so it pastes as text. Plain numbers stay as they are. */
const guard = (t: string) => (/^[=+\-@]/.test(t) && !PLAIN_NUMBER.test(t) ? `'${t}` : t);

/** One cell as the grid shows it, whole, with no tab or line break left in it and no formula start. */
export const cellText = (v: unknown, type?: string): string => guard(clean(displayText(v, type)));

/** The grid as tab-separated values with a header row of the column titles; lines end with `\n`. */
export function buildTsv(fields: Field[], rows: Row[]): string {
  const head = fields.map((f) => guard(clean(columnTitle(f)))).join('\t');
  return [head, ...rows.map((r) => fields.map((f) => cellText(r[f.name], f.type)).join('\t'))].join('\n');
}
