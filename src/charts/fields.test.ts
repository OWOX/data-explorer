import { describe, expect, it } from 'vitest';
import { chartFields, measuresOf, pickBucket, pieMeasures } from './fields';
import type { Field } from '../model/types';
import { NO_AGGREGATION } from '../model/aggregation';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const schema = [
  f('id', 'string', { isPrimaryKey: true }), f('date', 'date'), f('amount', 'number'), f('qty', 'number'), f('channel', 'string'),
  f('c__city', 'string', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('calc', 'number', { isCalculated: true }),
];

describe('chartFields', () => {
  it('classifies shown fields per mart, in group order', () => {
    const r = chartFields(schema, ['id', 'date', 'amount', 'channel', 'c__city', 'c__ltv', 'calc'], NO_AGGREGATION, 'M', ['', 'c']);
    expect(r.marts.map((m) => m.martId)).toEqual(['M', 'C']);
    expect(r.marts[0]!.hasPk).toBe(true);
    expect(r.marts[0]!.metrics.map((m) => [m.field.name, m.fn])).toEqual([['amount', 'SUM']]);
    expect(r.marts[1]!.metrics.map((m) => m.field.name)).toEqual(['c__ltv']);
    expect(r.marts[1]!.aliasPath).toBe('c');
    expect(r.dimensions.map((d) => d.name)).toEqual(['channel', 'c__city']);
    expect(r.dates.map((d) => d.name)).toEqual(['date']);
  });
  it('does not depend on the order of the shown columns (a column move changes no chart)', () => {
    const shown = ['id', 'date', 'amount', 'qty', 'channel', 'c__city', 'c__ltv'];
    const a = chartFields(schema, shown, NO_AGGREGATION, 'M', ['', 'c']);
    const b = chartFields(schema, [...shown].reverse(), NO_AGGREGATION, 'M', ['', 'c']);
    expect(b.metrics.map((m) => m.field.name)).toEqual(a.metrics.map((m) => m.field.name));
    expect(b.metrics[0]!.field.name).toBe('amount');
    expect(b.dates.map((d) => d.name)).toEqual(a.dates.map((d) => d.name));
    expect(b.dimensions.map((d) => d.name)).toEqual(a.dimensions.map((d) => d.name));
  });
  it('uses the grid Σ function of a column', () => {
    const r = chartFields(schema, ['amount'], { aggregations: [{ column: 'amount', function: 'AVG' }, { column: 'amount', function: 'MAX' }], dateTrunc: [] }, 'M', ['']);
    expect(r.metrics[0]!.fn).toBe('AVG');
  });
  it('falls back to the first allowed function when SUM is not allowed', () => {
    const r = chartFields([f('x', 'number', { allowedAggregations: ['MAX', 'MIN'] })], ['x'], NO_AGGREGATION, 'M', ['']);
    expect(r.metrics[0]!.fn).toBe('MIN'); // AGGREGATE_FUNCTIONS order
  });
  it('a joined mart with a primary key is hasPk', () => {
    const s = [...schema, f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } })];
    expect(chartFields(s, ['c__ltv'], NO_AGGREGATION, 'M', ['', 'c'], new Set(['c'])).marts.find((m) => m.martId === 'C')!.hasPk).toBe(true);
    expect(chartFields(s, ['c__ltv'], NO_AGGREGATION, 'M', ['', 'c']).marts.find((m) => m.martId === 'C')!.hasPk).toBe(false);
  });
});

describe('measures', () => {
  const cf = chartFields(schema, ['id', 'date', 'amount', 'c__city', 'c__ltv'], NO_AGGREGATION, 'M', ['', 'c'], new Set(['c']), { '': 'Orders', c: 'Customers' });
  it('lists, per mart in group order, its Unique Records (when keyed) then its metrics', () => {
    expect(measuresOf(cf).map((m) => (m.kind === 'records' ? ['records', m.martId, m.aliasPath] : ['metric', m.metric.field.name]))).toEqual([['records', 'M', ''], ['metric', 'amount'], ['records', 'C', 'c'], ['metric', 'c__ltv']]);
    expect(cf.marts.map((m) => m.title)).toEqual(['Orders', 'Customers']);
  });
  it('leaves out the records of a mart with no key', () => {
    const noKey = chartFields(schema, ['amount', 'c__ltv'], NO_AGGREGATION, 'M', ['', 'c']);
    expect(measuresOf(noKey).filter((m) => m.kind === 'records').map((m) => m.martId)).toEqual(['M']);
  });
  it('the pie keeps every records and only summable metrics, summed', () => {
    const avg = chartFields(schema, ['amount', 'c__ltv'], { aggregations: [{ column: 'amount', function: 'AVG' }], dateTrunc: [] }, 'M', ['', 'c'], new Set(['c']));
    expect(pieMeasures(avg).map((m) => (m.kind === 'records' ? `records:${m.martId}` : `${m.metric.field.name}:${m.metric.fn}`))).toEqual(['records:M', 'amount:SUM', 'records:C', 'c__ltv:SUM']);
  });
});

describe('id fields', () => {
  it('are neither metrics nor dimensions', () => {
    const s = [f('amount', 'number'), f('customer_id', 'number'), f('Id', 'number'), f('order_id', 'string'), f('pk', 'number', { isPrimaryKey: true }), f('channel', 'string'), f('ref', 'string', { alias: 'Order ID' })];
    const r = chartFields(s, s.map((x) => x.name), NO_AGGREGATION, 'M', ['']);
    expect(r.metrics.map((m) => m.field.name)).toEqual(['amount']);
    expect(r.dimensions.map((d) => d.name)).toEqual(['channel']);
  });
});

describe('pickBucket', () => {
  it.each([
    ['2026-01-01', '2026-02-15', 'DAY'],
    ['2026-01-01', '2026-10-01', 'WEEK'],
    ['2022-01-01', '2026-01-01', 'MONTH'],
    ['2015-01-01', '2026-01-01', 'QUARTER'],
    ['1900-01-01', '2026-01-01', 'YEAR'],
    ['2026-01-01', '2026-01-01', 'DAY'],
    [null, '2026-01-01', 'MONTH'],
    ['garbage', '2026-01-01', 'MONTH'],
    ['2022-01-01 00:00:00', '2026-01-01 00:00:00', 'MONTH'],
    ['2022-01-01 00:00:00 UTC', '2026-01-01 00:00:00 UTC', 'MONTH'],
    ['2026-01-01 10:00:00 UTC', '2026-01-20 10:00:00 UTC', 'DAY'],
    ['2026-01-01T10:00:00Z', '2026-01-20T10:00:00Z', 'DAY'],
  ])('%s..%s → %s', (a, b, want) => expect(pickBucket(a, b)).toBe(want));
});
