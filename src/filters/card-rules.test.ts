import { cardRules, mainOnly } from './card-rules';
import type { Field, Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';

const base: Field = { name: 'status', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false };
const orders = { martId: 'm-orders', label: 'Orders', aliasPath: 'orders' };
const schema: Schema = [
  base,
  { ...base, name: 'calc', isCalculated: true, calculatedLevel: 'column' },
  { ...base, name: 'orders__amount', type: 'NUMERIC', category: 'number', joined: { ...orders, originalName: 'amount' } },
  { ...base, name: 'orders__noname', joined: orders },
  { ...base, name: 'cust__city', joined: { martId: 'm-cust', label: 'Customers', aliasPath: 'orders.cust', originalName: 'city' } },
];

const status: TraverseFilter = { column: 'status', operator: 'eq', value: 'paid' };
const calc: TraverseFilter = { column: 'calc', operator: 'eq', value: 'x' };
const slice = (column: string, value: number | string = 5): TraverseFilter => ({ column, operator: 'gt', value, placement: 'pre-join' });

test('a main rule goes to the empty path', () => {
  expect(cardRules(schema, [status], 'main').get('')).toEqual({ martId: 'main', rules: [status], partial: false });
});

test('a slice goes to its joined card with the original column and no placement', () => {
  const rules = cardRules(schema, [slice('orders__amount')], 'main');
  expect(rules.get('orders')).toEqual({ martId: 'm-orders', rules: [{ column: 'amount', operator: 'gt', value: 5 }], partial: false });
  expect(rules.get('orders')!.rules[0]).not.toHaveProperty('placement');
  expect(rules.has('')).toBe(false);
});

test('a slice on a nested join goes to its alias path', () => {
  const rules = cardRules(schema, [slice('cust__city', 'Kyiv')], 'main');
  expect(rules.get('orders.cust')).toEqual({ martId: 'm-cust', rules: [{ column: 'city', operator: 'gt', value: 'Kyiv' }], partial: false });
});

test('a post-join rule on a joined field is a crossing', () => {
  const filters: TraverseFilter[] = [{ column: 'orders__amount', operator: 'gt', value: 5 }];
  expect(cardRules(schema, filters, 'main').size).toBe(0);
  expect(mainOnly(schema, filters)).toBe(false);
});

test('a rule on a calculated field leaves the main card partial', () => {
  expect(cardRules(schema, [calc], 'main').get('')).toEqual({ martId: 'main', rules: [], partial: true });
  expect(cardRules(schema, [calc, status], 'main').get('')).toEqual({ martId: 'main', rules: [status], partial: true });
  expect(mainOnly(schema, [calc])).toBe(false);
});

test('a HAVING rule is counted by no card', () => {
  const having: TraverseFilter = { column: 'status', operator: 'gt', value: 1, function: 'SUM' };
  expect(cardRules(schema, [having], 'main').size).toBe(0);
  expect(mainOnly(schema, [having])).toBe(true);
});

test('a slice without an original name leaves its card partial', () => {
  expect(cardRules(schema, [slice('orders__noname')], 'main').get('orders')).toEqual({ martId: 'm-orders', rules: [], partial: true });
  expect(mainOnly(schema, [slice('orders__noname')])).toBe(true);
});

test('no filters give an empty map and a main-only grid', () => {
  expect(cardRules(schema, [], 'main').size).toBe(0);
  expect(mainOnly(schema, [])).toBe(true);
});

test('a rule on an unknown field is skipped and is not main-only', () => {
  const filters: TraverseFilter[] = [{ column: 'ghost', operator: 'eq', value: 1 }];
  expect(cardRules(schema, filters, 'main').size).toBe(0);
  expect(mainOnly(schema, filters)).toBe(false);
});

test('rules keep the order of the filters inside a path', () => {
  const second: TraverseFilter = { column: 'status', operator: 'neq', value: 'void' };
  expect(cardRules(schema, [status, second], 'main').get('')!.rules).toEqual([status, second]);
  expect(cardRules(schema, [slice('orders__amount', 1), slice('orders__amount', 2)], 'main').get('orders')!.rules.map((r) => 'value' in r && r.value)).toEqual([1, 2]);
});

test('main-only holds with slices and main rules', () => {
  expect(mainOnly(schema, [status, slice('orders__amount')])).toBe(true);
});
