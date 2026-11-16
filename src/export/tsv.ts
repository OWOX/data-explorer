import { columnTitle } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row } from '../sdk/types';
import { displayText } from '../ui/format';

const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

/** One cell as the grid shows it, whole, with no tab or line break left in it. */
export const cellText = (v: unknown, type?: string): string => clean(displayText(v, type));

/** The grid as tab-separated values with a header row of the column titles; lines end with `\n`. */
export function buildTsv(fields: Field[], rows: Row[]): string {
  const head = fields.map((f) => clean(columnTitle(f))).join('\t');
  return [head, ...rows.map((r) => fields.map((f) => cellText(r[f.name], f.type)).join('\t'))].join('\n');
}
