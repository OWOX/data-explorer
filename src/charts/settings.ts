// Member-saved chart choices and how they resolve against the columns shown now.
import { isDateBucket, type DateBucket } from '../model/aggregation';
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
    bucket: bucket === 'AUTO' || isDateBucket(bucket) ? bucket! : 'AUTO',
    measure: pick(measuresOf(cf), ts.metric),
    stack: cf.dimensions.find((d) => d.name === ts.stack) ?? null,
    orientation: ts.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    pieMeasure: pick(pieMeasures(cf), s.pie?.metric),
    pieDimension: cf.dimensions.find((d) => d.name === s.pie?.dimension) ?? cf.dimensions[0] ?? null,
  };
}

export const CHART_KINDS = ['timeSeries', 'pie', 'rankedBar', 'line', 'heatmap', 'scatter', 'spread'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const isChartKind = (v: unknown): v is ChartKind => (CHART_KINDS as readonly unknown[]).includes(v);

/** One chart the member added: its type and the saved names of its fields. Names resolve against the shown columns at draw time. */
export type ChartSpec = {
  id: string; kind: ChartKind; hidden?: boolean;
  measure?: string; measure2?: string | null; date?: string; bucket?: DateBucket | 'AUTO';
  dimension?: string; dimension2?: string; stack?: string | null; orientation?: Orientation; area?: boolean;
};
export type ChartSettingsV2 = { version?: 2; scorecards?: { hidden?: string[]; sparklines?: boolean }; charts?: ChartSpec[] };
/** What the scorecards need: hidden cards, the sparklines switch and the date their trends are drawn on. */
export type Spark = { hidden: Set<string>; sparklines: boolean; date: Field | null };

/** What a mart shows before the member changes anything: today's two panels. Fixed ids, so an edit of a default keeps its id. */
export const DEFAULT_CHARTS: ChartSpec[] = [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie' }];
export const chartsOf = (s: ChartSettingsV2): ChartSpec[] => s.charts ?? DEFAULT_CHARTS;
export const scorecardsOf = (s: ChartSettingsV2) => ({ hidden: new Set(s.scorecards?.hidden ?? []), sparklines: s.scorecards?.sparklines ?? true });

export const pickMeasure = (list: Measure[], saved?: string | null): Measure | null =>
  list.find((m) => measureId(m) === saved) ?? list.find((m) => m.kind === 'metric') ?? list[0] ?? null;
export const pickField = (list: Field[], saved?: string | null, fallback: Field | null = list[0] ?? null): Field | null =>
  list.find((f) => f.name === saved) ?? fallback;
export const pickBucketChoice = (v: unknown): DateBucket | 'AUTO' => (v === 'AUTO' || isDateBucket(v) ? (v as DateBucket | 'AUTO') : 'AUTO');

let seq = 0;
export const newChartId = (): string => `c-${Date.now().toString(36)}-${(seq++).toString(36)}`;
/** One edit of the list: the saved list, or the defaults it stands for, with `edit` applied. Always version 2. */
export const editCharts = (s: ChartSettingsV2, edit: (list: ChartSpec[]) => ChartSpec[]): ChartSettingsV2 => ({ ...s, version: 2, charts: edit(chartsOf(s)) });
export const patchChart = (s: ChartSettingsV2, id: string, patch: Partial<ChartSpec>): ChartSettingsV2 =>
  editCharts(s, (list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
