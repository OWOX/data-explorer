import { describe, expect, it, vi } from 'vitest';
import { heatmapQuery, pieBlankQuery, seriesBlankQuery, SCATTER_LIMIT, scatterQuery, spreadFns, spreadQuery, monthsQuery, pieOtherQuery, rangeKeys, rangeQuery, scoreQuery, scoreRulesLost, countsOf, scorecardsQuery, seriesOtherQuery, seriesQuery, sparklineQuery, topValuesQuery, uniqueKey, metricKey } from './queries';
import type { ChartMart, Metric } from './fields';
import type { Measure } from './queries';
import type { Field } from '../model/types';
import type { TraverseFilter } from '../sdk/types';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const amount: Metric = { field: f('amount', 'number'), fn: 'SUM' };
const ltv: Metric = { field: f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c.x' } }), fn: 'AVG' };
const date = f('date', 'date');
const amt: Measure = { kind: 'metric', metric: amount };
const records: Measure = { kind: 'records', aliasPath: '', recordsId: 'records:M' };
const custRecords: Measure = { kind: 'records', aliasPath: 'c.x', recordsId: 'records:C' };
const channel = f('channel', 'string');
const flt = [{ column: 'channel', operator: 'eq' as const, value: 'web' }];
const main: ChartMart = { aliasPath: '', recordsId: 'records:M', title: 'Orders', hasPk: true, metrics: [amount], dates: [date], dimensions: [channel] };
const cust: ChartMart = { aliasPath: 'c.x', recordsId: 'records:C', title: 'Customers', hasPk: true, metrics: [ltv], dates: [], dimensions: [] };

describe('queries', () => {
  it('scorecards: all metrics and a unique count per mart with a key', () => {
    expect(scorecardsQuery([main, cust], flt)).toEqual({ column: ['amount', 'c__ltv'], aggregation: [{ column: 'amount', function: 'SUM' }, { column: 'c__ltv', function: 'AVG' }], uniqueCount: ['', 'c.x'], filter: flt });
    expect(uniqueKey('c.x')).toBe('c_x__unique_count');
    expect(uniqueKey('')).toBe('Unique Count');
  });
  it('scorecards: unique count alone when no metric; null when nothing', () => {
    expect(scorecardsQuery([{ ...main, metrics: [] }], [])).toEqual({ uniqueCount: [''] });
    expect(scorecardsQuery([{ ...main, metrics: [], hasPk: false }], [])).toBeNull();
  });
  it('scorecards: a range date adds its column and its MIN and MAX', () => {
    expect(scorecardsQuery([main], [], null, [date])).toEqual({
      column: ['amount', 'date'],
      aggregation: [{ column: 'amount', function: 'SUM' }, { column: 'date', function: 'MIN' }, { column: 'date', function: 'MAX' }],
      uniqueCount: [''],
    });
  });
  it('scorecards: a range date carries a slice with no metric and needs no counter column', () => {
    const slice = [{ column: 'channel', operator: 'eq' as const, value: 'web', placement: 'pre-join' as const }];
    const q = scorecardsQuery([{ ...main, metrics: [] }], slice, f('id', 'number'), [date]);
    expect(q).toEqual({ column: ['date'], aggregation: [{ column: 'date', function: 'MIN' }, { column: 'date', function: 'MAX' }], uniqueCount: [''], filter: slice });
  });
  it('scorecards: no range date leaves the query as it was', () => {
    expect(scorecardsQuery([main], [], null, [])).toEqual(scorecardsQuery([main], []));
  });
  it('scoreQuery is the scorecard query of the fields: one builder for the Table and the Charts', () => {
    const cf = { marts: [main, cust], dimensions: [], dates: [], counter: null };
    expect(scoreQuery(cf, flt)).toEqual(scorecardsQuery([main, cust], flt, null));
    // The rules are in it, so two different asks are two different queries.
    expect(scoreQuery(cf, [])).not.toEqual(scoreQuery(cf, flt));
  });
  it('a slice with no metric and no counter field has nowhere to go: the query would be sent without it', () => {
    const slice = { column: 'c__ltv', operator: 'eq' as const, value: 1, placement: 'pre-join' as const };
    const noMetric = { marts: [{ ...main, metrics: [] }], dimensions: [], dates: [], counter: null };
    expect(scoreRulesLost([slice], scoreQuery(noMetric, [slice]))).toBe(true);
    expect(scoreRulesLost([slice], scoreQuery({ ...noMetric, counter: f('channel', 'string') }, [slice]))).toBe(false);
    expect(scoreRulesLost([slice], scoreQuery({ marts: [main], dimensions: [], dates: [], counter: null }, [slice]))).toBe(false);
    expect(scoreRulesLost(flt, scoreQuery(noMetric, flt))).toBe(false);
    expect(scoreRulesLost([slice], null)).toBe(false);
  });
  it('countsOf is the same ask with no metric: the counts a cached read of the same rules also holds', () => {
    const o = scoreQuery({ marts: [main, cust], dimensions: [], dates: [], counter: null }, flt)!;
    expect(countsOf(o)).toEqual({ uniqueCount: ['', 'c.x'], filter: flt });
  });
  it('keys match the aggregated row keys', () => {
    expect(metricKey(amount)).toBe('amount | SUM');
    expect(rangeKeys(date)).toEqual({ min: 'date | MIN', max: 'date | MAX' });
    expect(rangeQuery(date, [])).toEqual({ column: ['date'], aggregation: [{ column: 'date', function: 'MIN' }, { column: 'date', function: 'MAX' }] });
  });
  it('months: the date truncated to months, oldest first, no aggregation', () => {
    const q = monthsQuery(date, flt);
    expect(q).toMatchObject({ column: ['date'], dateTrunc: [{ column: 'date', unit: 'MONTH' }], sort: [{ column: 'date', direction: 'asc' }], filter: flt });
    expect(q.aggregation).toBeUndefined();
    expect('filter' in monthsQuery(date, [])).toBe(false);
  });
  it('top values: no blank rule (null competes), metric desc, 8', () => {
    expect(topValuesQuery(channel, amt, [])).toEqual({ column: ['channel', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }], sort: [{ column: 'amount', direction: 'desc' }], limit: 8 });
  });
  it('blank reads: the blank value alone, and "Other" never holds blanks', () => {
    expect(pieBlankQuery(amt, flt, channel)).toMatchObject({ filter: [...flt, { column: 'channel', operator: 'is_blank' }] });
    expect(seriesBlankQuery(date, 'MONTH', amt, flt, channel).filter).toEqual([...flt, { column: 'channel', operator: 'is_blank' }]);
    expect(seriesBlankQuery(date, 'MONTH', amt, flt, channel).column).toEqual(['date', 'amount']);
    expect(pieOtherQuery(amt, [], channel, ['a']).filter).toEqual([{ column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'not_in', value: ['a'] }]);
  });
  it('series stacked: in top values; other: not_in', () => {
    const s = seriesQuery(date, 'MONTH', amt, flt, { dim: channel, top: ['a', 'b'] });
    expect(s.column).toEqual(['date', 'channel', 'amount']);
    expect(s.filter).toEqual([...flt, { column: 'channel', operator: 'in', value: ['a', 'b'] }]);
    expect(s.sort).toEqual([{ column: 'date', direction: 'asc' }]);
    expect(s.dateTrunc?.[0]).toMatchObject({ column: 'date', unit: 'MONTH' });
    const o = seriesOtherQuery(date, 'MONTH', amt, flt, channel, ['a', 'b']);
    expect(o.column).toEqual(['date', 'amount']);
    expect(o.filter?.at(-1)).toEqual({ column: 'channel', operator: 'not_in', value: ['a', 'b'] });
  });
  it('series without a stack keeps the grid filter only, and omits an empty one', () => {
    expect(seriesQuery(date, 'DAY', amt, flt).filter).toEqual(flt);
    expect('filter' in seriesQuery(date, 'DAY', amt, [])).toBe(false);
  });
  it('records measure: a unique count with no column, sorted by its key', () => {
    expect(topValuesQuery(channel, records, [])).toMatchObject({ column: ['channel'], uniqueCount: [''], sort: [{ column: 'Unique Count', direction: 'desc' }], limit: 8 });
    expect('aggregation' in topValuesQuery(channel, records, [])).toBe(false);
    const s = seriesQuery(date, 'DAY', records, [], { dim: channel, top: ['a'] });
    expect([s.column, s.uniqueCount]).toEqual([['date', 'channel'], ['']]);
    expect(seriesOtherQuery(date, 'DAY', records, [], channel, ['a'])).toMatchObject({ column: ['date'], uniqueCount: [''] });
  });
  it('pie other: the metric over the values outside the top', () => {
    expect(pieOtherQuery(amt, [], channel, ['a'])).toEqual({ column: ['amount'], aggregation: [{ column: 'amount', function: 'SUM' }], filter: [{ column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'not_in', value: ['a'] }] });
  });
  it('a joined mart’s records: its alias path’s unique count, keyed and sorted by its own key', () => {
    expect(topValuesQuery(channel, custRecords, [])).toMatchObject({ column: ['channel'], uniqueCount: ['c.x'], sort: [{ column: 'c_x__unique_count', direction: 'desc' }], limit: 8 });
    expect(seriesQuery(date, 'DAY', custRecords, [])).toMatchObject({ column: ['date'], uniqueCount: ['c.x'] });
    expect(seriesOtherQuery(date, 'DAY', custRecords, [], channel, ['a'])).toMatchObject({ column: ['date'], uniqueCount: ['c.x'] });
    const other = pieOtherQuery(custRecords, [], channel, ['a']);
    expect(other).toEqual({ uniqueCount: ['c.x'], filter: [{ column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'not_in', value: ['a'] }] });
  });
  it('sparklines: the mart’s metrics and its unique count by bucket', () => {
    expect(sparklineQuery(cust, date, 'DAY', [])).toMatchObject({ column: ['date', 'c__ltv'], uniqueCount: ['c.x'], sort: [{ column: 'date', direction: 'asc' }] });
    expect(sparklineQuery({ ...cust, metrics: [], hasPk: false }, date, 'DAY', [])).toBeNull();
  });
  it('a zone rides only on a type with a time of day', () => {
    const ts = f('at', 'date', { type: 'TIMESTAMP' });
    expect(seriesQuery(ts, 'DAY', amt, []).dateTrunc?.[0]).toHaveProperty('timeZone');
    expect(seriesQuery(date, 'DAY', amt, []).dateTrunc?.[0]).not.toHaveProperty('timeZone');
    expect(seriesQuery(f('at', 'date', { type: 'DATETIME' }), 'DAY', amt, []).dateTrunc?.[0]).not.toHaveProperty('timeZone');
  });
});

