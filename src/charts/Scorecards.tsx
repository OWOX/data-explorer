import { useEffect, useState } from 'react';
import { Calendar, EyeOff, Gauge } from 'lucide-react';
import { AUTO, formatValue, keepsUnit, type Format, type FormatOptions } from '../format/formats';
import { isIntegerType } from '../model/field-category';
import { AGG_LABELS, formatBucket, outputType, type AggFn, type DateBucket } from '../model/aggregation';
import { fieldLabel } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { Row, TraverseFilter, TraverseOptions } from '../sdk/types';
import { ErrorBox } from '../ui/ErrorBox';
import { emptyText, formatNumber } from '../ui/format';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { compactValue } from './compact';
import type { ChartFields, ChartMart, Metric } from './fields';
import { metricKey, scorecardsQuery, sparklineQuery, uniqueKey, type Measure } from './queries';
import { measureId, type Spark } from './settings';
import { fieldGroups, measureGroups } from './menuGroups';
import { Sparkline, type Point } from './svg/Sparkline';
import type { JoinGrain } from './answers';
import { useBucket } from './useBucket';
import { useChartQuery, type ChartResult } from './useChartQuery';

export type Card = { id: string; label: string; key: string; measure: Measure };

/** How a metric is named wherever it shows: on its card, in a chart title and in a menu. */
/** A calculated metric has no function to name, so its label is the field's alone. */
export const metricLabel = (m: Metric): string => (m.fn ? `${fieldLabel(m.field)} · ${AGG_LABELS[m.fn]}` : fieldLabel(m.field));

const pathOfMeasure = (m: Measure): string => m.kind === 'records' ? m.aliasPath : m.metric.field.joined?.aliasPath ?? '';

/**
 * A measure's name in a menu, a legend and a chart title. A joined mart's Count Unique always says whose it is; the main mart's
 * does too once `scope` (the measures shown together, the measure alone by default) reaches more than one mart, so it is never mistaken for another's.
 */
export function measureLabel(cf: ChartFields, m: Measure, scope: Measure[] = [m]): string {
  if (m.kind === 'metric') return metricLabel(m.metric);
  const title = cf.marts.find((x) => x.aliasPath === m.aliasPath)?.title ?? '';
  if (m.aliasPath !== '') return `${title} · Count Unique`;
  return title && new Set(scope.map(pathOfMeasure)).size > 1 ? `${title} · Count Unique` : 'Count Unique';
}

/** A mart's cards: its record count (when it has a primary key), then one per metric not already shown by another card's pick. A card keeps its id (what hides it and what a pick is saved under) and shows the measure `metrics` picked for it, when that is still one of the mart's. */
export function cardsOf(mart: ChartMart, metrics: Record<string, string> = {}): Card[] {
  const own = defaultCards(mart);
  const byMeasure = new Map(own.map((c) => [measureId(c.measure), c]));
  const shown = own.map((c) => { const pick = byMeasure.get(metrics[c.id] ?? ''); return { card: pick ? { ...pick, id: c.id } : c, picked: !!pick }; });
  // A metric a card already shows through its pick does not also get its own card (a column shown by the pick would otherwise appear twice).
  const taken = new Set(shown.filter((x) => x.picked && x.card.measure.kind === 'metric').map((x) => measureId(x.card.measure)));
  return shown.filter((x) => x.picked || x.card.measure.kind !== 'metric' || !taken.has(measureId(x.card.measure))).map((x) => x.card);
}

/** The measures a card of this mart can show: the mart's own, in card order. */
export const martMeasures = (mart: ChartMart): Measure[] => defaultCards(mart).map((c) => c.measure);

function defaultCards(mart: ChartMart): Card[] {
  return [
    ...(mart.hasPk ? [{ id: mart.recordsId, label: 'Count Unique', key: uniqueKey(mart.aliasPath), measure: { kind: 'records', aliasPath: mart.aliasPath, recordsId: mart.recordsId } satisfies Measure }] : []),
    ...mart.metrics.map((m) => ({ id: m.field.name, label: metricLabel(m), key: metricKey(m), measure: { kind: 'metric', metric: m } satisfies Measure })),
  ];
}

