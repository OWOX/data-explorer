import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import { BLANK_KEY, keyOf } from './blank';
import type { ChartFields } from './fields';
import { measureKey, pieBlankQuery, pieOtherQuery, TOP_N, topValuesQuery, type Measure } from './queries';
import { useChartQuery } from './useChartQuery';

/** One category of a top list: its key (BLANK_KEY for the blank value) and the measure's returned value. */
export type Category = { key: string; value: unknown };
export type TopValues = {
  /** Blank first, then the top values in the read's order; null while loading. */
  categories: Category[] | null;
  /** The real values in the top list (no blank), for the `in` and `not_in` rules that follow. */
  names: string[] | undefined;
  /** The measure's value over the rows outside the top list, when there are any. */
  other: unknown;
  failed: { error: unknown; retry: () => void } | undefined;
  empty: boolean;
  loading: boolean;
};

/**
 * The measure's top values of a dimension, the blank value included as its own first category, with the rows outside them.
 * A top list cannot name NULL, so the blank value rides in the top read when it ranks, else is read apart; "Other" never holds blanks.
 */
export function useTopValues({ martId, cf, dim, measure, filter, version, idle, withOther = true }: {
  martId: string; cf: ChartFields; dim: Field; measure: Measure; filter: TraverseFilter[]; version: number; idle: boolean;
  /** Read the rows outside the top list too (default). An axis that only needs its values leaves it off. */
  withOther?: boolean;
}): TopValues {
  const top = useChartQuery(martId, idle ? null : topValuesQuery(dim, measure, filter), version);
  const keys = top.rows?.map((row) => keyOf(row[dim.name]));
  const names = keys?.filter((k) => k !== BLANK_KEY);
  const topFull = top.rows?.length === TOP_N;
  const full = topFull && withOther;
  const hasBlank = !!keys?.includes(BLANK_KEY);
  const blank = useChartQuery(martId, !idle && topFull && !hasBlank ? pieBlankQuery(measure, filter, dim, cf.counter) : null, version);
  const other = useChartQuery(martId, !idle && full ? pieOtherQuery(measure, filter, dim, names!, cf.counter) : null, version);
  const key = measureKey(measure);
  const failed = [top, blank, other].find((q) => q.error);
  const empty = top.rows?.length === 0;
  const loading = !empty && (!top.rows || (full && (!other.rows || (!hasBlank && !blank.rows))));
  if (!top.rows) return { categories: null, names, other: undefined, failed, empty, loading };
  const rows: Row[] = top.rows;
  const blankValue = hasBlank ? rows[keys!.indexOf(BLANK_KEY)]![key] : blank.rows?.[0]?.[key];
  const categories: Category[] = [
    ...(blankValue != null ? [{ key: BLANK_KEY, value: blankValue }] : []),
    ...rows.flatMap((row, i): Category[] => (keys![i] === BLANK_KEY ? [] : [{ key: keys![i]!, value: row[key] }])),
  ];
  const otherValue = full ? other.rows?.[0]?.[key] : undefined;
  return { categories, names, other: otherValue ?? undefined, failed, empty, loading };
}
