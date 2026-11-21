// Which shown columns the charts draw: metrics (numbers), dimensions (text, booleans) and dates, grouped by the data mart they belong to.
import { AGGREGATE_FUNCTIONS, allowedFunctions, canBucket, type AggFn, type Aggregation, type DateBucket } from '../model/aggregation';
import type { MainGrainMultiplication } from '../api/blendable';
import type { Field, Schema } from '../model/types';
import { hasPrimaryKey } from '../records/relationships';
import { isIdField } from '../state/join-plan';
import type { Measure } from './queries';

export type Metric = { field: Field; fn: AggFn };
/** `recordsId` is what the mart's Count Unique is saved and keyed as (see `chartFields`). */
export type ChartMart = { aliasPath: string; recordsId: string; title: string; hasPk: boolean; metrics: Metric[]; dates: Field[]; dimensions: Field[] };
/** `counter` is a main-mart field the warehouse may COUNT: a query with a slice and no column of its own reads it, so the slice has an explicit column list without a new group key. Null when the mart has none. */
export type ChartFields = { marts: ChartMart[]; dimensions: Field[]; dates: Field[]; counter?: Field | null;
  /** Per alias path of a joined mart: whether the joins down to it repeat the main mart's rows. A path not listed is 'unknown'. */
  multiplication?: Readonly<Record<string, MainGrainMultiplication>> };
export const MAX_BUCKETS = 60;

/** Everything a chart can count, per chart mart in group order: its Count Unique when it has a key, then its metrics. Any mart's measure pairs with any mart's date or dimension. */
export const measuresOf = (cf: ChartFields): Measure[] => cf.marts.flatMap((m): Measure[] => [
  ...(m.hasPk ? [{ kind: 'records', aliasPath: m.aliasPath, recordsId: m.recordsId } as const] : []),
  ...m.metrics.map((metric): Measure => ({ kind: 'metric', metric })),
]);

/** A pie shows parts of a whole: only metrics the warehouse may sum, and always summed, whatever function the grid shows; every Count Unique counts too. */
export const pieMeasures = (cf: ChartFields): Measure[] => measuresOf(cf).flatMap((x): Measure[] => {
  if (x.kind === 'records') return [x];
  if (!allowedFunctions(x.metric.field).includes('SUM')) return [];
  return [x.metric.fn === 'SUM' ? x : { kind: 'metric', metric: { ...x.metric, fn: 'SUM' } }];
});

export const pathOf = (f: Field) => f.joined?.aliasPath ?? '';

/** The data mart (alias path) a measure counts or sums over. */
export const measurePath = (m: Measure): string => (m.kind === 'records' ? m.aliasPath : pathOf(m.metric.field));

/** Whether a column of the joined mart at `path` leaves the main mart's rows whole: that mart and every ancestor on its path is 'none'. A missing entry or a client without the field is 'unknown'. */
const keepsMainGrain = (cf: ChartFields, path: string): boolean => {
  const parts = path.split('.');
  return parts.every((_, i) => cf.multiplication?.[parts.slice(0, i + 1).join('.')] === 'none');
};

/**
 * What a Sankey may sum: the columns' rows are added up in the plugin, which is only right when no join can repeat a record across them.
 * The backend de-duplicates a SUM or a Count Unique per group of the read's columns, so one record that matches several joined rows (an order with 3 products)
 * is whole in each group and counted once per group when the groups are added. A column is safe when it is on the measure's own mart (same alias path),
 * or when the measure is on the main mart and the column's mart, with every ancestor on its path, is keyed one-to-one from its parent ('none'),
 * so a main row matches one joined row at most. A measure on a joined mart keeps the same-mart rule.
 */
export const sankeyMeasures = (cf: ChartFields, dims: Field[]): Measure[] => pieMeasures(cf).filter((m) => {
  const at = measurePath(m);
  return dims.every((d) => pathOf(d) === at || (at === '' && keepsMainGrain(cf, pathOf(d))));
});

