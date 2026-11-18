import { AUTO } from '../format/formats';
import type { Field } from '../model/types';
import { metricText } from './Scorecards';

const amount: Field = { name: 'amount', alias: null, type: 'FLOAT', category: 'number', description: null, isPrimaryKey: false };
const text = (v: unknown) => metricText(amount, 'SUM', v, () => AUTO);

test('float noise from a sum is dropped at 15 significant digits', () => {
  expect(text(116739.09999999996)).toBe('116,739.1');
  expect(text(0.1 + 0.2)).toBe('0.3');
});

test('a string from the warehouse is exact and left as formatValue gives it', () => {
  expect(text('116739.09999999996')).toBe(metricText(amount, 'SUM', '116739.09999999996', () => AUTO));
  expect(text('116739.09999999996')).toContain('09999999996');
});

test('an integer is unchanged', () => {
  expect(text(1234567)).toBe('1,234,567');
});
