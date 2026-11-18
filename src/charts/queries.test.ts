import { describe, expect, it } from 'vitest';
import { pieOtherQuery, rangeKeys, rangeQuery, scorecardsQuery, seriesOtherQuery, seriesQuery, sparklineQuery, topValuesQuery, uniqueKey, metricKey } from './queries';
import type { ChartMart, Metric } from './fields';
import type { Field } from '../model/types';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const amount: Metric = { field: f('amount', 'number'), fn: 'SUM', martId: 'M' };
const ltv: Metric = { field: f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c.x' } }), fn: 'AVG', martId: 'C' };
const date = f('date', 'date');
const channel = f('channel', 'string');
const flt = [{ column: 'channel', operator: 'eq' as const, value: 'web' }];
const main: ChartMart = { martId: 'M', aliasPath: '', hasPk: true, metrics: [amount], dates: [date], dimensions: [channel] };
const cust: ChartMart = { martId: 'C', aliasPath: 'c.x', hasPk: true, metrics: [ltv], dates: [], dimensions: [] };

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
  it('top values: blank excluded, metric desc, 8', () => {
    expect(topValuesQuery(channel, amount, [])).toEqual({ column: ['channel', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }], filter: [{ column: 'channel', operator: 'is_not_blank' }], sort: [{ column: 'amount', direction: 'desc' }], limit: 8 });
  });
  it('series stacked: in top values; other: not_in', () => {
    const s = seriesQuery(date, 'MONTH', amount, flt, { dim: channel, top: ['a', 'b'] });
    expect(s.column).toEqual(['date', 'channel', 'amount']);
    expect(s.filter).toEqual([...flt, { column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'in', value: ['a', 'b'] }]);
    expect(s.sort).toEqual([{ column: 'date', direction: 'asc' }]);
    expect(s.dateTrunc?.[0]).toMatchObject({ column: 'date', unit: 'MONTH' });
    const o = seriesOtherQuery(date, 'MONTH', amount, flt, channel, ['a', 'b']);
    expect(o.column).toEqual(['date', 'amount']);
    expect(o.filter?.at(-1)).toEqual({ column: 'channel', operator: 'not_in', value: ['a', 'b'] });
  });
  it('series without a stack keeps the grid filter only, and omits an empty one', () => {
    expect(seriesQuery(date, 'DAY', amount, flt).filter).toEqual(flt);
    expect('filter' in seriesQuery(date, 'DAY', amount, [])).toBe(false);
  });
  it('pie other: the metric over the values outside the top', () => {
    expect(pieOtherQuery(amount, [], channel, ['a'])).toEqual({ column: ['amount'], aggregation: [{ column: 'amount', function: 'SUM' }], filter: [{ column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'not_in', value: ['a'] }] });
  });
  it('sparklines: the mart’s metrics and its unique count by bucket', () => {
    expect(sparklineQuery(cust, date, 'DAY', [])).toMatchObject({ column: ['date', 'c__ltv'], uniqueCount: ['c.x'], sort: [{ column: 'date', direction: 'asc' }] });
    expect(sparklineQuery({ ...cust, metrics: [], hasPk: false }, date, 'DAY', [])).toBeNull();
  });
  it('a zone rides only on a type with a time of day', () => {
    const ts = f('at', 'date', { type: 'TIMESTAMP' });
    expect(seriesQuery(ts, 'DAY', amount, []).dateTrunc?.[0]).toHaveProperty('timeZone');
    expect(seriesQuery(date, 'DAY', amount, []).dateTrunc?.[0]).not.toHaveProperty('timeZone');
  });
});