// The grid's own Σ function wins, so a chart and the grid never disagree about what a column means.
function metricFn(f: Field, agg: Aggregation): AggFn | null {
  const allowed = allowedFunctions(f);
  const chosen = agg.aggregations.find((r) => r.column === f.name && allowed.includes(r.function));
  if (chosen) return chosen.function;
  if (allowed.includes('SUM')) return 'SUM';
  return AGGREGATE_FUNCTIONS.find((fn) => allowed.includes(fn)) ?? null;
}

/** `groupPaths` are the groups' alias paths, main first (titles are keyed by path). `shown` is the grid's shown column names (their order does not matter: the charts follow the schema's, so a column move changes nothing); `schema` the blended schema; `mainMartId` the grid's mart. */
export function chartFields(schema: Schema, shown: string[], agg: Aggregation, mainMartId: string, groupPaths: string[], uniqueCountPaths?: ReadonlySet<string>, titles: Readonly<Record<string, string>> = {}, multiplication?: Readonly<Record<string, MainGrainMultiplication>>): ChartFields {
  const by = new Map(schema.map((f) => [f.name, f]));
  const on = new Set(shown);
  const fields = [...by.values()].filter((f) => on.has(f.name));
  // A group is a mart at one alias path ('' for the main mart), so a mart joined twice is two groups with their own fields.
  // The main mart's id is taken, so a self-join is told apart from it; a joined mart's first path keeps the plain id that is saved today.
  const taken = new Set([mainMartId]);
  const marts = groupPaths.map((aliasPath): ChartMart => {
    const own = fields.filter((f) => pathOf(f) === aliasPath);
    const martId = aliasPath === '' ? mainMartId : (schema.find((f) => pathOf(f) === aliasPath)?.joined?.martId ?? '');
    const recordsId = aliasPath === '' ? `records:${mainMartId}` : taken.has(martId) ? `records:${martId}@${aliasPath}` : `records:${martId}`;
    taken.add(martId);
    // Blended fields carry no key flag: a joined mart has a key when the backend says a unique count works on its alias path.
    const hasPk = aliasPath === '' ? hasPrimaryKey(schema) : !!uniqueCountPaths?.has(aliasPath);
    const metrics = own.flatMap((f): Metric[] => {
      if (f.category !== 'number' || isIdField(f) || f.isCalculated) return [];
      const fn = metricFn(f, agg);
      return fn ? [{ field: f, fn }] : [];
    });
    return {
      aliasPath,
      recordsId,
      title: titles[aliasPath] ?? '',
      hasPk,
      metrics,
      dates: own.filter((f) => canBucket(f)),
      dimensions: own.filter((f) => (f.category === 'string' || f.category === 'boolean') && !isIdField(f)),
    };
  });
  const counter = schema.find((f) => !f.joined && allowedFunctions(f).includes('COUNT')) ?? null;
  return { marts, dimensions: marts.flatMap((m) => m.dimensions), dates: marts.flatMap((m) => m.dates), counter, ...(multiplication ? { multiplication } : {}) };
}

const DAY_MS = 86_400_000;
const SPAN_DAYS: [DateBucket, number][] = [['DAY', 1], ['WEEK', 7], ['MONTH', 30.44], ['QUARTER', 91.31], ['YEAR', 365.25]];

// The warehouse may answer 'YYYY-MM-DD HH:MM:SS UTC', which Date.parse reads in some engines and not in others.
const parseStamp = (v: unknown): number => Date.parse(String(v ?? '').trim().replace(/ UTC$/, '').replace(/^(\d{4}-\d\d-\d\d) /, '$1T'));

/** The smallest bucket giving at most 60 buckets between two ISO dates or timestamps; MONTH when either is missing or unparsable (DAY would draw far too many bars on an unknown span). */
export function pickBucket(min: unknown, max: unknown): DateBucket {
  const a = parseStamp(min);
  const b = parseStamp(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'MONTH';
  // Only to choose a bucket: no value derived here is shown.
  const days = Math.abs(b - a) / DAY_MS + 1;
  return SPAN_DAYS.find(([, d]) => days / d <= MAX_BUCKETS)?.[0] ?? 'YEAR';
}
