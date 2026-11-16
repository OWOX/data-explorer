import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { defaultJoinFields, fieldsFor, isIdField, joinedMartIds, planClick, withoutMart, type PlanEnv } from './join-plan';
import type { GridState } from './store';

const f = (name: string, category: Field['category'], martId: string): Field => ({ name, alias: null, type: 'STRING', category, description: null, isPrimaryKey: false, joined: { martId, label: martId, aliasPath: martId } });
const src = (aliasPath: string, martId: string, fields: Field[], depth = 1): JoinedSource => ({ aliasPath, martId, label: martId, depth, fields });
const ordersSources = [
  src('customers', 'customers', [f('customers__id', 'number', 'customers'), f('customers__city', 'string', 'customers'), f('customers__email', 'string', 'customers')]),
  src('products', 'products', [f('products__sku', 'string', 'products'), f('products__price', 'number', 'products')]),
  src('stores', 'stores', [f('stores__city', 'string', 'stores')]),
];
const customersSources = [src('countries', 'countries', [f('countries__name', 'string', 'countries')]), src('stores', 'stores', [f('stores__city', 'string', 'stores')])];
const g = (columns: string[], extra: Partial<GridState> = {}): GridState => ({ columns, filters: {}, sorts: null, limit: 200, ...extra });
const sel = (martId: string | null) => ({ sourceKey: null, martId, record: null });

function env(grids: Record<string, GridState>, main: string | null, picks: Record<string, Record<string, string[]>> = {}): PlanEnv {
  const sources: Record<string, JoinedSource[]> = { orders: ordersSources, customers: customersSources, products: [], stores: [] };
  return {
    selection: sel(main), sourceKeyFor: () => null, sourcesOf: (id) => sources[id] ?? [], gridOf: (id) => grids[id] ?? g(['id']), ownColumns: () => ['id'], picksOf: (id) => picks[id] ?? {},
  };
}

test('the joined marts are those with a field among the columns, in the order they first appear', () => {
  expect(joinedMartIds(['id', 'stores__city', 'customers__city', 'stores__x'], ordersSources)).toEqual(['stores', 'customers']);
  expect(joinedMartIds(['id'], ordersSources)).toEqual([]);
});

test('a mart comes back with its remembered fields, else its default fields', () => {
  expect(fieldsFor(ordersSources, 'customers', ['customers__email'])).toEqual(['customers__email']);
  expect(fieldsFor(ordersSources, 'customers', undefined)).toEqual(['customers__city']);
  expect(fieldsFor(ordersSources, 'customers', [])).toEqual(['customers__city']);
  expect(fieldsFor(ordersSources, 'customers', ['gone'])).toEqual(['customers__city']);
  expect(fieldsFor([src('n', 'n', [f('n__a', 'number', 'n'), f('n__b', 'number', 'n')])], 'n', undefined)).toEqual(['n__a', 'n__b']);
});

test('with two paths to one mart the shallowest source decides the first text field', () => {
  const deep = src('a.stores', 'stores', [f('a__stores__z', 'string', 'stores')], 2);
  expect(fieldsFor([...ordersSources, deep], 'stores', undefined)).toEqual(['stores__city']);
});

test('clicking a joinable mart adds its first text field after the visible columns', () => {
  const plan = planClick(env({ orders: g(['id', 'status']) }, 'orders'), 'customers');
  expect(plan.selection).toEqual(sel('orders'));
  expect(plan.grids.orders!.columns).toEqual(['id', 'status', 'customers__city']);
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id', 'status', 'customers__city'] }]);
});

test('an add brings back what was last chosen for the pair', () => {
  const plan = planClick(env({ orders: g(['id']) }, 'orders', { orders: { customers: ['customers__email', 'customers__city'] } }), 'customers');
  expect(plan.grids.orders!.columns).toEqual(['id', 'customers__email', 'customers__city']);
});

