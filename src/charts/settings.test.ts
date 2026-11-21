import { describe, expect, it, test } from 'vitest';
import { chartsOf, DEFAULT_CHARTS, editCharts, isChartKind, measureId, newChartId, patchChart, pickBucketChoice, pickField, pickMeasure, resolveCharts, scorecardsOf, type ChartSettingsV2 } from './settings';
import type { ChartFields, ChartMart, Metric } from './fields';
import type { Measure } from './queries';
import type { Field } from '../model/types';

const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: false });
const mart = (martId: string, extra: Partial<ChartMart> = {}): ChartMart => ({ aliasPath: martId === 'M' ? '' : 'c', recordsId: `records:${martId}`, title: martId === 'M' ? 'Orders' : 'Customers', hasPk: false, metrics: [], dates: [], dimensions: [], ...extra });
const cf: ChartFields = {
  marts: [mart('M', { metrics: [{ field: f('amount', 'number'), fn: 'SUM' }, { field: f('qty', 'number'), fn: 'SUM' }] })],
  dimensions: [f('channel', 'string'), f('city', 'string')],
  dates: [f('d1', 'date'), f('d2', 'date')],
};

const name = (m: Measure | null) => (m?.kind === 'metric' ? m.metric.field.name : m?.kind === 'records' ? m.recordsId : null);
const fn = (m: Measure | null) => (m?.kind === 'metric' ? m.metric.fn : null);
const withMetrics = (metrics: Metric[]): ChartFields => ({ ...cf, marts: [mart('M', { metrics })] });

describe('resolveCharts', () => {
  it('defaults', () => {
    const r = resolveCharts({}, cf);
    expect(r.date?.name).toBe('d1');
    expect(r.bucket).toBe('AUTO');
    expect(name(r.measure)).toBe('amount');
    expect(r.stack).toBeNull();
    expect(r.orientation).toBe('vertical');
    expect(r.sparklines).toBe(true);
    expect(r.hidden.size).toBe(0);
    expect(name(r.pieMeasure)).toBe('amount');
    expect(r.pieDimension?.name).toBe('channel');
  });
  it('uses saved names that are shown', () => {
    const r = resolveCharts({
      scorecards: { hidden: ['x'], sparklines: false },
      timeSeries: { date: 'd2', bucket: 'WEEK', metric: 'qty', stack: 'city', orientation: 'horizontal' },
      pie: { metric: 'qty', dimension: 'city' },
    }, cf);
    expect([r.date?.name, r.bucket, name(r.measure), r.stack?.name, r.orientation]).toEqual(['d2', 'WEEK', 'qty', 'city', 'horizontal']);
    expect([name(r.pieMeasure), r.pieDimension?.name, r.sparklines]).toEqual(['qty', 'city', false]);
    expect([...r.hidden]).toEqual(['x']);
  });
  it('falls back for names no longer shown', () => {
    const r = resolveCharts({ timeSeries: { date: 'gone', metric: 'gone', stack: 'gone' }, pie: { metric: 'gone', dimension: 'gone' } }, cf);
    expect([r.date?.name, name(r.measure), r.stack, name(r.pieMeasure), r.pieDimension?.name]).toEqual(['d1', 'amount', null, 'amount', 'channel']);
  });
  it('rejects an invalid bucket or orientation', () => {
    const r = resolveCharts({ timeSeries: { bucket: 'HOUR' as never, orientation: 'x' as never } }, cf);
    expect([r.bucket, r.orientation]).toEqual(['AUTO', 'vertical']);
  });
  it('the pie takes only metrics that may be summed: a saved one that may not falls back to the first that may', () => {
    const noSum = { ...f('price', 'number'), allowedAggregations: ['MIN', 'MAX'] as const } as unknown as Field;
    const only = resolveCharts({ pie: { metric: 'price' } }, withMetrics([{ field: noSum, fn: 'MIN' }, ...cf.marts[0]!.metrics]));
    expect([name(only.pieMeasure), name(only.measure)]).toEqual(['amount', 'price']);
    expect(resolveCharts({}, withMetrics([{ field: noSum, fn: 'MIN' }])).pieMeasure).toBeNull();
  });
  it('the pie always sums, whatever function the grid shows', () => {
    const r = resolveCharts({}, withMetrics([{ field: f('amount', 'number'), fn: 'AVG' }]));
    expect([fn(r.pieMeasure), fn(r.measure)]).toEqual(['SUM', 'AVG']);
  });
  it('is null everywhere with nothing shown', () => {
    const r = resolveCharts({}, { marts: [], dimensions: [], dates: [] });
    expect([r.date, r.measure, r.pieMeasure, r.pieDimension]).toEqual([null, null, null, null]);
  });
});

