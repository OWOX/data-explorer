import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { groupMap, moveColumn, moveColumnBy, orderColumns } from './column-order';

const f = (name: string, martId: string): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId, label: martId, aliasPath: martId } });
const src = (aliasPath: string, martId: string, names: string[]): JoinedSource => ({ aliasPath, martId, label: martId, depth: 1, fields: names.map((n) => f(n, martId)), uniqueCount: false, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' });
const sources = [src('customers', 'customers', ['customers__id', 'customers__city']), src('products', 'products', ['products__sku', 'products__price']), src('a.customers', 'customers', ['a__customers__id'])];

test('the main mart\'s own columns lead, then each joined mart in the order it first appears, each keeping its fields\' order', () => {
  expect(orderColumns(['id', 'products__sku', 'total', 'customers__city', 'products__price', 'customers__id'], sources))
    .toEqual(['id', 'total', 'products__sku', 'products__price', 'customers__city', 'customers__id']);
});

test('a mart reached by two alias paths is one group per path, in the order the paths first appear', () => {
  expect(orderColumns(['a__customers__id', 'products__sku', 'customers__id', 'a__customers__id2'], [...sources.slice(0, 2), src('a.customers', 'customers', ['a__customers__id', 'a__customers__id2'])])).toEqual(['a__customers__id', 'a__customers__id2', 'products__sku', 'customers__id']);
});

test('a list that is already grouped, or has no joined column, comes back unchanged', () => {
  expect(orderColumns(['id', 'total'], sources)).toEqual(['id', 'total']);
  expect(orderColumns(['id', 'customers__id', 'products__sku'], sources)).toEqual(['id', 'customers__id', 'products__sku']);
  expect(orderColumns([], sources)).toEqual([]);
});

test('joined columns with no own column stay as they are: the main mart may show no column', () => {
  expect(orderColumns(['customers__city', 'products__sku'], sources)).toEqual(['customers__city', 'products__sku']);
});

test('a fallback (a mart becoming main) leads joined columns that have no own column', () => {
  expect(orderColumns(['customers__city', 'products__sku'], sources, ['id', 'status'])).toEqual(['id', 'status', 'customers__city', 'products__sku']);
  expect(orderColumns(['id', 'customers__city'], sources, ['x'])).toEqual(['id', 'customers__city']);
});

test('with no sources every column is the main mart\'s own', () => {
  expect(orderColumns(['b', 'a', 'customers__id'], [])).toEqual(['b', 'a', 'customers__id']);
});

test('a new field of an earlier mart joins that mart\'s group, a new mart goes last', () => {
  expect(orderColumns(['id', 'customers__id', 'products__sku', 'customers__city'], sources)).toEqual(['id', 'customers__id', 'customers__city', 'products__sku']);
});

describe('moveColumn', () => {
  const list = ['id', 'total', 'status', 'customers__id', 'customers__city', 'products__sku', 'products__price'];

  test('moves a column before another one of its own group', () => {
    expect(moveColumn(list, 'status', 'id', sources)).toEqual(['status', 'id', 'total', 'customers__id', 'customers__city', 'products__sku', 'products__price']);
    expect(moveColumn(list, 'id', 'status', sources)).toEqual(['total', 'id', 'status', 'customers__id', 'customers__city', 'products__sku', 'products__price']);
  });

  test('null puts the column last in its own group, not at the end of the list', () => {
    expect(moveColumn(list, 'id', null, sources)).toEqual(['total', 'status', 'id', 'customers__id', 'customers__city', 'products__sku', 'products__price']);
    expect(moveColumn(list, 'customers__id', null, sources)).toEqual(['id', 'total', 'status', 'customers__city', 'customers__id', 'products__sku', 'products__price']);
  });

  test('works inside a joined group', () => {
    expect(moveColumn(list, 'products__price', 'products__sku', sources)).toEqual(['id', 'total', 'status', 'customers__id', 'customers__city', 'products__price', 'products__sku']);
  });

  test('a move into another data mart\'s group is refused with the same array', () => {
    expect(moveColumn(list, 'id', 'customers__city', sources)).toBe(list);
    expect(moveColumn(list, 'customers__id', 'status', sources)).toBe(list);
    expect(moveColumn(list, 'products__sku', 'customers__id', sources)).toBe(list);
  });

  test('a no-op or unknown name returns the same array', () => {
    expect(moveColumn(list, 'total', 'total', sources)).toBe(list);
    expect(moveColumn(list, 'total', 'status', sources)).toBe(list);
    expect(moveColumn(list, 'status', null, sources)).toBe(list);
    expect(moveColumn(list, 'nope', 'id', sources)).toBe(list);
    expect(moveColumn(list, 'id', 'nope', sources)).toBe(list);
  });

  test('a lone column of its group stays', () => {
    expect(moveColumn(['id', 'products__sku'], 'products__sku', null, sources)).toEqual(['id', 'products__sku']);
  });

  test('moveColumnBy steps within the group and stops at its edges', () => {
    expect(moveColumnBy(list, 'total', 1, sources)).toEqual(['id', 'status', 'total', 'customers__id', 'customers__city', 'products__sku', 'products__price']);
    expect(moveColumnBy(list, 'total', -1, sources)).toEqual(['total', 'id', 'status', 'customers__id', 'customers__city', 'products__sku', 'products__price']);
    expect(moveColumnBy(list, 'id', -1, sources)).toBe(list);
    expect(moveColumnBy(list, 'status', 1, sources)).toBe(list);
    expect(moveColumnBy(list, 'customers__id', -1, sources)).toBe(list);
    expect(moveColumnBy(list, 'products__sku', 1, sources)).toEqual(['id', 'total', 'status', 'customers__id', 'customers__city', 'products__price', 'products__sku']);
  });
});

test('groupMap: a mart joined to itself is its own group, apart from the main mart\'s columns', () => {
  const group = groupMap([src('self', 'orders', ['self__id', 'self__total'])]);
  expect(group('id')).toBe('');
  expect(group('self__id')).toBe('self');
  const list = ['id', 'total', 'self__id', 'self__total'];
  expect(moveColumn(list, 'id', 'self__id', [src('self', 'orders', ['self__id', 'self__total'])])).toBe(list);
});

test('moves stay inside one path of a mart that sits at two paths', () => {
  const two = [src('a.customers', 'customers', ['a__id', 'a__city']), src('b.customers', 'customers', ['b__id', 'b__city'])];
  const list = ['a__id', 'a__city', 'b__id', 'b__city'];
  expect(moveColumn(list, 'a__id', 'b__id', two)).toBe(list);
  expect(moveColumn(list, 'a__id', null, two)).toEqual(['a__city', 'a__id', 'b__id', 'b__city']);
  expect(moveColumnBy(list, 'a__city', 1, two)).toBe(list);
});
