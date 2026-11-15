import { pickTitleField } from './title-field';
import { primaryKeys } from './relationships';
import type { Field, Schema } from '../model/types';

const f = (name: string, type = 'STRING', extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category: type === 'STRING' ? 'string' : 'number', description: null, isPrimaryKey: false, ...extra });

test.each<[string, Schema, string | null]>([
  ['exact name', [f('id', 'INT64', { isPrimaryKey: true }), f('code'), f('name')], 'name'],
  ['exact alias', [f('id', 'INT64', { isPrimaryKey: true }), f('label', 'STRING', { alias: 'Name' })], 'label'],
  ['exact beats contains', [f('product_title'), f('title')], 'title'],
  ['contains', [f('id', 'INT64', { isPrimaryKey: true }), f('full_name')], 'full_name'],
  ['first non-key string', [f('code', 'STRING', { isPrimaryKey: true }), f('status')], 'status'],
  ['no title', [f('id', 'INT64', { isPrimaryKey: true }), f('amount', 'NUMERIC')], null],
  ['a key named name is still allowed by name', [f('name', 'STRING', { isPrimaryKey: true })], 'name'],
])('%s', (_, schema, expected) => {
  expect(pickTitleField(schema)).toBe(expected);
});

test('primaryKeys returns key fields in schema order', () => {
  expect(primaryKeys([f('a', 'INT64', { isPrimaryKey: true }), f('b'), f('c', 'INT64', { isPrimaryKey: true })])).toEqual(['a', 'c']);
  expect(primaryKeys([f('b')])).toEqual([]);
});
