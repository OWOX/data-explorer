import { toTraverseFilter } from '../filters/build';
import { equalsFilter, incomingLinks, joinFilters, primaryKeys, recordTabId } from './relationships';
import type { Edge, Field } from '../model/types';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  { id: 'e3', source: 'orders', target: 'fx', joins: [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] },
];
test('incomingLinks lists every edge that points at the mart', () => {
  const es: Edge[] = [...edges, { id: 'e4', source: 'returns', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] }, { id: 'e5', source: 'orders', target: 'orders', joins: [] }];
  expect(incomingLinks('orders', es)).toEqual([
    { edgeId: 'e2', sourceMartId: 'items', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
    { edgeId: 'e4', sourceMartId: 'returns', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  ]);
  expect(incomingLinks('items', edges)).toEqual([]);
});

test('recordTabId is stable across key order', () => {
  expect(recordTabId('m', { b: 2, a: 1 })).toBe(recordTabId('m', { a: 1, b: 2 }));
});

const f = (name: string, type: string, category: Field['category']): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });

test('joinFilters maps a record onto the referencing mart, or is null on a blank value', () => {
  const joins = [{ sourceField: 'order_id', targetField: 'id' }];
  expect(joinFilters(joins.map((j) => ({ sourceField: j.targetField, targetField: j.sourceField })), { id: 5 }, [f('order_id', 'INT64', 'number')])).toEqual([{ field: 'order_id', op: 'eq', value: 5 }]);
  expect(joinFilters([{ sourceField: 'id', targetField: 'order_id' }], { id: null }, [])).toBeNull();
});

test('primaryKeys returns key fields in schema order', () => {
  expect(primaryKeys([{ ...f('a', 'INT64', 'number'), isPrimaryKey: true }, f('b', 'STRING', 'string'), { ...f('c', 'INT64', 'number'), isPrimaryKey: true }])).toEqual(['a', 'c']);
  expect(primaryKeys([f('b', 'STRING', 'string')])).toEqual([]);
});

test('joinFilters picks the operator the join field supports', () => {
  const on = (type: string, category: Field['category'], value: unknown) => joinFilters([{ sourceField: 'v', targetField: 't' }], { v: value }, [f('t', type, category)]);
  expect(on('DATE', 'date', '2026-11-01')).toEqual([{ field: 't', op: 'on', value: '2026-11-01' }]);
  expect(on('TIMESTAMP', 'date', '2026-11-01T10:00:00Z')).toEqual([{ field: 't', op: 'between', value: { from: '2026-11-01T10:00:00Z', to: '2026-11-01T10:00:00Z' } }]);
  expect(on('BOOL', 'boolean', true)).toEqual([{ field: 't', op: 'is_true' }]);
  expect(on('BOOL', 'boolean', 'false')).toEqual([{ field: 't', op: 'is_false' }]);
});

test('composite joins filter on every join field', () => {
  const joins = [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }];
  expect(joinFilters(joins, { currency: 'EUR', day: 'x' }, [])).toEqual([{ field: 'code', op: 'eq', value: 'EUR' }, { field: 'day', op: 'eq', value: 'x' }]);
});

test('a join filter on a value with a comma stays one exact eq', () => {
  const f = { name: 'city', category: 'string', type: 'STRING' } as Field;
  expect(toTraverseFilter(equalsFilter(f, 'city', 'Austin, TX'), f)).toEqual({ column: 'city', operator: 'eq', value: 'Austin, TX' });
});
