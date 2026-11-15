import { buildRowQuery, defaultColumns } from './useMartRows';
import type { Schema } from '../../model/types';

const f = (name: string, isPrimaryKey = false, type = 'STRING'): Schema[number] => ({ name, alias: null, type, category: type === 'STRING' ? 'string' : 'number', description: null, isPrimaryKey });
const schema: Schema = [f('id', true, 'INT64'), f('a'), f('b'), f('c'), f('customer_id', false, 'INT64'), f('e'), f('g')];
const rels = new Map([['customer_id', { field: 'customer_id', edgeId: 'e', relatedMartId: 'customers', relatedField: 'id', composite: false, joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]]);

test('defaultColumns is the first 5 fields', () => {
  expect(defaultColumns(schema)).toEqual(['id', 'a', 'b', 'c', 'customer_id']);
});

test('buildRowQuery adds primary and relationship keys, keeps schema order, applies complete filters only', () => {
  const q = buildRowQuery(schema, ['b', 'a'], [
    { field: 'a', op: 'contains', value: 'x' },
    { field: 'b', op: 'contains', value: '' },
  ], 200, rels);
  expect(q).toEqual({
    column: ['id', 'a', 'b', 'customer_id'],
    filter: [{ column: 'a', operator: 'contains', value: 'x' }],
    sort: [{ column: 'id', direction: 'asc' }],
    limit: 201,
  });
});

test('no primary key → no sort, and composite join fields are fetched too', () => {
  const noPk: Schema = [f('x'), f('cur'), f('day')];
  const comp = new Map([['cur', { field: 'cur', edgeId: 'e', relatedMartId: 'fx', relatedField: 'code', composite: true, joins: [{ sourceField: 'cur', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] }]]);
  expect(buildRowQuery(noPk, ['x', 'cur'], [], 200, comp)).toEqual({ column: ['x', 'cur', 'day'], limit: 201 });
});
