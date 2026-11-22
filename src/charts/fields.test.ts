import { describe, expect, it } from 'vitest';
import { chartFields, measuresOf, ruleNewColumns, pickBucket, pieMeasures, sankeyMeasures } from './fields';
import type { Field, Schema } from '../model/types';
import { NO_AGGREGATION } from '../model/aggregation';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const schema = [
  f('id', 'string', { isPrimaryKey: true }), f('date', 'date'), f('amount', 'number'), f('qty', 'number'), f('channel', 'string'),
  f('c__city', 'string', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('calc', 'number', { isCalculated: true }),
];

describe('Count Unique of the main mart', () => {
  it('is offered for a key hidden for reporting, which is not a field of the schema', () => {
    const hidden: Schema = Object.assign([f('amount', 'number'), f('channel', 'string')], { primaryKey: ['id'] });
    expect(chartFields(hidden, [], NO_AGGREGATION, 'M', [''])!.marts[0]!.hasPk).toBe(true);
    expect(chartFields([f('amount', 'number')], [], NO_AGGREGATION, 'M', [''])!.marts[0]!.hasPk).toBe(false);
  });
});

describe('the counter of chartFields', () => {
  const pick = (fields: Field[]) => chartFields(fields, [], NO_AGGREGATION, 'M', [''])?.counter?.name ?? null;
  it('skips joined fields, calculated fields, category other and fields whose governance allows no COUNT', () => {
    const fields = [
      f('c__city', 'string', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
      f('calc', 'string', { isCalculated: true }),
      f('tags', 'other'),
      f('no_count', 'string', { allowedAggregations: ['MAX'] }),
      f('status', 'string'),
    ];
    expect(pick(fields)).toBe('status');
    expect(pick(fields.slice(0, 4))).toBeNull();
  });
});

describe('chartFields', () => {
  it('classifies shown fields per mart, in group order', () => {
    const r = chartFields(schema, ['id', 'date', 'amount', 'channel', 'c__city', 'c__ltv', 'calc'], NO_AGGREGATION, 'M', ['', 'c']);
    expect(r.marts.map((m) => m.aliasPath)).toEqual(['', 'c']);
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
    const metricNames = (cf: ReturnType<typeof chartFields>) => cf.marts.flatMap((m) => m.metrics).map((m) => m.field.name);
    expect(metricNames(b)).toEqual(metricNames(a));
    expect(metricNames(b)[0]).toBe('amount');
    expect(b.dates.map((d) => d.name)).toEqual(a.dates.map((d) => d.name));
    expect(b.dimensions.map((d) => d.name)).toEqual(a.dimensions.map((d) => d.name));
  });
  it('uses the grid Σ function of a column', () => {
    const r = chartFields(schema, ['amount'], { aggregations: [{ column: 'amount', function: 'AVG' }, { column: 'amount', function: 'MAX' }], dateTrunc: [] }, 'M', ['']);
    expect(r.marts[0]!.metrics[0]!.fn).toBe('AVG');
  });
  it('falls back to the first allowed function when SUM is not allowed', () => {
    const r = chartFields([f('x', 'number', { allowedAggregations: ['MAX', 'MIN'] })], ['x'], NO_AGGREGATION, 'M', ['']);
    expect(r.marts[0]!.metrics[0]!.fn).toBe('MIN'); // AGGREGATE_FUNCTIONS order
  });
  it('a joined mart with a primary key is hasPk', () => {
    const s = [...schema, f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } })];
    expect(chartFields(s, ['c__ltv'], NO_AGGREGATION, 'M', ['', 'c'], new Set(['c'])).marts.find((m) => m.aliasPath === 'c')!.hasPk).toBe(true);
    expect(chartFields(s, ['c__ltv'], NO_AGGREGATION, 'M', ['', 'c']).marts.find((m) => m.aliasPath === 'c')!.hasPk).toBe(false);
  });
});

describe('measures', () => {
  const cf = chartFields(schema, ['id', 'date', 'amount', 'c__city', 'c__ltv'], NO_AGGREGATION, 'M', ['', 'c'], new Set(['c']), { '': 'Orders', c: 'Customers' });
  it('lists, per mart in group order, its Count Unique (when keyed) then its metrics', () => {
    expect(measuresOf(cf).map((m) => (m.kind === 'records' ? ['records', m.recordsId, m.aliasPath] : ['metric', m.metric.field.name]))).toEqual([['records', 'records:M', ''], ['metric', 'amount'], ['records', 'records:C', 'c'], ['metric', 'c__ltv']]);
    expect(cf.marts.map((m) => m.title)).toEqual(['Orders', 'Customers']);
  });
  it('leaves out the records of a mart with no key', () => {
    const noKey = chartFields(schema, ['amount', 'c__ltv'], NO_AGGREGATION, 'M', ['', 'c']);
    expect(measuresOf(noKey).filter((m) => m.kind === 'records').map((m) => m.recordsId)).toEqual(['records:M']);
  });
  it('the pie keeps every records and only summable metrics, summed', () => {
    const avg = chartFields(schema, ['amount', 'c__ltv'], { aggregations: [{ column: 'amount', function: 'AVG' }], dateTrunc: [] }, 'M', ['', 'c'], new Set(['c']));
    expect(pieMeasures(avg).map((m) => (m.kind === 'records' ? m.recordsId : `${m.metric.field.name}:${m.metric.fn}`))).toEqual(['records:M', 'amount:SUM', 'records:C', 'c__ltv:SUM']);
  });
});

