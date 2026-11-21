// Member-saved chart choices and how they resolve against the columns shown now.
import { isDateBucket, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { Measure } from './queries';

export type Orientation = 'vertical' | 'horizontal';
/** What a measure is saved as: the field name, `'records'` for the main mart's records (as before joined marts counted) and `records:<martId>` for a joined mart's (`records:<martId>@<aliasPath>` for a later copy of it). */
export const measureId = (m: Measure): string => (m.kind === 'metric' ? m.metric.field.name : m.aliasPath === '' ? 'records' : m.recordsId);

export const CHART_KINDS = ['timeSeries', 'bar', 'pie', 'rankedBar', 'line', 'heatmap', 'scatter', 'spread'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const isChartKind = (v: unknown): v is ChartKind => (CHART_KINDS as readonly unknown[]).includes(v);

/** One chart the member added: its type and the saved names of its fields. Names resolve against the shown columns at draw time. */
export type ChartSpec = {
  id: string; kind: ChartKind; hidden?: boolean;
  measure?: string; measure2?: string | null; date?: string; bucket?: DateBucket | 'AUTO';
  dimension?: string; dimension2?: string; stack?: string | null; orientation?: Orientation; area?: boolean;
};
/** `metrics` is the measure each card shows when it is not the card's own: card id (its default's saved id) to measure id. */
export type ChartSettings = { version?: 2; scorecards?: { hidden?: string[]; sparklines?: boolean; metrics?: Record<string, string> }; charts?: ChartSpec[] };
/** What the scorecards need: hidden cards, the sparklines switch, each card's picked measure and the date their trends are drawn on. */
export type Spark = { hidden: Set<string>; sparklines: boolean; metrics: Record<string, string>; date: Field | null };

/** What a mart shows before the member changes anything: today's two panels. Fixed ids, so an edit of a default keeps its id. */
export const DEFAULT_CHARTS: readonly ChartSpec[] = [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie' }];
export const chartsOf = (s: ChartSettings): readonly ChartSpec[] => s.charts ?? DEFAULT_CHARTS;
export const scorecardsOf = (s: ChartSettings) => ({ hidden: new Set(s.scorecards?.hidden ?? []), sparklines: s.scorecards?.sparklines ?? true, metrics: s.scorecards?.metrics ?? {} });

export const pickMeasure = (list: Measure[], saved?: string | null): Measure | null =>
  list.find((m) => measureId(m) === saved) ?? list.find((m) => m.kind === 'metric') ?? list[0] ?? null;
export const pickField = (list: Field[], saved?: string | null, fallback: Field | null = list[0] ?? null): Field | null =>
  list.find((f) => f.name === saved) ?? fallback;
export const pickBucketChoice = (v: unknown): DateBucket | 'AUTO' => (v === 'AUTO' || isDateBucket(v) ? (v as DateBucket | 'AUTO') : 'AUTO');

let seq = 0;
export const newChartId = (): string => `c-${Date.now().toString(36)}-${(seq++).toString(36)}`;
/** One edit of the list: the saved list, or the defaults it stands for, with `edit` applied. Always version 2. */
export const editCharts = (s: ChartSettings, edit: (list: readonly ChartSpec[]) => ChartSpec[]): ChartSettings => ({ ...s, version: 2, charts: edit(chartsOf(s)) });
export const patchChart = (s: ChartSettings, id: string, patch: Partial<ChartSpec>): ChartSettings =>
  editCharts(s, (list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
