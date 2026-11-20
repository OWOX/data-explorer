// Member-saved chart choices and how they resolve against the columns shown now.
import { DATE_BUCKETS, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import { measuresOf, pieMeasures, type ChartFields } from './fields';
import type { Measure } from './queries';

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
  /** What the time series counts: a shown metric, or a mart's records (see `measureId`). */
  measure: Measure | null;
  stack: Field | null;
  orientation: Orientation;
  /** What the pie counts: a shown metric (summed), or a mart's records. */
  pieMeasure: Measure | null;
  pieDimension: Field | null;
};

/** What a measure is saved as: the field name, `'records'` for the main mart's records (as before joined marts counted) and `records:<martId>` for a joined mart's (`records:<martId>@<aliasPath>` for a later copy of it). */
export const measureId = (m: Measure): string => (m.kind === 'metric' ? m.metric.field.name : m.aliasPath === '' ? 'records' : m.recordsId);

/**
 * Pure: a saved name that is no longer shown falls back to the default for this view only.
 * Nothing is written back, so hiding a column for a while never loses the member's choice.
 */
export function resolveCharts(s: ChartSettings, cf: ChartFields): ResolvedCharts {
  const ts = s.timeSeries ?? {};
  const bucket = ts.bucket;
  const pick = (list: Measure[], saved?: string): Measure | null => list.find((m) => measureId(m) === saved) ?? list.find((m) => m.kind === 'metric') ?? list[0] ?? null;
  return {
    hidden: new Set(s.scorecards?.hidden ?? []),
    sparklines: s.scorecards?.sparklines ?? true,
    date: cf.dates.find((d) => d.name === ts.date) ?? cf.dates[0] ?? null,
    bucket: bucket === 'AUTO' || DATE_BUCKETS.some((b) => b === bucket) ? bucket! : 'AUTO',
    measure: pick(measuresOf(cf), ts.metric),
    stack: cf.dimensions.find((d) => d.name === ts.stack) ?? null,
    orientation: ts.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    pieMeasure: pick(pieMeasures(cf), s.pie?.metric),
    pieDimension: cf.dimensions.find((d) => d.name === s.pie?.dimension) ?? cf.dimensions[0] ?? null,
  };
}