/** The date a mart's sparklines are drawn on: the chart date when the mart has it, else the mart's first date (a joined mart without a date draws no trend). */
export const sparkDate = (mart: ChartMart, spark: Spark): Field | null => (spark.date && mart.dates.includes(spark.date) ? spark.date : mart.dates[0] ?? null);

/** The date one card's sparkline is drawn on: the date picked for the card when the mart still shows it, else the mart's own (`sparkDate`). */
export const cardDate = (mart: ChartMart, spark: Spark, cardId: string): Field | null => mart.dates.find((d) => d.name === spark.dates[cardId]) ?? sparkDate(mart, spark);

/** The query behind a mart's sparklines, or null when there are none to draw. One place decides, so the cards and the time series ask for the same key. */
export function sparkQueryOf(mart: ChartMart, spark: Spark, bucket: DateBucket | null, filter: TraverseFilter[], pick: Field | null = null): TraverseOptions | null {
  const date = pick ?? sparkDate(mart, spark);
  const cards = cardsOf(mart).filter((c) => !spark.hidden.has(c.id));
  return spark.sparklines && cards.length > 0 && date && bucket ? sparklineQuery(mart, date, bucket, filter) : null;
}

/**
 * The query an unstacked time series can ride on: its measure's own mart already reads every metric and its unique count by
 * the same date bucket for the sparklines, so the series rows are a column subset of those rows and the read is shared.
 * Null when the sparklines do not draw on the series' `date` (or are off or hidden), and the series reads for itself.
 */
export function sharedSeriesQuery(cf: ChartFields, spark: Spark, measure: Measure, bucket: DateBucket | null, filter: TraverseFilter[], date: Field): TraverseOptions | null {
  const path = measure.kind === 'records' ? measure.aliasPath : measure.metric.field.joined?.aliasPath ?? '';
  const owner = cf.marts.find((m) => m.aliasPath === path);
  if (!owner || !spark.date || date !== spark.date || sparkDate(owner, spark) !== spark.date) return null;
  const has = measure.kind === 'records' ? owner.hasPk : owner.metrics.some((m) => metricKey(m) === metricKey(measure.metric));
  return has ? sparkQueryOf(owner, spark, bucket, filter) : null;
}

/** The scorecards' read plus the last row it returned, which the cards keep showing (dimmed) while the next read runs. */
export type Scores = ChartResult & { previous?: Row | null };

/**
 * One query for every value card of every data mart: a filter change or an added mart is one billed read, not one per mart.
 * `previous` is the last row a read returned, kept so the cards do not fall back to skeletons while the next read runs. Nothing runs while paused.
 */
export function useScorecards(martId: string, cf: ChartFields, filter: TraverseFilter[], version: number, paused: boolean, joins?: JoinGrain): Scores {
  const result = useChartQuery(martId, paused ? null : scorecardsQuery(cf.marts, filter, cf.counter), version, joins);
  const [previous, setPrevious] = useState<Row | null>(null);
  // Adjusting state while rendering (not in an effect) so the card never paints a frame without the previous value.
  const latest = result.rows?.[0] ?? null;
  if (latest && latest !== previous) setPrevious(latest);
  // A failed or empty read leaves no stale number behind: the read after it starts from skeletons, not from a value that came before the gap.
  else if ((result.error || result.rows?.length === 0) && previous) setPrevious(null);
  return { ...result, previous };
}

