import { describe, expect, it } from 'vitest';
import { recordsCardId, resolveCharts } from './settings';
import type { ChartFields } from './fields';
import type { Field } from '../model/types';

const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: false });
const cf: ChartFields = {
  marts: [],
  metrics: [{ field: f('amount', 'number'), fn: 'SUM', martId: 'M' }, { field: f('qty', 'number'), fn: 'SUM', martId: 'M' }],
  dimensions: [f('channel', 'string'), f('city', 'string')],
  dates: [f('d1', 'date'), f('d2', 'date')],
};

describe('resolveCharts', () => {
  it('defaults', () => {
    const r = resolveCharts({}, cf);
    expect(r.date?.name).toBe('d1');
    expect(r.bucket).toBe('AUTO');
    expect(r.metric?.field.name).toBe('amount');
    expect(r.stack).toBeNull();
    expect(r.orientation).toBe('vertical');
    expect(r.sparklines).toBe(true);
    expect(r.hidden.size).toBe(0);
    expect(r.pieMetric?.field.name).toBe('amount');
    expect(r.pieDimension?.name).toBe('channel');
  });
  it('uses saved names that are shown', () => {
    const r = resolveCharts({
      scorecards: { hidden: ['x'], sparklines: false },
      timeSeries: { date: 'd2', bucket: 'WEEK', metric: 'qty', stack: 'city', orientation: 'horizontal' },
      pie: { metric: 'qty', dimension: 'city' },
    }, cf);
    expect([r.date?.name, r.bucket, r.metric?.field.name, r.stack?.name, r.orientation]).toEqual(['d2', 'WEEK', 'qty', 'city', 'horizontal']);
    expect([r.pieMetric?.field.name, r.pieDimension?.name, r.sparklines]).toEqual(['qty', 'city', false]);
    expect([...r.hidden]).toEqual(['x']);
  });
  it('falls back for names no longer shown', () => {
    const r = resolveCharts({ timeSeries: { date: 'gone', metric: 'gone', stack: 'gone' }, pie: { metric: 'gone', dimension: 'gone' } }, cf);
    expect([r.date?.name, r.metric?.field.name, r.stack, r.pieMetric?.field.name, r.pieDimension?.name]).toEqual(['d1', 'amount', null, 'amount', 'channel']);
  });
  it('rejects an invalid bucket or orientation', () => {
    const r = resolveCharts({ timeSeries: { bucket: 'HOUR' as never, orientation: 'x' as never } }, cf);
    expect([r.bucket, r.orientation]).toEqual(['AUTO', 'vertical']);
  });
  it('the pie takes only metrics that may be summed: a saved one that may not falls back to the first that may', () => {
    const noSum = { ...f('price', 'number'), allowedAggregations: ['MIN', 'MAX'] as const } as unknown as Field;
    const only = resolveCharts({ pie: { metric: 'price' } }, { ...cf, metrics: [{ field: noSum, fn: 'MIN', martId: 'M' }, ...cf.metrics] });
    expect([only.pieMetric?.field.name, only.metric?.field.name]).toEqual(['amount', 'price']);
    expect(resolveCharts({}, { ...cf, metrics: [{ field: noSum, fn: 'MIN', martId: 'M' }] }).pieMetric).toBeNull();
  });
  it('the pie always sums, whatever function the grid shows', () => {
    const r = resolveCharts({}, { ...cf, metrics: [{ field: f('amount', 'number'), fn: 'AVG', martId: 'M' }] });
    expect([r.pieMetric?.fn, r.metric?.fn]).toEqual(['SUM', 'AVG']);
  });
  it('is null everywhere with nothing shown', () => {
    const r = resolveCharts({}, { marts: [], metrics: [], dimensions: [], dates: [] });
    expect([r.date, r.metric, r.pieMetric, r.pieDimension]).toEqual([null, null, null, null]);
  });
});

describe('measure', () => {
  const pk = { ...cf, marts: [{ martId: 'M', aliasPath: '', hasPk: true, metrics: [], dates: [], dimensions: [] }] };
  it('is the saved metric, else records when saved and keyed, else the first metric', () => {
    expect(resolveCharts({ timeSeries: { metric: 'qty' } }, pk).measure).toMatchObject({ kind: 'metric', metric: { field: { name: 'qty' } } });
    expect(resolveCharts({ timeSeries: { metric: 'records' } }, pk).measure?.kind).toBe('records');
    expect(resolveCharts({ timeSeries: { metric: 'records' } }, cf).measure).toMatchObject({ kind: 'metric', metric: { field: { name: 'amount' } } });
    expect(resolveCharts({}, pk).measure).toMatchObject({ kind: 'metric' });
  });
  it('is records with a key and no metric, null without either', () => {
    expect(resolveCharts({}, { ...pk, metrics: [] }).measure?.kind).toBe('records');
    expect(resolveCharts({}, { marts: [], metrics: [], dimensions: [], dates: [] }).measure).toBeNull();
  });
});

it('recordsCardId', () => expect(recordsCardId('M')).toBe('records:M'));
