import { havingField, sliceField } from './slice';
import type { Field } from '../model/types';

const base: Field = { name: 'customers__is_vip', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers', sourceType: 'BOOL' } };

test('sliceField types the field by its raw pre-join type', () => {
  expect(sliceField(base)).toMatchObject({ type: 'BOOL', category: 'boolean' });
  expect(sliceField({ ...base, joined: { ...base.joined!, sourceType: undefined } })).toMatchObject({ type: 'STRING', category: 'string' });
});

test('havingField is numeric for counts, sums, averages and percentiles only', () => {
  expect(havingField(base, 'SUM').category).toBe('number');
  expect(havingField(base, 'COUNT_DISTINCT').category).toBe('number');
  expect(havingField(base, 'P95').category).toBe('number');
  expect(havingField(base, 'MAX')).toBe(base);
});

test('havingField is a string for STRING_AGG, whatever the column type', () => {
  const date: Field = { ...base, name: 'created_at', type: 'DATE', category: 'date', joined: undefined };
  expect(havingField(date, 'STRING_AGG')).toMatchObject({ type: 'STRING', category: 'string' });
  expect(havingField(date, 'MAX')).toBe(date);
});