test('clicking a selected joined mart removes its columns, filters and sorts and remembers its fields', () => {
  const grid = g(['id', 'customers__city', 'products__sku'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' }, id: { field: 'id', op: 'eq', value: 1 } }, sorts: [{ field: 'customers__city', direction: 'asc' }] });
  const plan = planClick(env({ orders: grid }, 'orders'), 'customers');
  expect(plan.grids.orders).toEqual(g(['id', 'products__sku'], { filters: { id: { field: 'id', op: 'eq', value: 1 } }, sorts: null }));
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id', 'products__sku'], picks: { customers: ['customers__city'] } }]);
});

test('removing the only columns on screen brings the mart\'s own defaults back', () => {
  const { grid } = withoutMart(g(['customers__city']), ordersSources, 'customers', ['id', 'status']);
  expect(grid.columns).toEqual(['id', 'status']);
});

test('clicking a mart the main cannot join makes it the only selected mart', () => {
  const plan = planClick(env({ orders: g(['id', 'customers__city']) }, 'orders'), 'products2');
  expect(plan.selection).toEqual(sel('products2'));
  expect(plan.grids).toEqual({});
});

test('with no main, a click selects it', () => {
  expect(planClick(env({}, null), 'orders').selection).toEqual(sel('orders'));
});

test('deselecting the main with no joined mart leaves nothing selected', () => {
  const plan = planClick(env({ orders: g(['id']) }, 'orders'), 'orders');
  expect(plan.selection).toEqual({ sourceKey: null, martId: null, record: null, cleared: true });
});

test('deselecting the main promotes the first joined mart, which brings the others it can join and drops the rest', () => {
  const grids = { orders: g(['id', 'customers__city', 'stores__city', 'products__sku']), customers: g(['id', 'name']) };
  const plan = planClick(env(grids, 'orders', {}), 'orders');
  expect(plan.selection).toEqual(sel('customers'));
  // customers joins stores (not products), so stores comes with its first text field
  expect(plan.grids.customers!.columns).toEqual(['id', 'name', 'stores__city']);
});

test('a promoted mart that already shows the others keeps its own grid as it is', () => {
  const grids = { orders: g(['id', 'customers__city', 'stores__city']), customers: g(['id', 'stores__city']) };
  const plan = planClick(env(grids, 'orders'), 'orders');
  expect(plan.selection).toEqual(sel('customers'));
  expect(plan.grids).toEqual({});
});

test('a mart the main one cannot join becomes the only selected mart: the joined columns it was left with go, and are remembered', () => {
  const grids = { customers: g(['id', 'countries__name']), orders: g(['id', 'customers__city', 'products__sku'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' } } }) };
  const plan = planClick(env(grids, 'customers'), 'orders');
  expect(plan.selection).toEqual(sel('orders'));
  expect(plan.grids.orders).toEqual(g(['id']));
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id'], picks: { customers: ['customers__city'], products: ['products__sku'] } }]);
});

test('with no main, the clicked mart opens with none of its joined columns', () => {
  const plan = planClick(env({ orders: g(['id', 'stores__city']) }, null), 'orders');
  expect(plan.grids.orders!.columns).toEqual(['id']);
});

test('an add groups the columns by mart: the main\'s own first, each joined mart together', () => {
  const plan = planClick(env({ orders: g(['id', 'customers__id', 'status']) }, 'orders'), 'products');
  expect(plan.grids.orders!.columns).toEqual(['id', 'status', 'customers__id', 'products__sku', 'products__price']);
  expect(plan.saves[0]!.columns).toEqual(['id', 'status', 'customers__id', 'products__sku', 'products__price']);
});

test('a promoted mart\'s grid is grouped too', () => {
  const grids = { orders: g(['id', 'customers__city']), customers: g(['stores__city', 'id']) };
  const plan = planClick(env(grids, 'orders'), 'orders');
  expect(plan.grids.customers!.columns).toEqual(['id', 'stores__city']);
  expect(plan.saves).toEqual([{ martId: 'customers', columns: ['id', 'stores__city'] }]);
});

describe('what a joined mart comes with by default', () => {
  const fld = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ ...f(name, category, 'm'), ...extra });
  const of = (...fields: Field[]) => src('m', 'm', fields);
  const names = (s: JoinedSource) => defaultJoinFields(s).map((x) => x.name);

  test('what counts as an ID', () => {
    expect(isIdField(fld('id', 'number'))).toBe(true);
    expect(isIdField(fld('ID', 'number'))).toBe(true);
    expect(isIdField(fld('customer_id', 'number'))).toBe(true);
    expect(isIdField(fld('m__customer_id', 'number'))).toBe(true);
    expect(isIdField(fld('customerId', 'string'))).toBe(true);
    expect(isIdField(fld('x', 'number', { isPrimaryKey: true }))).toBe(true);
    expect(isIdField(fld('x', 'number', { alias: 'Order ID' }))).toBe(true);
    expect(isIdField(fld('x', 'number', { alias: 'order id' }))).toBe(true);
    expect(isIdField(fld('city', 'string'))).toBe(false);
    expect(isIdField(fld('paid', 'number'))).toBe(false);
    expect(isIdField(fld('video', 'string'))).toBe(false);
    expect(isIdField(fld('x', 'number', { alias: 'Valid' }))).toBe(false);
  });

  test('the first text field that is not an ID, then the first metric that is not an ID', () => {
    expect(names(of(fld('m__id', 'number'), fld('m__uid_id', 'string'), fld('m__name', 'string'), fld('m__order_id', 'number'), fld('m__total', 'number'), fld('m__price', 'number')))).toEqual(['m__name', 'm__total']);
  });

  test('with only ID text fields the first text field is used', () => {
    expect(names(of(fld('m__session_id', 'string'), fld('m__total', 'number')))).toEqual(['m__session_id', 'm__total']);
  });

  test('with no metric only the text field is added', () => {
    expect(names(of(fld('m__id', 'number'), fld('m__name', 'string'), fld('m__order_id', 'number')))).toEqual(['m__name']);
  });

  test('with no text field the first two fields that are not IDs', () => {
    expect(names(of(fld('m__id', 'number'), fld('m__a', 'number'), fld('m__ok', 'boolean'), fld('m__b', 'number')))).toEqual(['m__a', 'm__ok']);
    expect(names(of(fld('m__id', 'number'), fld('m__order_id', 'number')))).toEqual(['m__id', 'm__order_id']);
  });

  test('a click adds both, and remembered picks still win', () => {
    const sources = [src('products', 'products', [f('products__sku', 'string', 'products'), f('products__price', 'number', 'products')])];
    const e = { ...env({ orders: g(['id']) }, 'orders'), sourcesOf: () => sources };
    expect(planClick(e, 'products').grids.orders!.columns).toEqual(['id', 'products__sku', 'products__price']);
    expect(planClick({ ...e, picksOf: () => ({ products: ['products__price'] }) }, 'products').grids.orders!.columns).toEqual(['id', 'products__price']);
  });
});
