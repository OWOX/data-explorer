import { clickTarget, recordTabId, relationshipColumns } from './relationships';
import type { Edge, Field } from '../model/types';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  { id: 'e3', source: 'orders', target: 'fx', joins: [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] },
];
const pk = (name: string): Field => ({ name, alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true });

test('only outgoing edges make relationship columns', () => {
  const cols = relationshipColumns('orders', edges);
  expect([...cols.keys()].sort()).toEqual(['currency', 'customer_id', 'day']);
  expect(cols.get('customer_id')).toMatchObject({ relatedMartId: 'customers', relatedField: 'id', composite: false });
  expect(cols.get('currency')!.composite).toBe(true);
});

test('click opens a record when the related field is the only primary key', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: 7 }, [pk('id')])).toEqual({ kind: 'record', martId: 'customers', pk: { id: 7 } });
});

test('click opens a filtered mart tab otherwise', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: 7 }, [pk('other')])).toEqual({ kind: 'mart', martId: 'customers', filters: [{ field: 'id', op: 'eq', value: 7 }] });
});

test('composite relationships filter on every join', () => {
  const rel = relationshipColumns('orders', edges).get('currency')!;
  expect(clickTarget(rel, { currency: 'EUR', day: '2026-11-01' }, [])).toEqual({
    kind: 'mart', martId: 'fx',
    filters: [{ field: 'code', op: 'eq', value: 'EUR' }, { field: 'day', op: 'eq', value: '2026-11-01' }],
  });
});

test('a DATE join field in the related schema filters with "on"', () => {
  const rel = relationshipColumns('orders', edges).get('currency')!;
  const fxSchema: Field[] = [{ name: 'day', alias: null, type: 'DATE', category: 'date', description: null, isPrimaryKey: false }];
  expect(clickTarget(rel, { currency: 'EUR', day: '2026-11-01' }, fxSchema)).toMatchObject({
    filters: [{ field: 'code', op: 'eq', value: 'EUR' }, { field: 'day', op: 'on', value: '2026-11-01' }],
  });
});

test('a null or blank value is not clickable', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: null }, [pk('id')])).toBeNull();
  expect(clickTarget(rel, { customer_id: ' ' }, [pk('id')])).toBeNull();
});

test('recordTabId is stable across key order', () => {
  expect(recordTabId('m', { b: 2, a: 1 })).toBe(recordTabId('m', { a: 1, b: 2 }));
});
