import { allowedFunctions, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { pickBucket } from './fields';
import { monthsQuery, rangeKeys, rangeQuery } from './queries';
import { useChartQuery } from './useChartQuery';

/**
 * The bucket the date charts use. A chosen bucket is used as it is; Auto reads the date's range once and picks the smallest
 * bucket with at most 60 buckets. `null` until it is known (or when there is no date, or the band is paused): the charts that
 * need it wait, so no query goes out with a guessed bucket.
 */
export function useBucket(martId: string, date: Field | null, chosen: DateBucket | 'AUTO', filter: TraverseFilter[], version: number, paused: boolean) {
  // A date whose governance forbids MIN or MAX cannot be ranged (OWOX refuses the query): its distinct months give the range instead.
  const rangeable = !!date && ['MIN', 'MAX'].every((fn) => allowedFunctions(date).includes(fn as 'MIN' | 'MAX'));
  const auto = chosen === 'AUTO' && !!date && !paused;
  const range = useChartQuery(martId, auto && rangeable ? rangeQuery(date!, filter) : null, version);
  const months = useChartQuery(martId, auto && !rangeable ? monthsQuery(date!, filter) : null, version);
  const read = rangeable ? range : months;
  let bucket: DateBucket | null = null;
  if (chosen !== 'AUTO') bucket = chosen;
  else if (date && read.rows) {
    if (rangeable) bucket = pickBucket(read.rows[0]?.[rangeKeys(date).min], read.rows[0]?.[rangeKeys(date).max]);
    else {
      // Oldest and newest month; a blank date sorts apart from them, so it is skipped.
      const seen = read.rows.map((x) => x[date.name]).filter((v) => v !== null && v !== undefined && v !== '');
      bucket = seen.length ? pickBucket(seen[0], seen[seen.length - 1]) : 'MONTH';
    }
  }
  return { bucket, error: read.error, retry: read.retry };
}
