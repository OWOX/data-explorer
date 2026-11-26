import { allowedFunctions, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { bucketEnd } from './clickFilters';
import { addDays } from '../model/day';
import { pickBucket } from './fields';
import { monthsQuery, rangeKeys, rangeQuery } from './queries';
import { useChartQuery } from './useChartQuery';

/** The first day of the month after a month's start (from its YYYY-MM prefix): the last month spans to there, so month starts do not understate the span. Only used to pick a bucket. */
function monthEnd(v: unknown): unknown {
  const m = /^(\d{4}-\d{2})/.exec(String(v));
  return m ? addDays(bucketEnd(`${m[1]}-01`, 'MONTH'), 1) : v;
}

/**
 * The bucket the date charts use. A chosen bucket is used as it is; Auto reads the date's range once and picks the smallest
 * bucket with at most 60 buckets. `null` until it is known (or when there is no date, or the band is paused): the charts that
 * need it wait, so no query goes out with a guessed bucket.
 */
export function useBucket(martId: string, date: Field | null, chosen: DateBucket | 'AUTO', filter: TraverseFilter[], version: number, paused: boolean, hold = false) {
  // A date whose governance forbids MIN or MAX cannot be ranged (OWOX refuses the query): its distinct months give the range instead.
  const rangeable = !!date && ['MIN', 'MAX'].every((fn) => allowedFunctions(date).includes(fn as 'MIN' | 'MAX'));
  const auto = chosen === 'AUTO' && !!date && !paused;
  const read = useChartQuery(martId, auto ? (rangeable ? rangeQuery : monthsQuery)(date!, filter) : null, version, undefined, undefined, hold);
  let bucket: DateBucket | null = null;
  if (chosen !== 'AUTO') bucket = chosen;
  else if (date && read.rows) {
    if (rangeable) bucket = pickBucket(read.rows[0]?.[rangeKeys(date).min], read.rows[0]?.[rangeKeys(date).max]);
    else {
      // Oldest and newest month; a blank date sorts apart from them, so it is skipped.
      const seen = read.rows.map((x) => x[date.name]).filter((v) => v !== null && v !== undefined && v !== '');
      bucket = seen.length ? pickBucket(seen[0], monthEnd(seen[seen.length - 1])) : 'MONTH';
    }
  }
  // `pending`: Auto is waiting on the range read (not answered, not failed), so `bucket` is null only for now.
  return { bucket, error: read.error, retry: read.retry, pending: auto && !read.rows && !read.error };
}