describe('slices and HAVING filters in chart queries', () => {
  const slice: TraverseFilter = { column: 'c__ltv', operator: 'gt', value: 1, placement: 'pre-join' };
  const having: TraverseFilter = { column: 'amount', operator: 'gt', value: 100, function: 'SUM' };
  it('no HAVING filter goes to a chart query, even one that aggregates the same column', () => {
    expect(scorecardsQuery([main], [having])?.filter).toBeUndefined();
    expect(rangeQuery(date, [having]).filter).toBeUndefined();
    expect(topValuesQuery(channel, amt, [having]).filter).toBeUndefined();
    expect(sparklineQuery(main, date, 'MONTH', [having])?.filter).toBeUndefined();
  });
  it('a slice goes to a query that names its columns, and is left out of one that names none', () => {
    expect(rangeQuery(date, [slice]).filter).toEqual([slice]);
    expect(sparklineQuery(main, date, 'MONTH', [slice])?.filter).toEqual([slice]);
  });
  it('a query with a slice and no column of its own reads one COUNT of the counter, so the slice applies and no group key is added', () => {
    const counter = f('id', 'number');
    const bare = { uniqueCount: ['c.x'], column: ['id'], aggregation: [{ column: 'id', function: 'COUNT' }], filter: [slice] };
    expect(scorecardsQuery([{ ...cust, metrics: [] }], [slice], counter)).toEqual(bare);
    // Without a slice the query stays as it was.
    expect(scorecardsQuery([{ ...cust, metrics: [] }], [], counter)).toEqual({ uniqueCount: ['c.x'] });
    // Without a counter the slice is left out.
    expect(scorecardsQuery([{ ...cust, metrics: [] }], [slice])).toEqual({ uniqueCount: ['c.x'] });
  });
  it('pie Other sends the same slice as the top-N query', () => {
    const counter = f('id', 'number');
    const top = topValuesQuery(channel, custRecords, [slice]);
    const other = pieOtherQuery(custRecords, [slice], channel, ['a'], counter);
    expect(top.filter).toContainEqual(slice);
    expect(other.filter).toContainEqual(slice);
    expect(other.column).toEqual(['id']);
    expect(other.aggregation).toEqual([{ column: 'id', function: 'COUNT' }]);
    expect(other.uniqueCount).toEqual(['c.x']);
  });
});

