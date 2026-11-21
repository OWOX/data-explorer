import type { ChartFields } from '../fields';
import { bar } from './bar';
import { KINDS } from './index';
import { pie } from './pie';
import { rankedBar } from './rankedBar';

const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: amount, fn: 'AVG' }], dates: [], dimensions: [dim] }], dates: [], dimensions: [dim], counter: null };

test('bar chart: eligible with a dimension and any measure, AVG included', () => {
  expect(bar.label).toBe('Bar chart');
  expect(bar.eligible(cf)).toBe(true);
  expect(bar.eligible({ ...cf, dimensions: [] })).toBe(false);
  const r = bar.resolve({ id: 'x', kind: 'bar', measure: 'amount' }, cf)!;
  expect(r.measure).toMatchObject({ kind: 'metric', metric: { fn: 'AVG' } });
  expect(r.dimension).toBe(dim);
  expect(bar.title(r, cf)).toBe('amount · Average by status');
});

test('bar chart sits right after Time series in the type order, with its own icon', () => {
  expect(Object.keys(KINDS).slice(0, 3)).toEqual(['timeSeries', 'bar', 'pie']);
  expect(new Set(Object.values(KINDS).map((k) => k.icon)).size).toBe(Object.keys(KINDS).length);
});

test('bar chart: switching between bar, ranked bar and pie keeps measure and dimension', () => {
  const spec = { id: 'b', kind: 'bar', measure: 'amount', dimension: 'status' } as const;
  expect(rankedBar.create(cf, spec)).toEqual({ kind: 'rankedBar', measure: 'amount', dimension: 'status' });
  expect(pie.create(cf, spec)).toEqual({ kind: 'pie', measure: 'amount', dimension: 'status' });
  expect(bar.create(cf, { id: 'r', kind: 'rankedBar', measure: 'amount', dimension: 'status', date: 'd' })).toEqual({ kind: 'bar', measure: 'amount', dimension: 'status' });
  expect(bar.create(cf, { id: 'p', kind: 'pie', measure: 'amount', dimension: 'status' })).toEqual({ kind: 'bar', measure: 'amount', dimension: 'status' });
});
