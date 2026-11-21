import type { ChartFields } from '../fields';
import { line } from './line';

const date = { name: 'day', category: 'date', type: 'DATE' } as never;
const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const a = { name: 'a', category: 'number', type: 'NUMERIC' } as never;
const b = { name: 'b', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: a, fn: 'SUM' }, { field: b, fn: 'SUM' }], dates: [date], dimensions: [dim] }], dates: [date], dimensions: [dim], counter: null };

test('line: no second measure by default; a second measure turns the stack off', () => {
  expect(line.resolve({ id: 'l', kind: 'line', stack: 'status' }, cf)).toMatchObject({ measure2: null, stack: dim, area: false });
  const two = line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'b', stack: 'status', area: true }, cf)!;
  expect(two.measure2).toMatchObject({ metric: { field: b } });
  expect(two.stack).toBeNull();
  expect(two.area).toBe(true);
});

test('line: a saved second measure equal to the first, or not shown, is off', () => {
  expect(line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'a' }, cf)!.measure2).toBeNull();
  expect(line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'gone' }, cf)!.measure2).toBeNull();
});