describe('id fields', () => {
  it('are neither metrics nor dimensions', () => {
    const s = [f('amount', 'number'), f('customer_id', 'number'), f('Id', 'number'), f('order_id', 'string'), f('pk', 'number', { isPrimaryKey: true }), f('channel', 'string'), f('ref', 'string', { alias: 'Order ID' })];
    const r = chartFields(s, s.map((x) => x.name), NO_AGGREGATION, 'M', ['']);
    expect(r.marts[0]!.metrics.map((m) => m.field.name)).toEqual(['amount']);
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

describe('the measures a Sankey may sum', () => {
  const cf = chartFields(Object.assign([...schema, f('c__plan', 'string', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } })], { primaryKey: ['id'] }), schema.map((x) => x.name).concat('c__plan'), NO_AGGREGATION, 'M', ['', 'c'], new Set(['c']))!;
  const ids = (dims: string[]) => sankeyMeasures(cf, dims.map((n) => [...cf.dimensions].find((d) => d.name === n)!)).map((m) => (m.kind === 'records' ? `records@${m.aliasPath}` : m.metric.field.name));
  it('are the own mart\'s Count Unique and metrics when every column is on that mart', () => {
    expect(ids(['channel'])).toEqual(['records@', 'amount', 'qty']);
    expect(ids(['c__city', 'c__plan'])).toEqual(['records@c', 'c__ltv']);
  });
  it('are none when the columns span marts: a joined row repeats a record, and adding the groups counts it again', () => {
    expect(ids(['channel', 'c__city'])).toEqual([]);
  });
});

describe('a main mart measure by columns of joined marts', () => {
  const joined = (path: string, name: string) => f(name, 'string', { joined: { martId: path, label: path, aliasPath: path } });
  const all = Object.assign([...schema, joined('c', 'c__name'), joined('c.r', 'c__r__name'), joined('i', 'i__sku')], { primaryKey: ['id'] });
  const shown = all.map((x) => x.name);
  const run = (mult: Record<string, 'none' | 'collapses'> | undefined, dims: string[]) => {
    const cf = chartFields(all, shown, NO_AGGREGATION, 'M', ['', 'c', 'c.r', 'i'], new Set(['c']), {}, mult)!;
    return sankeyMeasures(cf, dims.map((n) => cf.dimensions.find((d) => d.name === n)!)).map((m) => (m.kind === 'records' ? `records@${m.aliasPath}` : m.metric.field.name));
  };
  const main = ['records@', 'amount', 'qty'];
  it('is offered when the joined mart is a lookup (collapse none)', () => expect(run({ c: 'none' }, ['channel', 'c__name'])).toEqual(main));
  it('is not offered when the joined mart collapses', () => expect(run({ c: 'collapses' }, ['channel', 'c__name'])).toEqual([]));
  it('is not offered when the backend sends nothing', () => {
    expect(run(undefined, ['channel', 'c__name'])).toEqual([]);
    expect(run({}, ['channel', 'c__name'])).toEqual([]);
  });
  it('trusts the verdict on the path itself, not its ancestors', () => {
    expect(run({ 'c.r': 'none' }, ['channel', 'c__r__name'])).toEqual(main);
    expect(run({ c: 'none', 'c.r': 'collapses' }, ['channel', 'c__r__name'])).toEqual([]);
  });
  it('needs every chosen column to be a lookup', () => {
    expect(run({ c: 'none', i: 'collapses' }, ['c__name', 'i__sku'])).toEqual([]);
    expect(run({ c: 'none', i: 'none' }, ['c__name', 'i__sku'])).toEqual(main);
  });
  it("keeps a joined mart's measure on its own mart, whatever the verdict", () => {
    expect(run({ c: 'none', i: 'none' }, ['c__name', 'i__sku'])).not.toContain('c__ltv');
    expect(run({ c: 'none' }, ['channel', 'c__name'])).not.toContain('records@c');
    expect(run({ c: 'collapses' }, ['c__name', 'c__city'])).toEqual(['records@c', 'c__ltv']);
  });
});

describe('rules for columns a chart choice has just shown', () => {
  const by = (n: string) => schema.find((x) => x.name === n)!;
  const grouped = { aggregations: [{ column: 'qty', function: 'SUM' as const }], dateTrunc: [] };
  it('leaves an ungrouped grid alone', () => {
    expect(ruleNewColumns(NO_AGGREGATION, [by('amount'), by('date')])).toBe(NO_AGGREGATION);
  });
  it('gives a metric the grid\'s function, so the new column is not a group key', () => {
    expect(ruleNewColumns({ ...grouped, aggregations: [...grouped.aggregations, { column: 'amount', function: 'AVG' }] }, [by('c__ltv')]).aggregations).toEqual([{ column: 'qty', function: 'SUM' }, { column: 'amount', function: 'AVG' }, { column: 'c__ltv', function: 'SUM' }]);
  });
  it('truncates a date by the chart\'s bucket, Month when none is known, and leaves a dimension a key', () => {
    expect(ruleNewColumns(grouped, [by('date')], { date: 'WEEK' }).dateTrunc).toEqual([{ column: 'date', unit: 'WEEK' }]);
    expect(ruleNewColumns(grouped, [by('date')]).dateTrunc).toEqual([{ column: 'date', unit: 'MONTH' }]);
    const out = ruleNewColumns(grouped, [by('channel'), by('id')]);
    expect(out.aggregations).toEqual(grouped.aggregations);
    expect(out.dateTrunc).toEqual([]);
  });
});