const ROLL_MS = 500;
const decimalsOf = (n: number): number => (/e/i.test(String(n)) ? 0 : (String(n).split('.')[1] ?? '').length);
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The number a card shows while its value rolls from the one it showed to `target`, over `ms` with ease-out.
 * It only rolls between two finite numbers that differ, with motion allowed, and within one `scope` (the card's measure): a card that had
 * no value, or whose measure was swapped, jumps instead of counting from an unrelated number. A newer target mid-roll starts from the number on screen.
 * `whole` rounds every frame, so a count never shows a fraction on its way.
 */
export function useRolling(target: number | null, scope: string, whole: boolean, ms = ROLL_MS): number | null {
  const [state, setState] = useState<{ value: number | null; scope: string }>({ value: target, scope });
  const from = state.scope === scope ? state.value : null;
  const rolls = target !== null && from !== null && from !== target && !reducedMotion();
  useEffect(() => {
    if (!rolls) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the settled number is remembered as the start of the next roll
      setState((cur) => (cur.value === target && cur.scope === scope ? cur : { value: target, scope }));
      return;
    }
    // Every frame has the decimals the two ends have (at most two), so the width does not jump through 15-digit floats on the way.
    const places = whole ? 0 : Math.min(2, Math.max(decimalsOf(from), decimalsOf(target)));
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      // The first frame's timestamp can precede `start` (taken from performance.now in the effect): time never runs backwards.
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const v = t >= 1 ? target : from + (target - from) * easeOutCubic(t);
      setState({ value: t >= 1 ? target : Number(v.toFixed(places)), scope });
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `from` is the number on screen when this target arrived; later frames must not restart the roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, scope]);
  // Null once settled: the card then formats its exact row value (a big NUMERIC string never passes through a double).
  return rolls ? from : null;
}

export type Formatter = (column: string, type: string) => Format;

function textOf(card: Card, row: Row | undefined, formatOf: Formatter): string {
  if (!row) return '';
  return measureText(card.measure, row[card.key], formatOf);
}

/** The card's short value (1.6M) when the number is long enough to have one, in the unit the full text has. */
function shortOf(card: Card, row: Row, formatOf: Formatter): string | null {
  return compactValue(row[card.key], ...measureFormat(card.measure, formatOf));
}

/**
 * The value on a card: short when it can be, with the exact text in a tooltip and for screen readers.
 * `shown` is the number on screen while it rolls (every frame is formatted like the final value); the exact text always comes from `row`.
 * `busy` dims the value and marks it as being replaced: it is the previous read's, until the new one arrives.
 */
function CardValue({ card, row, formatOf, shown, busy = false }: { card: Card; row: Row; formatOf: Formatter; shown?: number | null; busy?: boolean }) {
  const full = textOf(card, row, formatOf);
  const frame = shown === undefined || shown === null ? row : { ...row, [card.key]: shown };
  const text = frame === row ? full : textOf(card, frame, formatOf);
  const short = shortOf(card, frame, formatOf);
  const cls = `text-lg font-semibold tabular-nums transition-opacity duration-200 ${busy ? 'opacity-40' : ''}`;
  // A short form that is no shorter (1e21 is "1e+21" in full) is not worth a hover.
  if (short === null || short.length >= text.length) return <div data-card-value aria-busy={busy || undefined} className={cls}>{text}</div>;
  // As Hint does: a focusable note, so the exact value is named for screen readers and opens by keyboard too.
  return (
    <div className="text-lg font-semibold tabular-nums">
      <Tooltip content={full}>
        <span data-card-value data-exact={full} aria-busy={busy || undefined} role="note" tabIndex={0} aria-label={`${card.label}: ${full}`} className={`cursor-default transition-opacity duration-200 ${busy ? 'opacity-40' : ''}`}>{short}</span>
      </Tooltip>
    </div>
  );
}

/** A metric's value as the grid shows it: the output type's format, with the column's own unit only where the function keeps it. No function (a calculated metric): the field's own type and format. */
export function metricText(field: Field, fn: AggFn | null, v: unknown, formatOf: Formatter, options?: FormatOptions): string {
  const [type, format] = metricFormat(field, fn, formatOf);
  // A float sum carries binary noise (116739.09999999996); 15 significant digits is float64's own precision (from 1e15 a float has real digits beyond that, so it is left). Strings are exact.
  const shown = typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) && Math.abs(v) < 1e15 ? Number(v.toPrecision(15)) : v;
  return formatValue(shown, type, format, options);
}

