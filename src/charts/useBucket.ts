import type { DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { pickBucket } from './fields';
import { rangeKeys, rangeQuery } from './queries';
import { useChartQuery } from './useChartQuery';

/**
 * The bucket the date charts use. A chosen bucket is used as it is; Auto reads the date's range once and picks the smallest
 * bucket with at most 60 buckets. `null` until it is known (or when there is no date, or the band is paused): the charts that
 * need it wait, so no query goes out with a guessed bucket.
 */
export function useBucket(martId: string, date: Field | null, chosen: DateBucket | 'AUTO', filter: TraverseFilter[], version: number, paused: boolean) {
  const auto = chosen === 'AUTO' && !!date && !paused;
  const range = useChartQuery(martId, auto ? rangeQuery(date, filter) : null, version);
  const row = range.rows?.[0];
  const bucket: DateBucket | null = chosen !== 'AUTO' ? chosen : date && range.rows ? pickBucket(row?.[rangeKeys(date).min], row?.[rangeKeys(date).max]) : null;
  return { bucket, error: range.error, retry: range.retry };
}