describe('measure', () => {
  const ltv: Metric = { field: f('c__ltv', 'number'), fn: 'SUM' };
  const two = (mainPk: boolean, joinedPk: boolean): ChartFields => {
    const marts = [mart('M', { hasPk: mainPk, metrics: cf.marts[0]!.metrics }), mart('C', { hasPk: joinedPk, metrics: [ltv] })];
    return { ...cf, marts };
  };
  const pk = two(true, true);
  it('is the saved metric, else records when saved and keyed, else the first metric', () => {
    expect(name(resolveCharts({ timeSeries: { metric: 'qty' } }, pk).measure)).toBe('qty');
    expect(name(resolveCharts({ timeSeries: { metric: 'records' } }, pk).measure)).toBe('records:M');
    expect(name(resolveCharts({ timeSeries: { metric: 'records' } }, cf).measure)).toBe('amount');
    expect(name(resolveCharts({}, pk).measure)).toBe('amount');
  });
  it('resolves records:<martId> to that joined mart, and the same for the pie', () => {
    const r = resolveCharts({ timeSeries: { metric: 'records:C' }, pie: { metric: 'records:C' } }, pk);
    expect(r.measure).toEqual({ kind: 'records', aliasPath: 'c', recordsId: 'records:C' });
    expect(r.pieMeasure).toEqual({ kind: 'records', aliasPath: 'c', recordsId: 'records:C' });
    expect(measureId(r.measure!)).toBe('records:C');
    expect(measureId(resolveCharts({ timeSeries: { metric: 'records' } }, pk).measure!)).toBe('records');
  });
  it('a joined metric pairs with the main mart: saved by field name', () => {
    expect(name(resolveCharts({ timeSeries: { metric: 'c__ltv' } }, pk).measure)).toBe('c__ltv');
  });
  it('falls back when the saved mart has no key (any more)', () => {
    const r = resolveCharts({ timeSeries: { metric: 'records:C' }, pie: { metric: 'records:C' } }, two(true, false));
    expect([name(r.measure), name(r.pieMeasure)]).toEqual(['amount', 'amount']);
  });
  it('is records with a key and no metric, null without either', () => {
    const only = { ...cf, marts: [mart('M', { hasPk: true })] };
    expect(name(resolveCharts({}, only).measure)).toBe('records:M');
    expect(name(resolveCharts({}, only).pieMeasure)).toBe('records:M');
    expect(resolveCharts({}, { marts: [], dimensions: [], dates: [] }).measure).toBeNull();
  });
});

describe('saved doc v2', () => {
  test('no charts saved means the default time series and pie; an empty list stays empty', () => {
    expect(chartsOf({})).toEqual(DEFAULT_CHARTS);
    expect(DEFAULT_CHARTS.map((c) => c.kind)).toEqual(['timeSeries', 'pie']);
    expect(chartsOf({ version: 2, charts: [] })).toEqual([]);
  });
  test('editCharts applies to the defaults when nothing is saved and always writes version 2', () => {
    const s = editCharts({ scorecards: { sparklines: false } }, (list) => list.filter((c) => c.kind !== 'pie'));
    expect(s).toEqual({ version: 2, scorecards: { sparklines: false }, charts: [{ id: 'time-series', kind: 'timeSeries' }] });
  });
  test('patchChart changes one chart by id and keeps the rest', () => {
    const s: ChartSettingsV2 = { version: 2, charts: [{ id: 'a', kind: 'pie' }, { id: 'b', kind: 'line' }] };
    expect(patchChart(s, 'b', { area: true }).charts).toEqual([{ id: 'a', kind: 'pie' }, { id: 'b', kind: 'line', area: true }]);
  });
  test('pickMeasure: the saved id, else the first metric, else the first measure', () => {
    const rec = { kind: 'records', aliasPath: '', recordsId: 'records:M' } as const;
    const amt = { kind: 'metric', metric: { field: { name: 'amount' }, fn: 'SUM' } } as never;
    expect(pickMeasure([rec, amt], 'records')).toBe(rec);
    expect(pickMeasure([rec, amt], 'gone')).toBe(amt);
    expect(pickMeasure([rec], undefined)).toBe(rec);
    expect(pickMeasure([], 'x')).toBeNull();
  });
  test('pickField: saved name, else the fallback (first by default, null when given)', () => {
    const a = { name: 'a' } as never; const b = { name: 'b' } as never;
    expect(pickField([a, b], 'b')).toBe(b);
    expect(pickField([a, b], 'gone')).toBe(a);
    expect(pickField([a, b], 'gone', null)).toBeNull();
    expect(pickField([], undefined)).toBeNull();
  });
  test('pickBucketChoice keeps AUTO and real buckets only', () => {
    expect(pickBucketChoice('WEEK')).toBe('WEEK');
    expect(pickBucketChoice('HOUR')).toBe('AUTO');
    expect(pickBucketChoice(undefined)).toBe('AUTO');
  });
  test('scorecardsOf reads hidden and sparklines with their defaults', () => {
    expect(scorecardsOf({})).toEqual({ hidden: new Set(), sparklines: true });
    expect(scorecardsOf({ scorecards: { hidden: ['x'], sparklines: false } })).toEqual({ hidden: new Set(['x']), sparklines: false });
  });
  test('ids are unique and kinds are checked', () => {
    expect(newChartId()).not.toBe(newChartId());
    expect(isChartKind('heatmap')).toBe(true);
    expect(isChartKind('donut')).toBe(false);
  });
});
