import { AUTO, formatValue, keepsUnit, type Format } from '../format/formats';
import { AGG_LABELS, formatBucket, outputType, type AggFn, type DateBucket } from '../model/aggregation';
import { fieldLabel } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import { ErrorBox } from '../ui/ErrorBox';
import { formatNumber } from '../ui/format';
import { Skeleton } from '../ui/Skeleton';
import type { ChartFields, ChartMart } from './fields';
import { metricKey, scorecardsQuery, sparklineQuery, uniqueKey } from './queries';
import { recordsCardId, type ResolvedCharts } from './settings';
import { Sparkline, type Point } from './svg/Sparkline';
import { useChartQuery, type ChartResult } from './useChartQuery';

export type Card = { id: string; label: string; key: string; field?: Field; fn?: AggFn };

/** A mart's cards: its record count (when it has a primary key), then one per metric. */
export function cardsOf(mart: ChartMart): Card[] {
  return [
    ...(mart.hasPk ? [{ id: recordsCardId(mart.martId), label: 'Records', key: uniqueKey(mart.aliasPath) }] : []),
    ...mart.metrics.map((m) => ({ id: m.field.name, label: `${fieldLabel(m.field)} · ${AGG_LABELS[m.fn]}`, key: metricKey(m), field: m.field, fn: m.fn })),
  ];
}

/** One query for every value card of every data mart. Nothing runs while paused. */
export function useScorecards(martId: string, cf: ChartFields, filter: TraverseFilter[], version: number, paused: boolean): ChartResult {
  return useChartQuery(martId, paused ? null : scorecardsQuery(cf.marts, filter), version);
}

type Formatter = (column: string, type: string) => Format;

function textOf(card: Card, row: Row | undefined, formatOf: Formatter): string {
  if (!row) return '';
  const v = row[card.key];
  if (!card.field) return formatNumber(v) ?? (v === null || v === undefined ? '' : String(v));
  const type = outputType(card.field, card.fn);
  return formatValue(v, type, keepsUnit(card.fn) ? formatOf(card.field.name, type) : AUTO);
}

const numberOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The cards of one data mart, wrapping inside its group's cell. The main mart's cell also shows the strip's error and empty state. */
export function MartCards({ martId, mart, main, r, scores, bucket, filter, version, paused, hasFilters, formatOf }: {
  martId: string; mart: ChartMart; main: boolean; r: ResolvedCharts; scores: ChartResult; bucket: DateBucket | null; filter: TraverseFilter[]; version: number; paused: boolean; hasFilters: boolean; formatOf: Formatter;
}) {
  const cards = cardsOf(mart).filter((c) => !r.hidden.has(c.id));
  // The group's own date when it has one, else the chart date's mart's: a joined mart without a date draws no trend.
  const date = r.date && mart.dates.includes(r.date) ? r.date : mart.dates[0] ?? null;
  const spark = useChartQuery(martId, r.sparklines && cards.length > 0 && date && bucket && !paused ? sparklineQuery(mart, date, bucket, filter) : null, version);
  if (scores.error) return main ? <ErrorBox error={scores.error} onRetry={scores.retry} /> : null;
  if (scores.rows && scores.rows.length === 0) return main ? <p className="dm-muted text-sm">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</p> : null;
  const row = scores.rows?.[0];
  const points = (c: Card): Point[] => (spark.rows ?? []).map((s) => ({
    x: String(s[date!.name]),
    y: numberOf(s[c.key]),
    label: formatBucket(s[date!.name], bucket!) ?? '',
    valueText: textOf(c, s, formatOf),
  }));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
      {cards.map((c) => (
        <div key={c.id} data-card={c.id} className="min-w-[9rem] flex-1 rounded-md border px-3 py-2">
          <div className="dm-muted truncate text-xs">{c.label}</div>
          {row ? <div className="text-lg font-semibold tabular-nums">{textOf(c, row, formatOf)}</div> : <Skeleton rows={1} />}
          {spark.rows && spark.rows.length > 0 && <Sparkline points={points(c)} ariaLabel={`${c.label} trend`} />}
        </div>
      ))}
    </div>
  );
}
