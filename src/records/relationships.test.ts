import { clickTarget, recordTabId, relationshipColumns } from './relationships';
import type { Edge, Field } from '../model/types';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  { id: 'e3', source: 'orders', target: 'fx', joins: [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] },
];
const pk = (name: string): Field => ({ name, alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true });

test('outgoing edges make relationship columns on their source fields', () => {
  const cols = relationshipColumns('orders', edges);
  expect(cols.get('customer_id')).toMatchObject({ relatedMartId: 'customers', relatedField: 'id', composite: false, direction: 'outgoing' });
  expect(cols.get('currency')).toMatchObject({ composite: true, direction: 'outgoing' });
  expect([...cols.values()].filter((c) => c.direction === 'outgoing').map((c) => c.field).sort()).toEqual(['currency', 'customer_id', 'day']);
});

test('incoming edges make columns on the target fields; outgoing wins a clash; first incoming wins', () => {
  const es: Edge[] = [
    ...edges,
    { id: 'e4', source: 'returns', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
    { id: 'e5', source: 'x', target: 'orders', joins: [{ sourceField: 'cid', targetField: 'customer_id' }] },
  ];
  const cols = relationshipColumns('orders', es);
  expect(cols.get('id')).toMatchObject({ direction: 'incoming', edgeId: 'e2', relatedMartId: 'items', relatedField: 'order_id', joins: [{ sourceField: 'id', targetField: 'order_id' }] });
  expect(cols.get('customer_id')).toMatchObject({ direction: 'outgoing', relatedMartId: 'customers' });
});

test('an incoming cell always opens the related mart filtered on the join fields', () => {
  const rel = relationshipColumns('orders', edges).get('id')!;
  expect(clickTarget(rel, { id: 5 }, [pk('order_id')])).toEqual({ kind: 'mart', martId: 'items', filters: [{ field: 'order_id', op: 'eq', value: 5 }] });
  expect(clickTarget(rel, { id: null }, [])).toBeNull();
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
