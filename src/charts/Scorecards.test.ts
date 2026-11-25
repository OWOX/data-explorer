import { AUTO } from '../format/formats';
import type { Field } from '../model/types';
import { cardDate, datedRows, isIntegerMeasure, measureText, metricText } from './Scorecards';

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

test('a card draws its trend on its own date when the mart shows it, else on the mart default', () => {
  const d1 = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as Field;
  const d2 = { name: 'paid_at', category: 'date', type: 'TIMESTAMP' } as Field;
  const mart = { aliasPath: '', recordsId: 'records:m', title: '', hasPk: false, metrics: [], dates: [d1, d2], dimensions: [] };
  const spark = { hidden: new Set<string>(), sparklines: true, metrics: {}, dates: { amount: 'paid_at', gone: 'nope' }, date: d1 };
  expect(cardDate(mart, spark, 'amount')).toBe(d2);
  expect(cardDate(mart, spark, 'gone')).toBe(d1);
  expect(cardDate(mart, spark, 'other')).toBe(d1);
});

test('whole: a measure text above 10 has no fraction, a records count and a float sum with noise are right', () => {
  const m = { kind: 'metric', metric: { field: amount, fn: 'SUM' } } as Parameters<typeof measureText>[0];
  expect(measureText(m, 9298.69, () => AUTO)).toBe('9,298.69');
  expect(measureText(m, 9298.69, () => AUTO, { whole: true })).toBe('9,299');
  expect(measureText(m, 116739.09999999996, () => AUTO, { whole: true })).toBe('116,739');
  expect(measureText(m, 9.99, () => AUTO, { whole: true })).toBe('9.99');
  expect(metricText(amount, 'SUM', 12.5, () => ({ kind: 'money', currency: 'USD' }), { whole: true })).toMatch(/^(US)?\$13$/);
  expect(measureText({ kind: 'records', aliasPath: '', recordsId: 'r' }, 1234, () => AUTO, { whole: true })).toBe('1,234');
});
