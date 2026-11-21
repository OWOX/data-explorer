import { AUTO } from '../format/formats';
import type { Field } from '../model/types';
import { datedRows, isIntegerMeasure, metricText } from './Scorecards';

const amount: Field = { name: 'amount', alias: null, type: 'FLOAT', category: 'number', description: null, isPrimaryKey: false };
const text = (v: unknown) => metricText(amount, 'SUM', v, () => AUTO);

test('float noise from a sum is dropped at 15 significant digits', () => {
  expect(text(116739.09999999996)).toBe('116,739.1');
  expect(text(0.1 + 0.2)).toBe('0.3');
});

test('a string from the warehouse is exact and left as formatValue gives it', () => {
  expect(text('116739.09999999996')).toBe('116,739.09999999996');
});

test('an integer is unchanged', () => {
  expect(text(1234567)).toBe('1,234,567');
});

test('from 1e15 a float keeps its real digits', () => {
  expect(text(1234567890123456.5)).toBe('1,234,567,890,123,456.5');
});

test('records and integer fields count whole things; floats and averages do not', () => {
  const int = { ...amount, type: 'INT64' };
  expect(isIntegerMeasure({ kind: 'records', aliasPath: '', recordsId: 'records:m' })).toBe(true);
  expect(isIntegerMeasure({ kind: 'metric', metric: { field: int, fn: 'SUM' } })).toBe(true);
  expect(isIntegerMeasure({ kind: 'metric', metric: { field: int, fn: 'COUNT' } })).toBe(true);
  expect(isIntegerMeasure({ kind: 'metric', metric: { field: int, fn: 'AVG' } })).toBe(false);
  expect(isIntegerMeasure({ kind: 'metric', metric: { field: amount, fn: 'SUM' } })).toBe(false);
});

test('datedRows drops a blank date from the sparkline points', () => {
  expect(datedRows([{ d: '2026-01-01', n: 1 }, { d: null, n: 2 }, { n: 3 }, { d: '', n: 4 }, { d: '2026-01-02', n: 5 }], 'd').map((r) => r.n)).toEqual([1, 5]);
});
