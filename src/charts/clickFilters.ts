import type { ColumnFilter } from '../filters/build';
import type { DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The last day of the bucket that starts on `start` (its `YYYY-MM-DD` part). Date arithmetic on the label only, in UTC so the local zone never shifts a day. */
export function bucketEnd(start: string, bucket: DateBucket): string {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number) as [number, number, number];
  const days = { DAY: 0, WEEK: 6 }[bucket as 'DAY' | 'WEEK'];
  if (days !== undefined) return iso(new Date(Date.UTC(y, m - 1, d + days)));
  const months = { MONTH: 1, QUARTER: 3, YEAR: 12 }[bucket as 'MONTH' | 'QUARTER' | 'YEAR'];
  // Day 0 of the next bucket's first month is this bucket's last day.
  return iso(new Date(Date.UTC(y, m - 1 + months, d - 1)));
}

/** The grid filter a click on one value of a dimension applies: `eq` for text, is true / is false for a boolean. */
export function dimensionFilter(dim: Field, value: string): ColumnFilter {
  if (dim.category === 'boolean') return { field: dim.name, op: value === 'true' ? 'is_true' : 'is_false' };
  return { field: dim.name, op: 'eq', value };
}

/** The grid filter for a click on a time-series bucket: the date column between the bucket's first and last day. */
export function bucketFilter(date: Field, start: string, bucket: DateBucket): ColumnFilter {
  return { field: date.name, op: 'between', value: { from: start.slice(0, 10), to: bucketEnd(start, bucket) } };
}
