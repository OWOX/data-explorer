import { AUTO, formatValue, keepsUnit, type Format } from '../format/formats';
import { AGG_LABELS, formatBucket, outputType, type AggFn, type DateBucket } from '../model/aggregation';
import { fieldLabel } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import { ErrorBox } from '../ui/ErrorBox';
import { emptyText, formatNumber } from '../ui/format';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { compactValue } from './compact';
import type { ChartFields, ChartMart, Metric } from './fields';
import { metricKey, scorecardsQuery, sparklineQuery, uniqueKey, type Measure } from './queries';
import { measureId, type ResolvedCharts } from './settings';
import { Sparkline, type Point } from './svg/Sparkline';
import { useChartQuery, type ChartResult } from './useChartQuery';

export type Card = { id: string; label: string; key: string; field?: Field; fn?: AggFn };

/** How a metric is named wherever it shows: on its card, in a chart title and in a menu. */
export const metricLabel = (m: Metric): string => `${fieldLabel(m.field)} · ${AGG_LABELS[m.fn]}`;

/** A measure's name in a menu and a chart title: the main mart's records are plain, a joined mart's say whose they are. */
export function measureLabel(cf: ChartFields, m: Measure): string {
  if (m.kind === 'metric') return metricLabel(m.metric);
  return m.aliasPath === '' ? 'Unique Records' : `${cf.marts.find((x) => x.aliasPath === m.aliasPath)?.title ?? ''} · Unique Records`;
}

/** The radio options of a "Metric" menu: each measure under the id it is saved as. */
export const measureOptions = (cf: ChartFields, list: Measure[]) => list.map((m) => ({ value: measureId(m), label: measureLabel(cf, m) }));

/** A mart's cards: its record count (when it has a primary key), then one per metric. */
export function cardsOf(mart: ChartMart): Card[] {
  return [
    ...(mart.hasPk ? [{ id: mart.recordsId, label: 'Unique Records', key: uniqueKey(mart.aliasPath) }] : []),
    ...mart.metrics.map((m) => ({ id: m.field.name, label: metricLabel(m), key: metricKey(m), field: m.field, fn: m.fn })),
  ];
}

/** One query for every value card of every data mart. Nothing runs while paused. */
export function useScorecards(martId: string, cf: ChartFields, filter: TraverseFilter[], version: number, paused: boolean): ChartResult {
  return useChartQuery(martId, paused ? null : scorecardsQuery(cf.marts, filter, cf.counter), version);
}

export type Formatter = (column: string, type: string) => Format;

function textOf(card: Card, row: Row | undefined, formatOf: Formatter): string {
  if (!row) return '';
  const v = row[card.key];
  if (!card.field) return recordsText(v);
  return metricText(card.field, card.fn!, v, formatOf);
}

/** The card's short value (1.6M) when the number is long enough to have one, in the unit the full text has. */
function shortOf(card: Card, row: Row, formatOf: Formatter): string | null {
  const v = row[card.key];
  if (!card.field) return compactValue(v, 'INTEGER', AUTO);
  return compactValue(v, ...metricFormat(card.field, card.fn!, formatOf));
}

/** The value on a card: short when it can be, with the exact text in a tooltip and for screen readers. */
function CardValue({ card, row, formatOf }: { card: Card; row: Row; formatOf: Formatter }) {
  const full = textOf(card, row, formatOf);
  const short = shortOf(card, row, formatOf);
  const cls = 'text-lg font-semibold tabular-nums';
  // A short form that is no shorter (1e21 is "1e+21" in full) is not worth a hover.
  if (short === null || short.length >= full.length) return <div data-card-value className={cls}>{full}</div>;
  // As Hint does: a focusable note, so the exact value is named for screen readers and opens by keyboard too.
  return (
    <div className={cls}>
      <Tooltip content={full}>
        <span data-card-value data-exact={full} role="note" tabIndex={0} aria-label={`${card.label}: ${full}`} className="cursor-default">{short}</span>
      </Tooltip>
    </div>
  );
}

/** A metric's value as the grid shows it: the output type's format, with the column's own unit only where the function keeps it. */
export function metricText(field: Field, fn: AggFn, v: unknown, formatOf: Formatter): string {
  const [type, format] = metricFormat(field, fn, formatOf);
  // A float sum carries binary noise (116739.09999999996); 15 significant digits is float64's own precision (from 1e15 a float has real digits beyond that, so it is left). Strings are exact.
  const shown = typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) && Math.abs(v) < 1e15 ? Number(v.toPrecision(15)) : v;
  return formatValue(shown, type, format);
}

/** The output type of a metric and the format that keeps its unit: the column's own only where the function keeps it. */
export function metricFormat(field: Field, fn: AggFn, formatOf: Formatter): [type: string, format: Format] {
  const type = outputType(field, fn);
  return [type, keepsUnit(fn) ? formatOf(field.name, type) : AUTO];
}

/** A records count as text: grouped digits, or the value as it came. */
export const recordsText = (v: unknown): string => formatNumber(v) ?? String(v ?? '');

/** A measure's value as text, whichever kind it is. */
export const measureText = (m: Measure, v: unknown, formatOf: Formatter): string => (m.kind === 'metric' ? metricText(m.metric.field, m.metric.fn, v, formatOf) : recordsText(v));

/** A measure's type and format, for an axis or a short value: Records are an integer count. */
export const measureFormat = (m: Measure, formatOf: Formatter): [type: string, format: Format] => (m.kind === 'metric' ? metricFormat(m.metric.field, m.metric.fn, formatOf) : ['INTEGER', AUTO]);

export const numberOf = (v: unknown): number | null => {
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
  if (scores.rows && scores.rows.length === 0) return main ? <p className="dm-muted text-sm">{emptyText(hasFilters)}</p> : null;
  const row = scores.rows?.[0];
  const points = (c: Card): Point[] => (spark.rows ?? []).map((s) => ({
    x: String(s[date!.name]),
    y: numberOf(s[c.key]),
    label: formatBucket(s[date!.name], bucket!) ?? '',
    valueText: textOf(c, s, formatOf),
  }));
  return (
    // A card is at most 10rem (basis, no growth) and may shrink in a narrow group; only the label truncates, so a number is never cut.
    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
      {cards.map((c) => (
        <div key={c.id} data-card={c.id} className="dm-scorecard min-w-0 flex-[0_1_10rem] overflow-hidden px-3 py-2">
          <div className="dm-muted truncate text-xs" title={c.label}>{c.label}</div>
          {row ? <CardValue card={c} row={row} formatOf={formatOf} /> : <Skeleton rows={1} />}
          {spark.rows && spark.rows.length > 0 && <Sparkline points={points(c)} ariaLabel={`${c.label} trend`} />}
        </div>
      ))}
    </div>
  );
}
