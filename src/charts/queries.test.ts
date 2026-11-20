import { describe, expect, it, vi } from 'vitest';
import { monthsQuery, pieOtherQuery, rangeKeys, rangeQuery, scorecardsQuery, seriesOtherQuery, seriesQuery, sparklineQuery, topValuesQuery, uniqueKey, metricKey } from './queries';
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
  it('top values: blank excluded, metric desc, 8', () => {
    expect(topValuesQuery(channel, amt, [])).toEqual({ column: ['channel', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }], filter: [{ column: 'channel', operator: 'is_not_blank' }], sort: [{ column: 'amount', direction: 'desc' }], limit: 8 });
  });
  it('series stacked: in top values; other: not_in', () => {
    const s = seriesQuery(date, 'MONTH', amt, flt, { dim: channel, top: ['a', 'b'] });
    expect(s.column).toEqual(['date', 'channel', 'amount']);
    expect(s.filter).toEqual([...flt, { column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'in', value: ['a', 'b'] }]);
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
    expect(topValuesQuery(channel, amt, [having]).filter).toEqual([{ column: 'channel', operator: 'is_not_blank' }]);
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
