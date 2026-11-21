import type { ChartFields } from '../fields';
import { rankedBar } from './rankedBar';

const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: amount, fn: 'AVG' }], dates: [], dimensions: [dim] }], dates: [], dimensions: [dim], counter: null };

test('ranked bar: eligible with a dimension and any measure, AVG included', () => {
  expect(rankedBar.eligible(cf)).toBe(true);
  const r = rankedBar.resolve({ id: 'x', kind: 'rankedBar', measure: 'amount' }, cf)!;
  expect(r.measure).toMatchObject({ kind: 'metric', metric: { fn: 'AVG' } });
  expect(r.dimension).toBe(dim);
  expect(rankedBar.title(r, cf)).toBe('amount · Average by status');
});

test('ranked bar: a switch keeps measure and dimension', () => {
  expect(rankedBar.create(cf, { id: 'p', kind: 'pie', measure: 'amount', dimension: 'status', date: 'd' })).toEqual({ kind: 'rankedBar', measure: 'amount', dimension: 'status' });
});
