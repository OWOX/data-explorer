import { clickTarget, incomingLinks, joinFilters, recordTabId, relationshipColumns } from './relationships';
import type { Edge, Field } from '../model/types';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  { id: 'e3', source: 'orders', target: 'fx', joins: [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] },
];
const pk = (name: string): Field => ({ name, alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true });

test('only outgoing edges make relationship columns, on their source fields', () => {
  const cols = relationshipColumns('orders', edges);
  expect(cols.get('customer_id')).toMatchObject({ relatedMartId: 'customers', relatedField: 'id', composite: false });
  expect(cols.get('currency')).toMatchObject({ composite: true });
  expect([...cols.keys()].sort()).toEqual(['currency', 'customer_id', 'day']);
  expect(cols.has('id')).toBe(false); // e2 points at orders: it is not a grid link
});

test('incomingLinks lists every edge that points at the mart', () => {
  const es: Edge[] = [...edges, { id: 'e4', source: 'returns', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] }, { id: 'e5', source: 'orders', target: 'orders', joins: [] }];
  expect(incomingLinks('orders', es)).toEqual([
    { edgeId: 'e2', sourceMartId: 'items', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
    { edgeId: 'e4', sourceMartId: 'returns', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  ]);
  expect(incomingLinks('items', edges)).toEqual([]);
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

const f = (name: string, type: string, category: Field['category']): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });

test('a TIMESTAMP join field has no eq, so it filters with between from = to', () => {
  const rel = relationshipColumns('orders', [{ id: 'e', source: 'orders', target: 'logs', joins: [{ sourceField: 'at', targetField: 'ts' }] }]).get('at')!;
  expect(clickTarget(rel, { at: '2026-11-01T10:00:00Z' }, [f('ts', 'TIMESTAMP', 'date')])).toEqual({
    kind: 'mart', martId: 'logs', filters: [{ field: 'ts', op: 'between', value: { from: '2026-11-01T10:00:00Z', to: '2026-11-01T10:00:00Z' } }],
  });
});

test('a boolean join field filters with is_true or is_false', () => {
  const rel = relationshipColumns('orders', [{ id: 'e', source: 'orders', target: 'flags', joins: [{ sourceField: 'paid', targetField: 'on' }] }]).get('paid')!;
  const schema = [f('on', 'BOOL', 'boolean')];
  expect(clickTarget(rel, { paid: true }, schema)).toMatchObject({ filters: [{ field: 'on', op: 'is_true' }] });
  expect(clickTarget(rel, { paid: false }, schema)).toMatchObject({ filters: [{ field: 'on', op: 'is_false' }] });
  expect(clickTarget(rel, { paid: 'false' }, schema)).toMatchObject({ filters: [{ field: 'on', op: 'is_false' }] });
});

test('nothing is clickable until the related schema has loaded', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: 7 }, undefined)).toBeNull();
});

test('joinFilters maps a record onto the referencing mart, or is null on a blank value', () => {
  const joins = [{ sourceField: 'order_id', targetField: 'id' }];
  expect(joinFilters(joins.map((j) => ({ sourceField: j.targetField, targetField: j.sourceField })), { id: 5 }, [f('order_id', 'INT64', 'number')])).toEqual([{ field: 'order_id', op: 'eq', value: 5 }]);
  expect(joinFilters([{ sourceField: 'id', targetField: 'order_id' }], { id: null }, [])).toBeNull();
});
