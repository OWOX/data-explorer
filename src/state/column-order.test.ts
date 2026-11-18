import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { orderColumns } from './column-order';

const f = (name: string, martId: string): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId, label: martId, aliasPath: martId } });
const src = (aliasPath: string, martId: string, names: string[]): JoinedSource => ({ aliasPath, martId, label: martId, depth: 1, fields: names.map((n) => f(n, martId)), uniqueCount: false });
const sources = [src('customers', 'customers', ['customers__id', 'customers__city']), src('products', 'products', ['products__sku', 'products__price']), src('a.customers', 'customers', ['a__customers__id'])];

test('the main mart\'s own columns lead, then each joined mart in the order it first appears, each keeping its fields\' order', () => {
  expect(orderColumns(['id', 'products__sku', 'total', 'customers__city', 'products__price', 'customers__id'], sources))
    .toEqual(['id', 'total', 'products__sku', 'products__price', 'customers__city', 'customers__id']);
});

test('a mart reached by two alias paths is one group', () => {
  expect(orderColumns(['a__customers__id', 'products__sku', 'customers__id'], sources)).toEqual(['a__customers__id', 'customers__id', 'products__sku']);
});

test('a list that is already grouped, or has no joined column, comes back unchanged', () => {
  expect(orderColumns(['id', 'total'], sources)).toEqual(['id', 'total']);
  expect(orderColumns(['id', 'customers__id', 'products__sku'], sources)).toEqual(['id', 'customers__id', 'products__sku']);
  expect(orderColumns([], sources)).toEqual([]);
});

test('joined columns with no own column get the main mart\'s fallback columns first', () => {
  expect(orderColumns(['customers__city', 'products__sku'], sources, ['id', 'status'])).toEqual(['id', 'status', 'customers__city', 'products__sku']);
  expect(orderColumns(['id', 'customers__city'], sources, ['x'])).toEqual(['id', 'customers__city']);
  expect(orderColumns(['customers__city'], sources)).toEqual(['customers__city']);
});

test('with no sources every column is the main mart\'s own', () => {
  expect(orderColumns(['b', 'a', 'customers__id'], [])).toEqual(['b', 'a', 'customers__id']);
});

test('a new field of an earlier mart joins that mart\'s group, a new mart goes last', () => {
  expect(orderColumns(['id', 'customers__id', 'products__sku', 'customers__city'], sources)).toEqual(['id', 'customers__id', 'customers__city', 'products__sku']);
});
