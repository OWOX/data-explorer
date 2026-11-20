import { readRows } from '../api/rows';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Field } from '../model/types';
import type { TraverseOptions } from '../sdk/types';
import type { ChartFields, ChartMart, Metric } from './fields';
import { measureKey, seriesQuery, sparklineQuery, type Measure } from './queries';
import { resolveCharts, type ResolvedCharts } from './settings';
import { sharedSeriesQuery, sparkQueryOf } from './Scorecards';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const date = f('created_at', 'date');
const other = f('shipped_at', 'date');
const amount: Metric = { field: f('amount', 'number'), fn: 'SUM' };
const main: ChartMart = { aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: true, metrics: [amount], dates: [date, other], dimensions: [] };
const cf: ChartFields = { marts: [main], dimensions: [], dates: [date, other], counter: null };
const metric: Measure = { kind: 'metric', metric: amount };
const records: Measure = { kind: 'records', aliasPath: '', recordsId: 'records:orders' };
const resolved = (over: Partial<ResolvedCharts> = {}): ResolvedCharts => ({ ...resolveCharts({}, cf), ...over });
const rs = resolved({ date });

describe('sharedSeriesQuery', () => {
  it('is the mart sparkline query itself, so both hooks share one key', () => {
    expect(sharedSeriesQuery(cf, rs, metric, 'MONTH', [])).toEqual(sparklineQuery(main, date, 'MONTH', []));
    expect(sharedSeriesQuery(cf, rs, records, 'MONTH', [])).toEqual(sparklineQuery(main, date, 'MONTH', []));
  });
  it('is null when the sparklines would not be drawn on the series date, are off, or every card is hidden', () => {
    expect(sharedSeriesQuery({ ...cf, marts: [{ ...main, dates: [other] }] }, rs, metric, 'MONTH', [])).toBeNull();
    expect(sharedSeriesQuery(cf, resolved({ date, sparklines: false }), metric, 'MONTH', [])).toBeNull();
    expect(sharedSeriesQuery(cf, resolved({ date, hidden: new Set([main.recordsId, 'amount']) }), metric, 'MONTH', [])).toBeNull();
    expect(sharedSeriesQuery(cf, rs, metric, null, [])).toBeNull();
  });
  it('is null for a measure its mart does not read', () => {
    const ghost: Measure = { kind: 'metric', metric: { field: f('tax', 'number'), fn: 'SUM' } };
    expect(sharedSeriesQuery(cf, rs, ghost, 'MONTH', [])).toBeNull();
    expect(sharedSeriesQuery({ ...cf, marts: [{ ...main, hasPk: false }] }, rs, records, 'MONTH', [])).toBeNull();
  });
  it('asks exactly what the cards ask', () => {
    expect(sparkQueryOf(main, rs, 'MONTH', [])).toEqual(sparklineQuery(main, date, 'MONTH', []));
  });
});

describe('the shared read returns the numbers the separate reads returned', () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const read = (o: TraverseOptions) => readRows(ctx, 'orders', o);
  for (const bucket of ['DAY', 'MONTH', 'YEAR'] as const) {
    for (const [name, measure] of [['a metric', metric], ['the records count', records]] as const) {
      it(`${name} by ${bucket}`, async () => {
        const separate = await read(seriesQuery(date, bucket, measure, []));
        const shared = await read(sharedSeriesQuery(cf, rs, measure, bucket, [])!);
        const key = measureKey(measure);
        expect(separate.length).toBeGreaterThan(0);
        expect(shared.map((x) => [x.created_at, x[key]])).toEqual(separate.map((x) => [x.created_at, x[key]]));
      });
    }
  }
  it('also with a filter', async () => {
    const filter = [{ column: 'status', operator: 'eq' as const, value: 'paid' }];
    const separate = await read(seriesQuery(date, 'MONTH', metric, filter));
    const shared = await read(sharedSeriesQuery(cf, rs, metric, 'MONTH', filter)!);
    expect(shared.map((x) => [x.created_at, x[measureKey(metric)]])).toEqual(separate.map((x) => [x.created_at, x[measureKey(metric)]]));
  });
});