/** The output type of a metric and the format that keeps its unit: the column's own only where the function keeps it. */
export function metricFormat(field: Field, fn: AggFn | null, formatOf: Formatter): [type: string, format: Format] {
  const type = outputType(field, fn ?? undefined);
  return [type, !fn || keepsUnit(fn) ? formatOf(field.name, type) : AUTO];
}

/** A records count as text: grouped digits, or the value as it came. */
const recordsText = (v: unknown): string => formatNumber(v) ?? String(v ?? '');

/** A measure's value as text, whichever kind it is. */
export const measureText = (m: Measure, v: unknown, formatOf: Formatter, options?: FormatOptions): string => (m.kind === 'metric' ? metricText(m.metric.field, m.metric.fn, v, formatOf, options) : recordsText(v));

/** A measure's type and format, for an axis or a short value: Records are an integer count. */
export const measureFormat = (m: Measure, formatOf: Formatter): [type: string, format: Format] => (m.kind === 'metric' ? metricFormat(m.metric.field, m.metric.fn, formatOf) : ['INTEGER', AUTO]);

/** Whether a measure counts whole things (a records count, an integer field's sum or count), so its axis steps are whole numbers. */
export const isIntegerMeasure = (m: Measure): boolean => m.kind === 'records' || isIntegerType(outputType(m.metric.field, m.metric.fn ?? undefined));

/** The trend's rows that have a date: a blank date has no place on the time axis (the read stays as it is, so the series shares it). */
export const datedRows = (rows: Row[], dateName: string): Row[] => rows.filter((s) => s[dateName] !== null && s[dateName] !== undefined && s[dateName] !== '');

