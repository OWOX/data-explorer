// Member-saved chart choices and how they resolve against the columns shown now.
import { DATE_BUCKETS, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { ChartFields, Metric } from './fields';
import { RECORDS, type Measure } from './queries';

export type Orientation = 'vertical' | 'horizontal';
export type ChartSettings = {
  scorecards?: { hidden?: string[]; sparklines?: boolean };
  timeSeries?: { date?: string; bucket?: DateBucket | 'AUTO'; metric?: string; stack?: string | null; orientation?: Orientation };
  pie?: { metric?: string; dimension?: string };
};
export type ResolvedCharts = {
  hidden: Set<string>;
  sparklines: boolean;
  date: Field | null;
  bucket: DateBucket | 'AUTO';
  metric: Metric | null;
  /** What the time series counts: a shown metric, or the main mart's records (saved as `'records'`). */
  measure: Measure | null;
  stack: Field | null;
  orientation: Orientation;
  pieMetric: Metric | null;
  pieDimension: Field | null;
};

export const recordsCardId = (martId: string): string => `records:${martId}`;

/**
 * Pure: a saved name that is no longer shown falls back to the default for this view only.
 * Nothing is written back, so hiding a column for a while never loses the member's choice.
 */
export function resolveCharts(s: ChartSettings, cf: ChartFields): ResolvedCharts {
  const ts = s.timeSeries ?? {};
  const bucket = ts.bucket;
  const hasPk = cf.marts[0]?.hasPk ?? false;
  const named = cf.metrics.find((m) => m.field.name === ts.metric);
  const metricNamed = (name?: string) => cf.metrics.find((m) => m.field.name === name) ?? cf.metrics[0] ?? null;
  return {
    hidden: new Set(s.scorecards?.hidden ?? []),
    sparklines: s.scorecards?.sparklines ?? true,
    date: cf.dates.find((d) => d.name === ts.date) ?? cf.dates[0] ?? null,
    bucket: bucket === 'AUTO' || DATE_BUCKETS.some((b) => b === bucket) ? bucket! : 'AUTO',
    metric: metricNamed(ts.metric),
    measure: ts.metric === 'records' && hasPk ? RECORDS : named ? { kind: 'metric', metric: named } : cf.metrics[0] ? { kind: 'metric', metric: cf.metrics[0] } : hasPk ? RECORDS : null,
    stack: cf.dimensions.find((d) => d.name === ts.stack) ?? null,
    orientation: ts.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    pieMetric: metricNamed(s.pie?.metric),
    pieDimension: cf.dimensions.find((d) => d.name === s.pie?.dimension) ?? cf.dimensions[0] ?? null,
  };
}