describe('bucketZone', () => {
  it('reads the browser zone once, however many queries are built', async () => {
    vi.resetModules();
    const { bucketZone } = await import('./queries');
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      const ts = { name: 'ts', alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false } as Field;
      bucketZone(ts);
      const built = spy.mock.calls.length;
      expect(built).toBe(1);
      bucketZone(ts);
      bucketZone(ts);
      expect(spy.mock.calls.length).toBe(built);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('heatmap, scatter and spread queries', () => {
  const fld = (name: string, category: string, extra: object = {}) => ({ name, category, type: category === 'number' ? 'NUMERIC' : category === 'date' ? 'DATE' : 'STRING', ...extra }) as never;
  const status = fld('status', 'string');
  const chan = fld('channel', 'string');
  const day = fld('day', 'date');
  const amountF = fld('amount', 'number');
  const sum = { kind: 'metric', metric: { field: amountF, fn: 'SUM' } } as const;
  const recs = { kind: 'records', aliasPath: '', recordsId: 'records:M' } as const;

  it('heatmap by date buckets the date and keeps the rows to the top list', () => {
    expect(heatmapQuery({ kind: 'date', date: day, bucket: 'MONTH' }, status, ['a', 'b'], sum, [])).toEqual({
      column: ['day', 'status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }],
      dateTrunc: [{ column: 'day', unit: 'MONTH' }], sort: [{ column: 'day', direction: 'asc' }],
      filter: [{ column: 'status', operator: 'in', value: ['a', 'b'] }],
    });
  });

  it('heatmap by two dimensions keeps both axes to their top lists', () => {
    const o = heatmapQuery({ kind: 'dim', dim: chan, top: ['x'] }, status, ['a'], recs, []);
    expect(o.column).toEqual(['channel', 'status']);
    expect(o.uniqueCount).toEqual(['']);
    expect(o.filter).toEqual([
      { column: 'status', operator: 'in', value: ['a'] },
      { column: 'channel', operator: 'in', value: ['x'] },
    ]);
  });

  it('a null axis list reads the blank value alone, since a list cannot name NULL', () => {
    expect(heatmapQuery({ kind: 'dim', dim: chan, top: null }, status, null, recs, []).filter).toEqual([
      { column: 'status', operator: 'is_blank' }, { column: 'channel', operator: 'is_blank' },
    ]);
    expect(heatmapQuery({ kind: 'date', date: day, bucket: 'MONTH' }, status, null, sum, []).filter).toEqual([{ column: 'status', operator: 'is_blank' }]);
  });

  it('scatter reads two measures per dimension value, the top 200 by X', () => {
    const avg = { kind: 'metric', metric: { field: amountF, fn: 'AVG' } } as const;
    expect(scatterQuery(status, sum, avg, [])).toEqual({
      column: ['status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'AVG' }],
      sort: [{ column: 'amount', direction: 'desc' }], limit: SCATTER_LIMIT,
    });
  });

  it('spread needs the three percentiles; whiskers only when MIN and MAX are allowed', () => {
    expect(spreadFns(amountF)).toEqual([]);
    const governed = fld('net', 'number', { allowedAggregations: ['P25', 'P50', 'P75', 'MIN', 'MAX'] });
    expect(spreadFns(governed)).toEqual(['P50', 'P25', 'P75', 'MIN', 'MAX']);
    expect(spreadFns(fld('n2', 'number', { allowedAggregations: ['P25', 'P50', 'P75'] }))).toEqual(['P50', 'P25', 'P75']);
    expect(spreadQuery(status, governed, [])).toEqual({
      column: ['status', 'net'], aggregation: ['P50', 'P25', 'P75', 'MIN', 'MAX'].map((fn) => ({ column: 'net', function: fn })),
      sort: [{ column: 'net', direction: 'desc' }], limit: 8,
    });
  });
});

describe('calculated metrics', () => {
  const net: Metric = { field: f('net.x', 'number', { isCalculated: true, calculatedLevel: 'metric' }), fn: null };
  const netM: Measure = { kind: 'metric', metric: net };
  const both: ChartMart = { ...main, metrics: [amount, net] };
  const only: ChartMart = { ...main, metrics: [net] };
  it('metricKey is the column name, dots kept', () => {
    expect(metricKey(net)).toBe('net.x');
    expect(metricKey(amount)).toBe('amount | SUM');
  });
  it('scorecards: named as a column, left out of aggregation', () => {
    expect(scorecardsQuery([only], [])).toEqual({ column: ['net.x'], uniqueCount: [''] });
    expect(scorecardsQuery([both], [])).toEqual({ column: ['amount', 'net.x'], aggregation: [{ column: 'amount', function: 'SUM' }], uniqueCount: [''] });
    expect(scorecardsQuery([{ ...only, hasPk: false }], [])).toEqual({ column: ['net.x'] });
  });
  it('sparkline', () => {
    expect(sparklineQuery(only, date, 'MONTH', [])).toMatchObject({ column: ['date', 'net.x'], uniqueCount: [''] });
    expect(sparklineQuery(only, date, 'MONTH', [])).not.toHaveProperty('aggregation');
    expect(sparklineQuery(both, date, 'MONTH', [])!.aggregation).toEqual([{ column: 'amount', function: 'SUM' }]);
  });
  it('series, top values and scatter', () => {
    expect(seriesQuery(date, 'MONTH', netM, [])).toMatchObject({ column: ['date', 'net.x'], sort: [{ column: 'date', direction: 'asc' }] });
    expect(seriesQuery(date, 'MONTH', netM, [])).not.toHaveProperty('aggregation');
    expect(topValuesQuery(channel, netM, [])).toMatchObject({ column: ['channel', 'net.x'], sort: [{ column: 'net.x', direction: 'desc' }] });
    expect(topValuesQuery(channel, netM, [])).not.toHaveProperty('aggregation');
    expect(scatterQuery(channel, netM, records, [])).not.toHaveProperty('aggregation');
    expect(scatterQuery(channel, netM, records, [])).toMatchObject({ column: ['channel', 'net.x'], uniqueCount: [''] });
    expect(scatterQuery(channel, netM, amt, [])!.aggregation).toEqual([{ column: 'amount', function: 'SUM' }]);
  });
});
