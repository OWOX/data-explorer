// Which shown columns the charts draw: metrics (numbers), dimensions (text, booleans) and dates, grouped by the data mart they belong to.
import { AGGREGATE_FUNCTIONS, allowedFunctions, canBucket, type AggFn, type Aggregation, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import { isIdField } from '../state/join-plan';

export type Metric = { field: Field; fn: AggFn; martId: string };
export type ChartMart = { martId: string; aliasPath: string; hasPk: boolean; metrics: Metric[]; dates: Field[]; dimensions: Field[] };
export type ChartFields = { marts: ChartMart[]; metrics: Metric[]; dimensions: Field[]; dates: Field[] };
export const MAX_BUCKETS = 60;

const martOf = (f: Field, main: string) => f.joined?.martId ?? main;

// The grid's own Σ function wins, so a chart and the grid never disagree about what a column means.
function metricFn(f: Field, agg: Aggregation): AggFn | null {
  const allowed = allowedFunctions(f);
  const chosen = agg.aggregations.find((r) => r.column === f.name && allowed.includes(r.function));
  if (chosen) return chosen.function;
  if (allowed.includes('SUM')) return 'SUM';
  return AGGREGATE_FUNCTIONS.find((fn) => allowed.includes(fn)) ?? null;
}

/** `shown` is the grid's shown column names in grid order; `schema` the blended schema; `mainMartId` the grid's mart. */
export function chartFields(schema: Field[], shown: string[], agg: Aggregation, mainMartId: string, groupOrder: string[], uniqueCountPaths?: ReadonlySet<string>): ChartFields {
  const by = new Map(schema.map((f) => [f.name, f]));
  const fields = shown.flatMap((n) => by.get(n) ?? []);
  const marts = groupOrder.map((martId): ChartMart => {
    const own = fields.filter((f) => martOf(f, mainMartId) === martId);
    const aliasPath = martId === mainMartId ? '' : (schema.find((f) => f.joined?.martId === martId)?.joined?.aliasPath ?? '');
    // Blended fields carry no key flag: a joined mart has a key when the backend says a unique count works on its alias path.
    const hasPk = martId === mainMartId ? schema.some((f) => f.isPrimaryKey && martOf(f, mainMartId) === martId) : !!uniqueCountPaths?.has(aliasPath);
    const metrics = own.flatMap((f): Metric[] => {
      if (f.category !== 'number' || isIdField(f) || f.isCalculated) return [];
      const fn = metricFn(f, agg);
      return fn ? [{ field: f, fn, martId }] : [];
    });
    return {
      martId,
      aliasPath,
      hasPk,
      metrics,
      dates: own.filter((f) => canBucket(f)),
      dimensions: own.filter((f) => (f.category === 'string' || f.category === 'boolean') && !isIdField(f)),
    };
  });
  return { marts, metrics: marts.flatMap((m) => m.metrics), dimensions: marts.flatMap((m) => m.dimensions), dates: marts.flatMap((m) => m.dates) };
}

const DAY_MS = 86_400_000;
const SPAN_DAYS: [DateBucket, number][] = [['DAY', 1], ['WEEK', 7], ['MONTH', 30.44], ['QUARTER', 91.31], ['YEAR', 365.25]];

/** The smallest bucket giving at most 60 buckets between two ISO dates or timestamps; DAY when either is missing or unparsable. */
export function pickBucket(min: unknown, max: unknown): DateBucket {
  const a = Date.parse(String(min ?? ''));
  const b = Date.parse(String(max ?? ''));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'DAY';
  // Only to choose a bucket: no value derived here is shown.
  const days = Math.abs(b - a) / DAY_MS + 1;
  return SPAN_DAYS.find(([, d]) => days / d <= MAX_BUCKETS)?.[0] ?? 'YEAR';
}
