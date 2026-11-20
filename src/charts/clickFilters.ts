import type { ColumnFilter } from '../filters/build';
import type { DateBucket } from '../model/aggregation';
import { addDays, ymd } from '../model/day';
import type { Field } from '../model/types';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The last day of the bucket that starts on `start` (its `YYYY-MM-DD` part). Date arithmetic on the label only, in UTC so the local zone never shifts a day. */
export function bucketEnd(start: string, bucket: DateBucket): string {
  const [y, m, d] = ymd(start)!;
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

const BUCKET_LABEL = /^\d{4}-\d{2}-\d{2}/;
/** Whether a bucket's x is a date label; a blank bucket reads "null" and has no range to filter to. */
export const isBucketDate = (x: string): boolean => BUCKET_LABEL.test(x);

/** `ts` (UTC ms) as the wall clock in `zone`, read back as if it were UTC: the difference to `ts` is the zone's offset then. */
function zoneOffset(ts: number, zone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ts)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - ts;
}

/** The UTC instant (ms) of 00:00 on the calendar day `day` (`YYYY-MM-DD`) in `zone`, DST-aware. */
function localMidnight(day: string, zone: string): number {
  const [y, m, d] = ymd(day)!;
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffset(guess, zone);
  const second = guess - zoneOffset(first, zone);
  // The offsets a day either side catch a midnight that a DST change skips or repeats: the earliest candidate on the target day is its first moment.
  const before = guess - zoneOffset(guess - 86_400_000, zone);
  const after = guess - zoneOffset(guess + 86_400_000, zone);
  const onDay = (ms: number) => new Date(ms + zoneOffset(ms, zone)).toISOString().slice(0, 10) === day;
  return [first, second, before, after].sort((a, b) => a - b).find(onDay) ?? second;
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * The grid filter for a click on a time-series bucket. Unzoned: the date column between the bucket's first and last day.
 * Zoned (`zone`, the one the series was bucketed in): UTC instants, from the bucket's local midnight to one second before the next one.
 */
export function bucketFilter(date: Field, start: string, bucket: DateBucket, zone?: string): ColumnFilter {
  const from = start.slice(0, 10);
  const to = bucketEnd(start, bucket);
  if (!zone) return { field: date.name, op: 'between', value: { from, to } };
  return { field: date.name, op: 'between', value: { from: stamp(localMidnight(from, zone)), to: stamp(localMidnight(addDays(to, 1), zone) - 1000) } };
}
