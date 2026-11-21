import { defaultColumns } from './columns';
import type { Field, Schema } from './types';

const f = (name: string, category: Field['category'] = 'string', extra: Partial<Field> = {}): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: false, ...extra });

test('default columns leave out the primary key while another text field exists', () => {
  const schema: Schema = [f('id', 'number', { isPrimaryKey: true }), f('name'), f('amount', 'number')];
  expect(defaultColumns(schema)).toEqual(['name', 'amount']);
});

test('a primary key that is text counts as a key, not as the other text field', () => {
  const schema: Schema = [f('id', 'string', { isPrimaryKey: true }), f('amount', 'number'), f('day', 'date')];
  expect(defaultColumns(schema)).toEqual(['id', 'amount', 'day']);
});

test('with no other text field the choice is unchanged, calculated fields are still skipped, and five columns are taken', () => {
  expect(defaultColumns([f('id', 'number', { isPrimaryKey: true }), f('amount', 'number')])).toEqual(['id', 'amount']);
  const many: Schema = [f('id', 'number', { isPrimaryKey: true }), f('calc', 'number', { isCalculated: true }), ...['a', 'b', 'c', 'd', 'e', 'g'].map((n) => f(n))];
  expect(defaultColumns(many)).toEqual(['a', 'b', 'c', 'd', 'e']);
});