export const numberOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One card: its label and ⋮ menu, its value and its own sparkline (the date picked for it, read once per date and shared by the cards on it). */
function ScoreCard({ martId, mart, menuMart, card: c, spark, row, busy, bucket, autoBucket, filter, version, paused, joins, formatOf, choices, onMetric, onDate, onHide }: {
  martId: string; mart: ChartMart; menuMart: ChartMart; card: Card; spark: Spark; row: Row | undefined; /** The row is the previous read's, shown dimmed until the new one arrives. */ busy: boolean; bucket: DateBucket | null; /** Whether the charts' bucket is Auto, so a card on its own date picks its own. */ autoBucket: boolean; filter: TraverseFilter[]; version: number; paused: boolean; joins?: JoinGrain; formatOf: Formatter;
  choices: ReturnType<typeof measureGroups>; onMetric?: (cardId: string, measure: string) => void; onDate?: (cardId: string, date: string) => void; onHide?: (cardId: string) => void;
}) {
  const date = cardDate(mart, spark, c.id);
  const raw = row?.[c.key];
  const rolled = useRolling(numberOf(raw), c.key, isIntegerMeasure(c.measure));
  // Under Auto a card on another date than the charts' keeps the 60-bucket cap by that date's own range (the charts' bucket fits their date: a month for years of customers leaves two points of two months of orders).
  // Cards on one date share the range read. A chosen bucket is shared, and with the sparklines off there is nothing to range for.
  const own = autoBucket && spark.sparklines && !!date && date.name !== spark.date?.name;
  const mine = useBucket(martId, own ? date : null, 'AUTO', filter, version, paused);
  const cardBucket = own ? mine.bucket : bucket;
  const trend = useChartQuery(martId, paused ? null : sparkQueryOf(mart, spark, cardBucket, filter, date), version, joins);
  // A changed date has no trend yet (its range, then its rows, are still being read): a placeholder holds the sparkline's place instead of a stale or empty box.
  const waiting = !paused && spark.sparklines && !!date && (trend.loading || (own && !mine.bucket && !mine.error));
  const dated = date ? datedRows(trend.rows ?? [], date.name) : [];
  const points: Point[] = dated.map((s) => ({
    x: String(s[date!.name]),
    y: numberOf(s[c.key]),
    label: formatBucket(s[date!.name], cardBucket!) ?? '',
    valueText: textOf(c, s, formatOf),
  }));
  return (
    // A card is at most 10rem (basis, no growth) and may shrink in a narrow group; only the label truncates, so a number is never cut.
    <div data-card={c.id} className="dm-scorecard relative min-w-0 flex-[0_1_10rem] overflow-hidden px-3 py-2">
      <div className={`dm-muted truncate text-xs ${onHide ? 'pr-6' : ''}`} title={c.label}>{c.label}</div>
      {onHide && (
        <div className="absolute right-0.5 top-0.5">
          {/* A single date is listed too: it says which date the sparkline is drawn on, and shows its column when it is hidden. */}
          <ChartMenu name={c.label} items={[
            ...(martMeasures(menuMart).length > 1 ? [{ kind: 'radio', label: 'Metric', icon: Gauge, value: measureId(c.measure), options: [], groups: choices, onPick: (v: string) => onMetric?.(c.id, v) } as MenuItem] : []),
            ...(menuMart.dates.length > 0 ? [{ kind: 'radio', label: 'Date field', icon: Calendar, value: date?.name ?? '', options: [], groups: fieldGroups({ marts: [menuMart], dimensions: [], dates: [] }, menuMart.dates), onPick: (v: string) => onDate?.(c.id, v) } as MenuItem] : []),
            { kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => onHide(c.id) },
          ]} />
        </div>
      )}
      {row ? <CardValue card={c} row={row} formatOf={formatOf} shown={rolled} busy={busy} /> : <Skeleton rows={1} />}
      {waiting && <div aria-label="Loading trend" className="mt-1 h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />}
      {!waiting && dated.length > 0 && <Sparkline points={points} ariaLabel={`${c.label} trend`} />}
    </div>
  );
}

/** The cards of one data mart, wrapping inside its group's cell. The main mart's cell also shows the strip's error and empty state. `menuMart` is the same mart with every column: its metrics and dates are what a card's menu offers. */
export function MartCards({ martId, mart, menuMart = mart, main, spark, scores, bucket, autoBucket = true, filter, version, paused, joins, hasFilters, formatOf, onMetric, onDate, onHide }: {
  martId: string; mart: ChartMart; menuMart?: ChartMart; main: boolean; spark: Spark; scores: Scores; bucket: DateBucket | null; /** Whether the charts' bucket is Auto. */ autoBucket?: boolean; filter: TraverseFilter[]; version: number; paused: boolean; /** What lets a sparkline read be reused after a column is dropped. */ joins?: JoinGrain; hasFilters: boolean; formatOf: Formatter;
  /** A card's ⋮ menu: pick the measure a card shows, the date its trend is drawn on, and hide it. Without them (the settings are still loading) the cards have no menu. */
  onMetric?: (cardId: string, measure: string) => void; onDate?: (cardId: string, date: string) => void; onHide?: (cardId: string) => void;
}) {
  const cards = cardsOf(mart, spark.metrics).filter((c) => !spark.hidden.has(c.id));
  const choices = measureGroups({ marts: [menuMart], dimensions: [], dates: [] }, martMeasures(menuMart));
  if (scores.error) return main ? <ErrorBox error={scores.error} onRetry={scores.retry} /> : null;
  if (scores.rows && scores.rows.length === 0) return main ? <p className="dm-muted text-sm">{emptyText(hasFilters)}</p> : null;
  const fresh = scores.rows?.[0];
  // While a read runs, a card whose value the last read had keeps it, dimmed; a card with none (a mart just added) shows a skeleton.
  const stale = scores.loading ? scores.previous ?? undefined : undefined;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
      {cards.map((c) => (
        <ScoreCard key={c.id} martId={martId} mart={mart} menuMart={menuMart} card={c} spark={spark} row={fresh ?? (stale && c.key in stale ? stale : undefined)} busy={!fresh} bucket={bucket} autoBucket={autoBucket} filter={filter} version={version} paused={paused} joins={joins} formatOf={formatOf}
          choices={choices} onMetric={onMetric} onDate={onDate} onHide={onHide} />
      ))}
    </div>
  );
}
