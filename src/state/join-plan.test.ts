import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { UNIQUE_SHOWN, leaveAll, withoutPaths, planAddAt, planRejoin, defaultJoinFields, fieldsFor, inUsePaths, isIdField, joinedMartIds, planClick, planMakeMain, shortestSource, sourceOfMart, withoutMart, type PlanEnv } from './join-plan';
import type { GridState } from './store';

const f = (name: string, category: Field['category'], martId: string): Field => ({ name, alias: null, type: 'STRING', category, description: null, isPrimaryKey: false, joined: { martId, label: martId, aliasPath: martId, originalName: name.slice(martId.length + 2) } });
const src = (aliasPath: string, martId: string, fields: Field[], depth = 1): JoinedSource => ({ aliasPath, martId, label: martId, depth, fields, uniqueCount: false, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' });
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
    selection: sel(main), sourceKeyFor: () => null, sourcesOf: (id) => sources[id] ?? [], gridOf: (id) => grids[id] ?? g(['id']), ownColumns: () => ['id'], picksOf: (id) => picks[id] ?? {}, lastShownOf: () => null, ownNames: () => [],
  };
}

test('the joined marts are those with a field among the columns, in the order they first appear', () => {
  expect(joinedMartIds(['id', 'stores__city', 'customers__city', 'stores__x'], ordersSources)).toEqual(['stores', 'customers']);
  expect(joinedMartIds(['id'], ordersSources)).toEqual([]);
});

test('a mart comes back with the fields it showed that the source offers, else its default fields', () => {
  expect(fieldsFor(ordersSources, 'customers', ['email'])).toEqual(['customers__email']);
  expect(fieldsFor(ordersSources, 'customers', [])).toEqual(['customers__city']);
  expect(fieldsFor(ordersSources, 'customers', ['gone'])).toEqual(['customers__city']);
  expect(fieldsFor(ordersSources, 'nope', ['email'])).toEqual([]);
});

test('with two paths to one mart the shallowest source decides the first text field', () => {
  const deep = src('a.stores', 'stores', [f('a__stores__z', 'string', 'stores')], 2);
  expect(fieldsFor([...ordersSources, deep], 'stores', [])).toEqual(['stores__city']);
});

const counted = (s: JoinedSource): JoinedSource => ({ ...s, uniqueCount: true });

test('clicking a joinable mart that can count adds its Unique Count alone: no column, kept in the report', () => {
  const sources = ordersSources.map((s) => (s.aliasPath === 'customers' ? counted(s) : s));
  const plan = planClick({ ...env({ orders: g(['id', 'status']) }, 'orders'), sourcesOf: () => sources }, 'customers');
  expect(plan.selection).toEqual(sel('orders'));
  expect(plan.grids.orders!.columns).toEqual(['id', 'status']);
  expect(plan.grids.orders!.emptyPaths).toEqual(['customers']);
  expect(plan.grids.orders!.uniqueCount).toEqual(['customers']);
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id', 'status'] }]);
});

test('clicking a joinable mart that cannot count adds its first metric, not a text field', () => {
  const plan = planClick(env({ orders: g(['id', 'status']) }, 'orders'), 'products');
  expect(plan.grids.orders!.columns).toEqual(['id', 'status', 'products__price']);
  expect(plan.grids.orders!.uniqueCount).toBeUndefined();
  expect(plan.grids.orders!.emptyPaths).toBeUndefined();
});

test('a mart that can neither count nor sum stays in the report with no column', () => {
  const plan = planClick(env({ orders: g(['id', 'status']) }, 'orders'), 'customers');
  expect(plan.grids.orders!.columns).toEqual(['id', 'status']);
  expect(plan.grids.orders!.emptyPaths).toEqual(['customers']);
  expect(plan.grids.orders!.uniqueCount).toBeUndefined();
});

test('the first metric of a mart added to a grouped grid gets the function a chart would sum it with', () => {
  const out = planAddAt(g(['id', 'status'], { aggregations: [{ column: 'status', function: 'COUNT' }] }), ordersSources, 'products');
  expect(out.columns).toEqual(['id', 'status', 'products__price']);
  expect(out.aggregations).toEqual([{ column: 'status', function: 'COUNT' }, { column: 'products__price', function: 'SUM' }]);
});

test('a Unique Count added next to an existing one keeps both, and adding the same path again changes nothing', () => {
  const sources = ordersSources.map(counted);
  const once = planAddAt(g(['id'], { emptyPaths: ['stores'], uniqueCount: ['stores'] }), sources, 'customers');
  expect(once.emptyPaths).toEqual(['stores', 'customers']);
  expect(once.uniqueCount).toEqual(['stores', 'customers']);
  expect(planAddAt(once, sources, 'customers')).toEqual(once);
});

test('adding a joined mart while the main mart has no column does not bring its defaults back', () => {
  const plan = planClick(env({ orders: g(['customers__city']) }, 'orders'), 'products');
  expect(plan.grids.orders!.columns.filter((c) => !c.includes('__'))).toEqual([]);
  expect(plan.grids.orders!.columns).toContain('products__price');
  expect(planAddAt(g(['customers__city']), ordersSources, 'products').columns.filter((c) => !c.includes('__'))).toEqual([]);
});

test('promoting a joined mart over a main mart with no column remembers nothing for the old main', () => {
  const plan = planClick(env({ orders: g(['customers__city']), customers: g(['id']) }, 'orders'), 'orders');
  expect(plan.remember.some((r) => r.martId === 'orders')).toBe(false);
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

test('clicking a mart the main cannot join changes nothing', () => {
  const plan = planClick(env({ orders: g(['id', 'customers__city']) }, 'orders'), 'products2');
  expect(plan).toEqual({ selection: sel('orders'), grids: {}, saves: [], remember: [], noop: true });
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

test('a mart made main keeps the filters on fields that are not columns, for marts on its new grid only', () => {
  // customers is joined by the new main (orders), so its hidden customers__city filter stays; products is not on the new grid (no shown column), so its filter goes.
  const eq = (field: string) => ({ field, op: 'eq' as const, value: 'x' });
  const grids = { customers: g(['id']), orders: g(['id'], { filters: { customers__city: eq('customers__city'), products__sku: eq('products__sku'), gone: eq('gone') } }) };
  const plan = planMakeMain(env(grids, 'customers'), 'orders');
  expect(Object.keys(plan.grids.orders!.filters)).toEqual(['customers__city']);
});

test('a mart made main: its own columns, the old main joined with what it showed, marts it cannot reach remembered', () => {
  const grids = { customers: g(['id', 'countries__name']), orders: g(['id', 'customers__city', 'products__sku'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' } } }) };
  const plan = planMakeMain(env(grids, 'customers'), 'orders');
  expect(plan.selection).toEqual(sel('orders'));
  // The filter on a field of customers stays although its column is not shown: customers is on the new grid.
  expect(plan.grids.orders).toEqual(g(['id', 'customers__id'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' } } }));
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id', 'customers__id'] }]);
  expect(plan.remember).toEqual([{ martId: 'countries', fields: ['name'] }]);
});

describe('planMakeMain', () => {
  const customersBack = [src('orders', 'orders', [f('orders__status', 'string', 'orders'), f('orders__total', 'number', 'orders')]), ...customersSources];
  const envM = (grids: Record<string, GridState>, main: string | null): PlanEnv => ({
    ...env(grids, main),
    sourcesOf: (id) => ({ orders: ordersSources, customers: customersBack } as Record<string, JoinedSource[]>)[id] ?? [],
  });

  test('its own columns first, then the old main with the columns it showed, then the joined marts it can reach', () => {
    const plan = planMakeMain(envM({ orders: g(['id', 'status', 'customers__city', 'stores__city']), customers: g(['id', 'city']) }, 'orders'), 'customers');
    expect(plan.selection.martId).toBe('customers');
    expect(plan.grids.customers!.columns).toEqual(['id', 'city', 'orders__status', 'stores__city']);
    expect(plan.remember).toEqual([]);
  });

  test('the new main keeps a slice on a field it still joins, shown or not, and drops one it does not', () => {
    const slices = { stores__city: { field: 'stores__city', op: 'eq' as const, value: 'Rome' }, gone__x: { field: 'gone__x', op: 'eq' as const, value: 1 } };
    const plan = planMakeMain(envM({ orders: g(['id', 'status']), customers: g(['id', 'city'], { slices }) }, 'orders'), 'customers');
    expect(plan.grids.customers!.columns).not.toContain('stores__city');
    expect(plan.grids.customers!.slices).toEqual({ stores__city: slices.stores__city });
  });

  test('an old main that showed no own columns and cannot be reached does not wipe its remembered fields', () => {
    const plan = planMakeMain(envM({ orders: g(['customers__city']), products2: g(['id']) }, 'orders'), 'products2');
    expect(plan.remember.some((r) => r.martId === 'orders')).toBe(false);
  });

  test('a joined mart made main shows the fields it had as joined, as its own columns', () => {
    const e = { ...envM({ orders: g(['id', 'customers__city', 'customers__email']), customers: g(['id']) }, 'orders'), ownNames: () => ['id', 'city', 'email'] };
    expect(planMakeMain(e, 'customers').grids.customers!.columns.slice(0, 2)).toEqual(['city', 'email']);
  });

  test('a mart not on the grid brings what it showed when it last left one', () => {
    const e = { ...envM({ orders: g(['id']), customers: g(['id']) }, 'orders'), ownNames: () => ['id', 'name'], lastShownOf: (id: string) => (id === 'customers' ? ['name'] : null) };
    expect(planMakeMain(e, 'customers').grids.customers!.columns[0]).toBe('name');
  });

  test('the new main keeps its own filters and sorts on the new columns, and none of the old main\'s', () => {
    const grids = {
      orders: g(['id', 'status'], { filters: { status: { field: 'status', op: 'eq', value: 'paid' } } }),
      customers: g(['id', 'city'], { filters: { city: { field: 'city', op: 'eq', value: 'Kyiv' }, gone: { field: 'gone', op: 'eq', value: 'x' } }, sorts: [{ field: 'city', direction: 'asc' }] }),
    };
    const next = planMakeMain(envM(grids, 'orders'), 'customers').grids.customers!;
    expect(Object.keys(next.filters)).toEqual(['city']);
    expect(next.sorts).toEqual([{ field: 'city', direction: 'asc' }]);
  });

  test('making the main mart main, or with no main mart, falls back sensibly', () => {
    expect(planMakeMain(envM({}, 'orders'), 'orders').noop).toBe(true);
    expect(planMakeMain(envM({}, null), 'orders').selection.martId).toBe('orders');
  });
});

test('with no main, the clicked mart opens with none of its joined columns', () => {
  const plan = planClick(env({ orders: g(['id', 'stores__city']) }, null), 'orders');
  expect(plan.grids.orders!.columns).toEqual(['id']);
});

test('an add groups the columns by mart: the main\'s own first, each joined mart together', () => {
  const plan = planClick(env({ orders: g(['id', 'customers__id', 'status']) }, 'orders'), 'products');
  expect(plan.grids.orders!.columns).toEqual(['id', 'status', 'customers__id', 'products__price']);
  expect(plan.saves[0]!.columns).toEqual(['id', 'status', 'customers__id', 'products__price']);
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

  test('a click adds the Unique Count alone, else the first metric, and remembered picks still win', () => {
    const sources = [src('products', 'products', [f('products__sku', 'string', 'products'), f('products__price', 'number', 'products')])];
    const e = { ...env({ orders: g(['id']) }, 'orders'), sourcesOf: () => sources };
    expect(planClick(e, 'products').grids.orders!.columns).toEqual(['id', 'products__price']);
    const counting = { ...e, sourcesOf: () => sources.map(counted) };
    expect(planClick(counting, 'products').grids.orders).toMatchObject({ columns: ['id'], emptyPaths: ['products'], uniqueCount: ['products'] });
    const remembered = planClick({ ...counting, picksOf: () => ({ products: ['products__sku'] }) }, 'products').grids.orders!;
    expect(remembered.columns).toEqual(['id', 'products__sku']);
    expect(remembered.uniqueCount).toBeUndefined();
    expect(planClick({ ...e, picksOf: () => ({ products: ['products__price'] }) }, 'products').grids.orders!.columns).toEqual(['id', 'products__price']);
  });
});

describe('what a mart showed when it left the grid comes back', () => {
  const shown: Record<string, string[]> = {};
  const withShown = (e: PlanEnv): PlanEnv => ({ ...e, lastShownOf: (id) => shown[id] ?? null, ownNames: (id) => ({ customers: ['id', 'city', 'email', 'name'], orders: ['id', 'status'], stores: ['id', 'city'] }[id] ?? []) });
  beforeEach(() => { for (const k of Object.keys(shown)) delete shown[k]; });

  test('a joined mart that is removed remembers its own field names, and comes back with them', () => {
    const removed = planClick(withShown(env({ orders: g(['id', 'customers__email', 'customers__city']) }, 'orders')), 'customers');
    expect(removed.remember).toEqual([{ martId: 'customers', fields: ['email', 'city'] }]);
    shown.customers = ['email', 'city'];
    const back = planClick(withShown(env({ orders: g(['id']) }, 'orders', { orders: { customers: ['customers__id'] } })), 'customers');
    expect(back.grids.orders!.columns).toEqual(['id', 'customers__email', 'customers__city']);
  });

  test('a field the new main\'s source does not offer is skipped; with none left the new default comes back', () => {
    shown.stores = ['city', 'zip'];
    expect(planClick(withShown(env({ orders: g(['id']) }, 'orders')), 'stores').grids.orders!.columns).toEqual(['id', 'stores__city']);
    shown.stores = ['zip'];
    const plan = planClick(withShown(env({ orders: g(['id']) }, 'orders')), 'stores');
    expect(plan.grids.orders!.columns).toEqual(['id']);
    expect(plan.grids.orders!.emptyPaths).toEqual(['stores']);
  });

  test('a mart shown as joined and later clicked as main shows the same fields as its own columns', () => {
    shown.customers = ['name', 'email'];
    const plan = planMakeMain(withShown(env({ customers: g(['id', 'city']) }, 'stores')), 'customers');
    expect(plan.selection.martId).toBe('customers');
    // The old main (stores) now joins the new one, so its columns follow the own ones.
    expect(plan.grids.customers!.columns.slice(0, 2)).toEqual(['name', 'email']);
    expect(plan.saves[0]!.martId).toBe('customers');
    expect(plan.saves[0]!.columns.slice(0, 2)).toEqual(['name', 'email']);
    expect(plan.remember).not.toContainEqual({ martId: 'customers', fields: null });
  });

  test('the main mart that is deselected remembers its own columns; clicked again it shows them', () => {
    const left = planClick(withShown(env({ orders: g(['id', 'status']) }, 'orders')), 'orders');
    expect(left.remember).toEqual([{ martId: 'orders', fields: ['id', 'status'] }]);
    shown.orders = ['status', 'id'];
    const again = planClick(withShown(env({ orders: g(['id']) }, null)), 'orders');
    expect(again.grids.orders!.columns).toEqual(['status', 'id']);
  });

  test('a main replaced by another mart, and its joined marts, remember what they showed', () => {
    const plan = planMakeMain(withShown(env({ orders: g(['id', 'customers__city']), order_items: g(['id']) }, 'orders')), 'order_items');
    expect(plan.remember).toEqual(expect.arrayContaining([{ martId: 'orders', fields: ['id'] }, { martId: 'customers', fields: ['city'] }]));
  });

  test('a promoted mart shows the fields it had as joined, as its own columns', () => {
    const plan = planClick(withShown(env({ orders: g(['id', 'customers__city', 'customers__email']), customers: g(['id']) }, 'orders')), 'orders');
    expect(plan.grids.customers!.columns).toEqual(['city', 'email']);
    expect(plan.remember).toEqual(expect.arrayContaining([{ martId: 'orders', fields: ['id'] }]));
  });

  test('joined marts stripped from the new main\'s stale saved grid do not override what the screen showed', () => {
    const stores = src('stores', 'stores', [f('stores__city', 'string', 'stores'), f('stores__zip', 'string', 'stores')]);
    const sources: Record<string, JoinedSource[]> = { orders: [stores], customers: [stores], z: [] };
    const base: PlanEnv = { selection: sel('customers'), sourceKeyFor: () => null, sourcesOf: (id) => sources[id] ?? [], gridOf: (id) => ({ customers: g(['id', 'stores__zip']), orders: g(['id', 'stores__city']) }[id] ?? g(['id'])), ownColumns: () => ['id'], picksOf: () => ({}), lastShownOf: () => null, ownNames: () => [] };
    const plan = planMakeMain(withShown(base), 'orders');
    // The new main (orders) can join stores, so stores is joined into it and not remembered as left.
    expect(plan.remember.filter((r) => r.martId === 'stores')).toEqual([]);
    expect(plan.grids.orders!.columns).toEqual(['id', 'stores__zip']);
  });

  test('a mart made main keeps what it remembered, so Undo has nothing to restore', () => {
    shown.customers = ['name'];
    const plan = planMakeMain(withShown(env({ customers: g(['id']) }, 'stores')), 'customers');
    expect(plan.remember.some((r) => r.martId === 'customers')).toBe(false);
  });
});

test('taking a joined mart out drops its aggregation rules with its columns', () => {
  const grid = g(['id', 'customers__city', 'customers__id'], { aggregations: [{ column: 'customers__id', function: 'COUNT' }, { column: 'id', function: 'COUNT' }], dateTrunc: [] });
  const out = withoutMart(grid, ordersSources, 'customers', ['id']).grid;
  expect(out.columns).toEqual(['id']);
  expect(out.aggregations).toEqual([{ column: 'id', function: 'COUNT' }]);
  expect(out.dateTrunc).toBeUndefined();
});

describe('the path a mart joins by', () => {
  const direct = src('stores', 'stores', [f('stores__city', 'string', 'stores')], 1);
  const viaCustomers = src('customers.stores', 'stores', [f('customers__stores__city', 'string', 'stores')], 2);
  const viaProducts = src('products.stores', 'stores', [f('products__stores__city', 'string', 'stores')], 2);
  const customers = src('customers', 'customers', [f('customers__city', 'string', 'customers')], 1);
  const products = src('products', 'products', [f('products__sku', 'string', 'products')], 1);

  test('a direct join to the main mart wins', () => {
    expect(sourceOfMart([customers, direct, viaCustomers], 'stores', new Set(['', 'customers']))?.aliasPath).toBe('stores');
  });

  test('with no direct join, the path through a mart in use wins over one listed first', () => {
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores', new Set(['', 'customers']))?.aliasPath).toBe('customers.stores');
  });

  test('with no path through a mart in use, the first (shallowest) path', () => {
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores', new Set(['']))?.aliasPath).toBe('products.stores');
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores')?.aliasPath).toBe('products.stores');
  });

  test('the paths in use are the main mart\'s and those of the joined columns', () => {
    expect(inUsePaths(['id', 'customers__city'], [customers, products])).toEqual(new Set(['', 'customers']));
  });

  test('clicking a mart joins it through the joined mart closest to the main one', () => {
    const sources = [customers, products, viaProducts, viaCustomers];
    const e = { ...env({ orders: g(['id', 'customers__city']) }, 'orders'), sourcesOf: (id: string) => (id === 'orders' ? sources : []) };
    // The mart joins through the joined mart closest to the main one: it has no metric here, so it stays with no column.
    expect(planClick(e, 'stores').grids.orders!.emptyPaths).toEqual(['customers.stores']);
  });

  test('a promoted mart joins a remaining mart through the path from a mart in use, not the first listed', () => {
    const ordersSrc = [customers, src('stores', 'stores', [f('stores__city', 'string', 'stores')])];
    const countries = src('countries', 'countries', [f('countries__name', 'string', 'countries')]);
    const nextSources = [countries, products, viaProducts, src('countries.stores', 'stores', [f('countries__stores__city', 'string', 'stores')], 2)];
    const e = {
      ...env({ orders: g(['id', 'customers__city', 'stores__city']), customers: g(['id', 'countries__name']) }, 'orders'),
      sourcesOf: (id: string) => (id === 'orders' ? ordersSrc : id === 'customers' ? nextSources : []),
    };
    const columns = planClick(e, 'orders').grids.customers!.columns;
    expect(columns).toContain('countries__stores__city');
    expect(columns).not.toContain('products__stores__city');
  });
});

const jf = (path: string, own: string): Field => ({ name: `${path.replaceAll('.', '__')}__${own}`, alias: own, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: path.split('.').at(-1)!, label: path, aliasPath: path, originalName: own } });
const js = (path: string, owns = ['name', 'n']): JoinedSource => ({ aliasPath: path, martId: path.split('.').at(-1)!, label: path, depth: path.split('.').length, fields: owns.map((o) => jf(path, o)), uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' });
const jc = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;
const rjSources = [js('a'), js('b'), js('a.c', ['name', 'n', 'only_a']), js('b.c')];
const base: GridState = { columns: ['id', jc('a'), jc('b'), jc('a.c'), jc('a.c', 'n'), jc('a.c', 'only_a')], filters: { [jc('a.c')]: { field: jc('a.c'), op: 'eq', value: 'x' }, [jc('a.c', 'only_a')]: { field: jc('a.c', 'only_a'), op: 'eq', value: 'y' } }, sorts: [{ field: jc('a.c', 'n'), direction: 'desc' }], limit: 100, aggregations: [{ column: jc('a.c', 'n'), function: 'SUM' }] };

test('planAddAt adds the mart through that exact path, with its Unique Count alone', () => {
  const out = planAddAt({ ...base, columns: ['id', jc('b')], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c');
  // The path counts: no column of it, no dimension.
  expect(out.columns).toEqual(['id', jc('b')]);
  expect(out.emptyPaths).toEqual(['b.c']);
  expect(out.uniqueCount).toEqual(['b.c']);
});

test('planAddAt keeps remembered fields offered by the path', () => {
  const out = planAddAt({ ...base, columns: ['id'], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c', [jc('b.c', 'n')]);
  expect(out.columns).toEqual(['id', jc('b.c', 'n')]);
});

test('planRejoin swaps columns, filters, sorts and aggregations to the new path and drops what it lacks', () => {
  const out = planRejoin(base, rjSources, new Map([['a.c', 'b.c']]), ['id']);
  expect(out.columns).toEqual(['id', jc('a'), jc('b'), jc('b.c'), jc('b.c', 'n')]);
  expect(Object.keys(out.filters)).toEqual([jc('b.c')]);
  expect(out.filters[jc('b.c')]).toEqual({ field: jc('b.c'), op: 'eq', value: 'x' });
  expect(out.sorts).toEqual([{ field: jc('b.c', 'n'), direction: 'desc' }]);
  expect(out.aggregations).toEqual([{ column: jc('b.c', 'n'), function: 'SUM' }]);
});

test('planRejoin with no moves returns the grid unchanged', () => {
  expect(planRejoin(base, rjSources, new Map(), ['id'])).toEqual(base);
});

describe('inUsePaths without the main path', () => {
  const ps = [js('a'), js('b'), js('a.c'), js('b.c')];
  test('lists the alias paths of the columns in the order each first appears, once', () => {
    expect([...inUsePaths(['id', jc('b.c'), jc('a'), jc('b.c', 'n'), jc('a.c')], ps)].filter(Boolean)).toEqual(['b.c', 'a', 'a.c']);
  });
  test('the main mart own columns are no path', () => {
    expect([...inUsePaths(['id'], ps)].filter(Boolean)).toEqual([]);
  });
});

describe('withoutPaths', () => {
  const ps = [js('a'), js('a.c'), js('b'), js('b.c')];
  const two: GridState = {
    columns: ['id', jc('a.c'), jc('a.c', 'n'), jc('b.c'), jc('b.c', 'n')],
    filters: { [jc('a.c')]: { field: jc('a.c'), op: 'eq', value: 'x' }, [jc('b.c')]: { field: jc('b.c'), op: 'eq', value: 'y' } },
    sorts: [{ field: jc('a.c', 'n'), direction: 'desc' }, { field: jc('b.c', 'n'), direction: 'asc' }],
    limit: 100,
    aggregations: [{ column: jc('a.c', 'n'), function: 'SUM' }, { column: jc('b.c', 'n'), function: 'SUM' }],
    dateTrunc: [{ column: jc('a.c'), unit: 'MONTH' } as never, { column: jc('b.c'), unit: 'MONTH' } as never],
  };
  test('removing a.c keeps the columns, filters, sorts and aggregations of b.c', () => {
    const out = withoutPaths(two, ps, ['a.c'], ['id']);
    expect(out.columns).toEqual(['id', jc('b.c'), jc('b.c', 'n')]);
    expect(Object.keys(out.filters)).toEqual([jc('b.c')]);
    expect(out.sorts).toEqual([{ field: jc('b.c', 'n'), direction: 'asc' }]);
    expect(out.aggregations).toEqual([{ column: jc('b.c', 'n'), function: 'SUM' }]);
    expect(out.dateTrunc).toEqual([{ column: jc('b.c'), unit: 'MONTH' }]);
  });
  test('removing several paths takes them all, and sorts left empty become null', () => {
    const out = withoutPaths({ ...two, sorts: [{ field: jc('a.c', 'n'), direction: 'desc' }] }, ps, ['a.c', 'b.c'], ['id']);
    expect(out.columns).toEqual(['id']);
    expect(out.filters).toEqual({});
    expect(out.sorts).toBeNull();
    expect(out.aggregations).toBeUndefined();
    expect(out.dateTrunc).toBeUndefined();
  });
  test('a grid left with no column gets the own ones', () => {
    expect(withoutPaths(g([jc('a.c')]), ps, ['a.c'], ['id', 'status']).columns).toEqual(['id', 'status']);
  });
  test('a path with no field in use returns the same grid', () => {
    expect(withoutPaths(two, ps, ['zzz'], ['id'])).toBe(two);
  });
  test('removing a path takes its Unique Count and that count\'s sort with it, and keeps the others', () => {
    const out = withoutPaths({ ...two, uniqueCount: ['', 'a.c', 'b.c'], sorts: [{ field: 'a__c__unique_count', direction: 'asc' }, { field: 'Unique Count', direction: 'desc' }] }, ps, ['a.c'], ['id']);
    expect(out.uniqueCount).toEqual(['', 'b.c']);
    expect(out.sorts).toEqual([{ field: 'Unique Count', direction: 'desc' }]);
    expect(withoutPaths({ ...two, uniqueCount: ['a.c'] }, ps, ['a.c'], ['id']).uniqueCount).toBeUndefined();
  });
  test('a grid whose only change is a Unique Count on a removed path is touched', () => {
    const bare = { columns: ['id'], filters: {}, sorts: null, limit: 100, uniqueCount: ['a.c'] } as GridState;
    expect(withoutPaths(bare, ps, ['a.c'], ['id']).uniqueCount).toBeUndefined();
  });
  test('a path that holds none of the columns changes nothing', () => {
    expect(withoutPaths(two, ps, ['b'], ['id']).columns).toEqual(two.columns);
  });
});

describe('slices in join-plan', () => {
  const slice = (field: string) => ({ field, op: 'eq' as const, value: 'PL' });
  const grid = g(['id', 'customers__city', 'products__sku'], { slices: { customers__city: slice('customers__city'), products__sku: slice('products__sku') } });

  test('taking a mart out drops its slices and keeps the others', () => {
    const { grid: out } = withoutMart(grid, ordersSources, 'customers', ['id']);
    expect(out.slices).toEqual({ products__sku: slice('products__sku') });
    expect(withoutMart(g(['id', 'customers__city'], { slices: { customers__city: slice('customers__city') } }), ordersSources, 'customers', ['id']).grid.slices).toBeUndefined();
  });

  test('taking paths out drops their slices even when no column was shown', () => {
    const only = g(['id'], { slices: { customers__city: slice('customers__city') } });
    expect(withoutPaths(only, ordersSources, ['customers'], ['id']).slices).toBeUndefined();
    expect(withoutPaths(grid, ordersSources, ['products'], ['id']).slices).toEqual({ customers__city: slice('customers__city') });
  });

  test('taking a mart out drops a HAVING filter whose aggregation went with it', () => {
    const having = { field: 'customers__id', op: 'gt' as const, value: 3, fn: 'SUM' as const };
    const withHaving = g(['id', 'customers__id'], { filters: { customers__id: having, id: { field: 'id', op: 'gt', value: 1 } }, aggregations: [{ column: 'customers__id', function: 'SUM' }] });
    expect(Object.keys(withoutMart(withHaving, ordersSources, 'customers', ['id']).grid.filters)).toEqual(['id']);
  });

  test('a rejoined path renames the field of its slice', () => {
    const moved = planRejoin(g(['id', 'customers__city'], { slices: { customers__city: slice('customers__city') } }), [...ordersSources, src('a.customers', 'customers', [{ ...f('customers__city', 'string', 'customers'), name: 'a__customers__city', joined: { martId: 'customers', label: 'customers', aliasPath: 'a.customers', originalName: 'city' } }], 2)], new Map([['customers', 'a.customers']]), ['id']);
    expect(moved.slices).toEqual({ a__customers__city: { field: 'a__customers__city', op: 'eq', value: 'PL' } });
  });
});

describe('refit pins: what each call site does to sorts, aggregations, buckets, filters and slices', () => {
  const having = (field: string) => ({ field, op: 'gt' as const, value: 3, fn: 'SUM' as const });
  const slice = (field: string) => ({ field, op: 'eq' as const, value: 'PL' });
  const rich = g(['id', 'customers__id', 'customers__city', 'products__price'], {
    sorts: [{ field: 'customers__city', direction: 'asc' }, { field: 'id', direction: 'desc' }],
    aggregations: [{ column: 'customers__id', function: 'SUM' }, { column: 'products__price', function: 'SUM' }],
    dateTrunc: [{ column: 'customers__city', unit: 'MONTH' }],
    filters: { customers__id: having('customers__id'), products__price: having('products__price'), id: { field: 'id', op: 'eq', value: 1 } },
    slices: { customers__city: slice('customers__city'), products__sku: slice('products__sku') },
  });

  test('withoutMart keeps the surviving sorts, rules, filters and slices', () => {
    const { grid, removed } = withoutMart(rich, ordersSources, 'customers', ['id']);
    expect(removed).toEqual(['customers__id', 'customers__city']);
    expect(grid).toEqual({
      ...rich,
      columns: ['id', 'products__price'],
      sorts: [{ field: 'id', direction: 'desc' }],
      aggregations: [{ column: 'products__price', function: 'SUM' }],
      dateTrunc: undefined,
      filters: { products__price: having('products__price'), id: { field: 'id', op: 'eq', value: 1 } },
      slices: { products__sku: slice('products__sku') },
    });
  });

  test('withoutMart nulls the sorts when all are lost, and falls back to the own columns', () => {
    const only = g(['customers__city'], { sorts: [{ field: 'customers__city', direction: 'asc' }], aggregations: [{ column: 'customers__city', function: 'COUNT' }] });
    const { grid } = withoutMart(only, ordersSources, 'customers', ['id', 'status']);
    expect(grid).toEqual({ ...only, columns: ['id', 'status'], sorts: null, aggregations: undefined, dateTrunc: undefined, filters: {}, slices: undefined });
    expect(withoutMart(g(['id', 'customers__city']), ordersSources, 'customers', ['id']).grid.sorts).toBeNull();
  });

  test('withoutPaths gives the same result as withoutMart for the same names', () => {
    expect(withoutPaths(rich, ordersSources, ['customers'], ['id'])).toEqual(withoutMart(rich, ordersSources, 'customers', ['id']).grid);
    const only = g(['customers__city'], { sorts: [{ field: 'customers__city', direction: 'asc' }] });
    expect(withoutPaths(only, ordersSources, ['customers'], ['id', 'status'])).toEqual({ ...only, columns: ['id', 'status'], sorts: null, aggregations: undefined, dateTrunc: undefined, filters: {}, slices: undefined });
  });

  test('withoutPaths returns the same grid when no path is in use', () => {
    expect(withoutPaths(rich, ordersSources, ['stores'], ['id'])).toBe(rich);
  });

  test('becoming main restores the last shown columns: sorts and rules refit, filters and slices stay as they were', () => {
    const grids = { products: g(['sku', 'price', 'name'], { sorts: [{ field: 'price', direction: 'asc' }, { field: 'name', direction: 'asc' }], aggregations: [{ column: 'price', function: 'SUM' }, { column: 'name', function: 'COUNT' }], dateTrunc: [{ column: 'name', unit: 'DAY' }], filters: { price: having('price') }, slices: { name: slice('name') } }) };
    const e: PlanEnv = { ...env(grids, null), ownNames: () => ['sku', 'price', 'name'], lastShownOf: () => ['sku', 'price'] };
    const plan = planClick(e, 'products');
    expect(plan.grids.products).toEqual({ ...grids.products, columns: ['sku', 'price'], sorts: [{ field: 'price', direction: 'asc' }], aggregations: [{ column: 'price', function: 'SUM' }], dateTrunc: undefined });
    const none: PlanEnv = { ...e, lastShownOf: () => ['sku'] };
    expect(planClick(none, 'products').grids.products).toEqual({ ...grids.products, columns: ['sku'], sorts: null, aggregations: undefined, dateTrunc: undefined });
  });

  test('becoming main with a last-shown list that drops an aggregated column drops its rule and keeps its HAVING filter as it was', () => {
    const grids = { products: g(['sku', 'price', 'name'], { aggregations: [{ column: 'price', function: 'SUM' }], filters: { price: having('price') } }) };
    const e: PlanEnv = { ...env(grids, null), ownNames: () => ['sku', 'price', 'name'], lastShownOf: () => ['sku', 'name'] };
    const plan = planClick(e, 'products');
    expect(plan.grids.products).toEqual({ ...grids.products, columns: ['sku', 'name'], sorts: null, aggregations: undefined, dateTrunc: undefined });
  });

  test('becoming main strips the joined marts the stale grid still held', () => {
    const grids = { customers: g(['id', 'countries__name', 'stores__city'], { sorts: [{ field: 'countries__name', direction: 'asc' }], aggregations: [{ column: 'stores__city', function: 'COUNT' }] }) };
    const plan = planClick(env(grids, null), 'customers');
    expect(plan.grids.customers).toEqual({ ...grids.customers, columns: ['id'], sorts: null, aggregations: undefined, dateTrunc: undefined, filters: {}, slices: undefined });
  });

  test('making a mart main refits its own grid to the new columns, with filters kept by column and slices by joined field', () => {
    const grids = {
      orders: g(['id', 'customers__city']),
      customers: g(['id', 'city'], { sorts: [{ field: 'city', direction: 'asc' }, { field: 'gone', direction: 'asc' }], aggregations: [{ column: 'city', function: 'COUNT' }, { column: 'gone', function: 'SUM' }], dateTrunc: [{ column: 'gone', unit: 'DAY' }], filters: { city: { field: 'city', op: 'eq', value: 'x' }, gone: having('gone') }, slices: { countries__name: slice('countries__name'), other: slice('other') } }),
    };
    const e: PlanEnv = { ...env(grids, 'orders'), ownColumns: () => ['id', 'city'] };
    const next = planMakeMain(e, 'customers').grids.customers!;
    expect(next.columns).toEqual(['id', 'city']);
    expect(next).toEqual({
      ...grids.customers,
      columns: ['id', 'city'],
      sorts: [{ field: 'city', direction: 'asc' }],
      aggregations: [{ column: 'city', function: 'COUNT' }],
      dateTrunc: undefined,
      filters: { city: { field: 'city', op: 'eq', value: 'x' } },
      slices: { countries__name: slice('countries__name') },
    });
  });

  test('a rejoin maps sorts, rules and buckets onto the new path, dropping what the path lacks', () => {
    const target = src('a.customers', 'customers', [{ ...f('customers__city', 'string', 'customers'), name: 'a__customers__city', joined: { martId: 'customers', label: 'customers', aliasPath: 'a.customers', originalName: 'city' } }], 2);
    const grid = g(['id', 'customers__id', 'customers__city'], { sorts: [{ field: 'customers__city', direction: 'asc' }], aggregations: [{ column: 'customers__id', function: 'SUM' }, { column: 'customers__city', function: 'COUNT' }], dateTrunc: [{ column: 'customers__id', unit: 'DAY' }] });
    const out = planRejoin(grid, [...ordersSources, target], new Map([['customers', 'a.customers']]), ['id']);
    expect(out).toEqual({ ...grid, columns: ['id', 'a__customers__city'], sorts: [{ field: 'a__customers__city', direction: 'asc' }], aggregations: [{ column: 'a__customers__city', function: 'COUNT' }], dateTrunc: undefined, filters: {}, slices: undefined });
  });
});

describe('a click on a mart outside the report joins it by the shortest chain', () => {
  const direct = src('x', 'x', [f('x__a', 'string', 'x')]);
  const viaP = src('p.x', 'x', [f('p__x__a', 'string', 'x')], 2);
  const viaQ = src('q.x', 'x', [f('q__x__a', 'string', 'x')], 2);
  const long = src('p.r.x', 'x', [f('p__r__x__a', 'string', 'x')], 3);
  const p = src('p', 'p', [f('p__n', 'string', 'p')]);
  const q = src('q', 'q', [f('q__n', 'string', 'q')]);

  test('the path with the fewest marts wins over a deeper one that hangs from a mart in use', () => {
    expect(shortestSource([direct, viaP, long], 'x', new Set(['', 'p']))!.aliasPath).toBe('x');
    expect(shortestSource([viaP, long], 'x', new Set(['', 'p']))!.aliasPath).toBe('p.x');
  });

  test('on a tie the path through marts already in the report wins, then the first by title', () => {
    expect(shortestSource([viaP, viaQ], 'x', new Set(['', 'q']))!.aliasPath).toBe('q.x');
    expect(shortestSource([viaP, viaQ], 'x', new Set(['']))!.aliasPath).toBe('p.x');
  });

  test('the click adds the mart by that path, and the middle mart joins with no column of its own', () => {
    const sources = [p, q, viaP, viaQ];
    const plan = planClick({ ...env({ orders: g(['id']) }, 'orders'), sourcesOf: () => sources }, 'x');
    expect(plan.grids.orders!.columns).toEqual(['id']);
    expect(plan.grids.orders!.emptyPaths).toEqual(['p.x']);
  });

  test('a path in use makes the chain through it the one to reuse', () => {
    const sources = [p, q, viaP, viaQ];
    const plan = planClick({ ...env({ orders: g(['id', 'q__n']) }, 'orders'), sourcesOf: () => sources }, 'x');
    expect(plan.grids.orders!.emptyPaths).toEqual(['q.x']);
  });
});

describe('joined marts kept with no column (empty paths)', () => {
  const customers = src('customers', 'customers', [f('customers__city', 'string', 'customers')], 1);
  const stores = src('stores', 'stores', [f('stores__city', 'string', 'stores')], 1);
  const ps = [customers, stores, src('customers.stores', 'stores', [f('customers__stores__city', 'string', 'stores')], 2)];

  test('joinedMartIds and inUsePaths list the empty paths after those with columns, and skip unknown or repeated ones', () => {
    expect(joinedMartIds(['id', 'stores__city'], ordersSources, ['customers', 'stores', 'nope', 'products'])).toEqual(['stores', 'customers', 'products']);
    expect([...inUsePaths(['id', 'stores__city'], ordersSources, ['customers', 'stores', 'nope'])].filter(Boolean)).toEqual(['stores', 'customers']);
    expect(inUsePaths(['id', 'stores__city'], ordersSources, ['customers', 'nope'])).toEqual(new Set(['', 'stores', 'customers']));
    expect(joinedMartIds(['id'], ordersSources)).toEqual([]);
    expect([...inUsePaths(['id'], ordersSources)].filter(Boolean)).toEqual([]);
  });

  test('withoutPaths drops the removed paths from the empty ones, and a grid that only has the path as empty is touched', () => {
    const grid = g(['id'], { emptyPaths: ['customers', 'stores'] });
    const out = withoutPaths(grid, ps, ['customers'], ['id']);
    expect(out.emptyPaths).toEqual(['stores']);
    expect(withoutPaths(grid, ps, ['customers', 'stores'], ['id']).emptyPaths).toBeUndefined();
    expect(withoutPaths(grid, ps, ['zzz'], ['id'])).toBe(grid);
  });

  test('withoutMart drops every empty path of the mart', () => {
    const grid = g(['id', 'customers__city'], { emptyPaths: ['customers.stores', 'stores'] });
    expect(withoutMart(grid, ps, 'stores', ['id']).grid.emptyPaths).toBeUndefined();
    expect(withoutMart(grid, ps, 'customers', ['id']).grid.emptyPaths).toEqual(['customers.stores', 'stores']);
  });

  test('planAddAt drops the path it adds columns to from the empty ones', () => {
    const out = planAddAt(g(['id'], { emptyPaths: ['customers', 'stores'] }), ps, 'customers', ['customers__city']);
    expect(out.columns).toEqual(['id', 'customers__city']);
    expect(out.emptyPaths).toEqual(['stores']);
    expect(planAddAt(g(['id'], { emptyPaths: ['customers'] }), ps, 'customers', ['customers__city']).emptyPaths).toBeUndefined();
  });

  test('planRejoin maps the empty paths through the moves', () => {
    const out = planRejoin(g(['id'], { emptyPaths: ['stores', 'customers'] }), ps, new Map([['stores', 'customers.stores']]), ['id']);
    expect(out.emptyPaths).toEqual(['customers.stores', 'customers']);
    expect(planRejoin(g(['id'], { emptyPaths: ['customers'] }), ps, new Map([['stores', 'customers.stores']]), ['id']).emptyPaths).toEqual(['customers']);
  });

  test('a Unique Count on a mart kept with no column goes when the mart is removed, by card, path or whole mart', () => {
    const grid = g(['id'], { emptyPaths: ['customers', 'stores'], uniqueCount: ['customers', 'stores'] });
    const plan = planClick(env({ orders: grid }, 'orders'), 'customers');
    expect(plan.grids.orders!.emptyPaths).toEqual(['stores']);
    expect(plan.grids.orders!.uniqueCount).toEqual(['stores']);
    expect(withoutPaths(grid, ps, ['customers', 'stores'], ['id'])).toMatchObject({ emptyPaths: undefined, uniqueCount: undefined });
    expect(withoutMart(grid, ps, 'stores', ['id']).grid.uniqueCount).toEqual(['customers']);
  });

  test('planRejoin moves the Unique Count of an empty mart with its path', () => {
    const out = planRejoin(g(['id'], { emptyPaths: ['stores'], uniqueCount: ['stores'] }), ps, new Map([['stores', 'customers.stores']]), ['id']);
    expect(out.emptyPaths).toEqual(['customers.stores']);
    expect(out.uniqueCount).toEqual(['customers.stores']);
  });

  test('deselecting the main carries the Unique Count of an empty mart to the new main with the path', () => {
    const grids = { orders: g(['id', 'customers__city'], { emptyPaths: ['stores'], uniqueCount: ['stores'] }), customers: g(['id', 'name']) };
    const e = { ...env(grids, 'orders'), sourcesOf: (id: string) => (id === 'orders' ? ordersSources : id === 'customers' ? customersSources.map(counted) : []) };
    const plan = planClick(e, 'orders');
    expect(plan.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plan.grids.customers!.uniqueCount).toEqual(['stores']);
    // The new main cannot count it: only the mart is kept.
    const plain = planClick(env(grids, 'orders'), 'orders');
    expect(plain.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plain.grids.customers!.uniqueCount).toBeUndefined();
  });

  test('making a mart the main one carries the Unique Count of an empty mart with the path', () => {
    const grids = { orders: g(['id', 'customers__city'], { emptyPaths: ['stores'], uniqueCount: ['stores'] }), customers: g(['id', 'name']) };
    const e = { ...env(grids, 'orders'), sourcesOf: (id: string) => (id === 'orders' ? ordersSources : id === 'customers' ? customersSources.map(counted) : []) };
    const plan = planMakeMain(e, 'customers');
    expect(plan.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plan.grids.customers!.uniqueCount).toEqual(['stores']);
  });

  test('clicking a selected empty mart takes it out and remembers nothing about its fields', () => {
    const plan = planClick(env({ orders: g(['id'], { emptyPaths: ['customers'] }) }, 'orders'), 'customers');
    expect(plan.grids.orders!.emptyPaths).toBeUndefined();
    expect(plan.grids.orders!.columns).toEqual(['id']);
    expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id'] }]);
    expect(plan.remember).toEqual([]);
  });

  test('deselecting the main promotes an empty mart, which opens with its own grid columns', () => {
    const plan = planClick(env({ orders: g(['id'], { emptyPaths: ['customers'] }), customers: g(['id', 'name']) }, 'orders'), 'orders');
    expect(plan.selection).toEqual(sel('customers'));
    expect(plan.grids).toEqual({});
    // It showed no column: nothing to forget about what it last showed.
    expect(plan.remember).toEqual([{ martId: 'orders', fields: ['id'] }]);
  });

  test('deselecting the main carries the other empty marts to the new main as empty, never with columns', () => {
    const grids = { orders: g(['id', 'customers__city'], { emptyPaths: ['stores', 'products'] }), customers: g(['id', 'name']) };
    const plan = planClick(env(grids, 'orders'), 'orders');
    // customers joins stores (not products): stores stays empty at the path customers joins it by, products is left out.
    expect(plan.grids.customers!.columns).toEqual(['id', 'name']);
    expect(plan.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plan.saves).toEqual([{ martId: 'customers', columns: ['id', 'name'] }]);
    expect(plan.remember.some((r) => r.martId === 'products')).toBe(false);
  });

  test('an empty mart carried to the new main takes the path closest to a path in use', () => {
    const viaCountries = src('countries.stores', 'stores', [f('countries__stores__city', 'string', 'stores')], 2);
    const countries = src('countries', 'countries', [f('countries__name', 'string', 'countries')]);
    const e = {
      ...env({ orders: g(['id', 'customers__city', 'countries__name'], { emptyPaths: ['stores'] }), customers: g(['id', 'countries__name']) }, 'orders'),
      sourcesOf: (id: string) => (id === 'orders' ? [...ordersSources, src('countries', 'countries', [f('countries__name', 'string', 'countries')])] : id === 'customers' ? [countries, viaCountries, ...customersSources.filter((s) => s.martId === 'stores')] : []),
    };
    const plan = planClick(e, 'orders');
    expect(plan.grids.customers!.emptyPaths).toEqual(['countries.stores']);
    expect(plan.grids.customers!.columns).toEqual(['id', 'countries__name']);
  });

  test('deselecting the main keeps an own empty path of the new main although its mart has columns at another path', () => {
    const viaCountries = src('countries.stores', 'stores', [f('countries__stores__city', 'string', 'stores')], 2);
    const countries = src('countries', 'countries', [f('countries__name', 'string', 'countries')]);
    const e = {
      ...env({ orders: g(['id', 'customers__city']), customers: g(['id', 'countries__stores__city'], { emptyPaths: ['stores'] }) }, 'orders'),
      sourcesOf: (id: string) => (id === 'orders' ? ordersSources : id === 'customers' ? [countries, viaCountries, ...customersSources.filter((s) => s.martId === 'stores')] : []),
    };
    const plan = planClick(e, 'orders');
    expect(plan.selection).toEqual(sel('customers'));
    // Nothing changes on its own grid: the empty path is not lost.
    expect(plan.grids).toEqual({});
  });

  test('making a mart main carries an empty joined mart as empty, and an empty mart made main opens with its own columns', () => {
    const grids = { orders: g(['id', 'customers__city'], { emptyPaths: ['stores', 'products'] }), customers: g(['id', 'name']) };
    const plan = planMakeMain(env(grids, 'orders'), 'customers');
    expect(plan.grids.customers!.columns.some((c) => c.startsWith('stores__') || c.startsWith('products__'))).toBe(false);
    expect(plan.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plan.remember.some((r) => r.martId === 'stores' || r.martId === 'products')).toBe(false);
    const made = planMakeMain(env({ orders: g(['id'], { emptyPaths: ['customers'] }), customers: g(['id', 'name']) }, 'orders'), 'customers');
    expect(made.selection).toEqual(sel('customers'));
    expect(made.grids.customers!.columns).toEqual(['id', 'name']);
  });

  test('a mart that becomes main from nothing drops the empty marts its stale grid holds, and wipes no remembered pick', () => {
    const plan = planClick(env({ orders: g(['id'], { emptyPaths: ['customers'] }) }, null), 'orders');
    expect(plan.grids.orders!.emptyPaths).toBeUndefined();
    expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id'], picks: {} }]);
  });

  test('a mart the report shows with columns keeps them when the promoted mart has it as an old empty path', () => {
    const grids = { orders: g(['id', 'customers__city', 'stores__city']), customers: g(['name'], { emptyPaths: ['stores'] }) };
    const plan = planClick(env(grids, 'orders'), 'orders');
    expect(plan.grids.customers!.columns).toEqual(['name', 'stores__city']);
    expect(plan.grids.customers!.emptyPaths).toBeUndefined();
  });

  test('the promoted mart\'s old empty paths are dropped when its columns come from the screen, and kept when its own grid is used', () => {
    const own = { ...env({ orders: g(['id', 'customers__city']), customers: g(['name'], { emptyPaths: ['stores'] }) }, 'orders'), ownNames: () => ['city', 'name'] };
    expect(planClick(own, 'orders').grids.customers!.emptyPaths).toBeUndefined();
    const kept = planClick(env({ orders: g(['id', 'customers__city']), customers: g(['name'], { emptyPaths: ['stores'] }) }, 'orders'), 'orders');
    expect(kept.grids).toEqual({});
    const twice = planClick(env({ orders: g(['id', 'customers__city'], { emptyPaths: ['stores'] }), customers: g(['name'], { emptyPaths: ['stores'] }) }, 'orders'), 'orders');
    expect(twice.grids).toEqual({});
  });

  test('making a mart main brings only the empty marts the report had, not the ones its old grid held', () => {
    const grids = { orders: g(['id', 'customers__city']), customers: g(['name'], { emptyPaths: ['stores'] }) };
    expect(planMakeMain(env(grids, 'orders'), 'customers').grids.customers!.emptyPaths).toBeUndefined();
  });

  test('the new main keeps a filter on a field of a carried empty mart', () => {
    const eq = { field: 'stores__city', op: 'eq' as const, value: 'x' };
    const grids = { orders: g(['id', 'customers__city'], { emptyPaths: ['stores'] }), customers: g(['id', 'name'], { filters: { stores__city: eq } }) };
    const plan = planMakeMain(env(grids, 'orders'), 'customers');
    expect(plan.grids.customers!.emptyPaths).toEqual(['stores']);
    expect(plan.grids.customers!.filters).toEqual({ stores__city: eq });
  });
});

describe('the Unique Count default only where the grid can be grouped', () => {
  const sources = ordersSources.map((s) => (s.aliasPath === 'customers' ? counted(s) : s));
  const mainField = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'STRING', category, description: null, isPrimaryKey: false });
  const own = [mainField('id', 'string'), mainField('tags', 'other')];

  test('a plain grid with a column that cannot be grouped gets no Unique Count: its first metric, else a bare empty path', () => {
    const out = planAddAt(g(['id', 'tags']), sources, 'customers', undefined, null, own);
    expect(out.uniqueCount).toBeUndefined();
    expect(out.columns).toEqual(['id', 'tags']);
    expect(out.emptyPaths).toEqual(['customers']);
    const withMetric = ordersSources.map((s) => (s.aliasPath === 'products' ? counted(s) : s));
    const metric = planAddAt(g(['id', 'tags']), withMetric, 'products', undefined, null, own);
    expect(metric.uniqueCount).toBeUndefined();
    expect(metric.columns).toEqual(['id', 'tags', 'products__price']);
  });

  test('the same grid with columns that can be grouped, or fields not known, still gets it', () => {
    expect(planAddAt(g(['id']), sources, 'customers', undefined, null, own).uniqueCount).toEqual(['customers']);
    expect(planAddAt(g(['id', 'tags']), sources, 'customers').uniqueCount).toEqual(['customers']);
  });

  test('a grid that is grouped already takes the count whatever it shows', () => {
    const grouped = g(['id', 'tags'], { uniqueCount: [''], emptyPaths: [] });
    expect(planAddAt(grouped, sources, 'customers', undefined, null, own).uniqueCount).toEqual(['', 'customers']);
  });

  test('a click plans it with the main mart\'s own fields from the env', () => {
    const e = { ...env({ orders: g(['id', 'tags']) }, 'orders'), sourcesOf: () => sources, ownFields: () => own };
    expect(planClick(e, 'customers').grids.orders!.uniqueCount).toBeUndefined();
  });
});

test('a fallback metric shown earlier gets its function when a later add groups the grid', () => {
  const sources = ordersSources.map((s) => (s.aliasPath === 'customers' ? counted(s) : s));
  const out = planAddAt(g(['id', 'products__price']), sources, 'customers');
  expect(out.uniqueCount).toEqual(['customers']);
  expect(out.aggregations).toEqual([{ column: 'products__price', function: 'SUM' }]);
  // A grid that is grouped already is left as it was.
  const grouped = g(['id', 'products__price'], { uniqueCount: [''], aggregations: [{ column: 'products__price', function: 'AVG' }] });
  expect(planAddAt(grouped, sources, 'customers').aggregations).toEqual([{ column: 'products__price', function: 'AVG' }]);
});

describe('a mart added back shows its Unique Count again', () => {
  const sources = ordersSources.map((s) => (s.aliasPath === 'customers' ? counted(s) : s));
  const withShown = (e: PlanEnv, shown: Record<string, string[]>): PlanEnv => ({ ...e, sourcesOf: () => sources, lastShownOf: (id) => shown[id] ?? null, ownNames: () => [] });

  test('a mart removed with columns and its count remembers both; one removed with its count alone remembers just that', () => {
    const both = planClick(withShown(env({ orders: g(['id', 'customers__email'], { uniqueCount: ['customers'] }) }, 'orders'), {}), 'customers');
    expect(both.remember).toEqual([{ martId: 'customers', fields: ['email', UNIQUE_SHOWN] }]);
    const alone = planClick(withShown(env({ orders: g(['id'], { emptyPaths: ['customers'], uniqueCount: ['customers'] }) }, 'orders'), {}), 'customers');
    expect(alone.remember).toEqual([{ martId: 'customers', fields: [UNIQUE_SHOWN] }]);
    const plain = planClick(withShown(env({ orders: g(['id', 'customers__email']) }, 'orders'), {}), 'customers');
    expect(plain.remember).toEqual([{ martId: 'customers', fields: ['email'] }]);
  });

  test('leaving the grid remembers the count of a mart with columns and of one with none', () => {
    const grid = g(['id', 'customers__email'], { uniqueCount: ['customers', 'stores'], emptyPaths: ['stores'] });
    const withStores = ordersSources.map((s) => (s.aliasPath === 'customers' || s.aliasPath === 'stores' ? counted(s) : s));
    expect(leaveAll('orders', withStores, grid)).toEqual([{ martId: 'orders', fields: ['id'] }, { martId: 'customers', fields: ['email', UNIQUE_SHOWN] }, { martId: 'stores', fields: [UNIQUE_SHOWN] }]);
  });

  test('adding it back restores the columns it showed and the count', () => {
    const e = withShown(env({ orders: g(['id']) }, 'orders'), { customers: ['email', UNIQUE_SHOWN] });
    expect(planClick(e, 'customers').grids.orders).toMatchObject({ columns: ['id', 'customers__email'], uniqueCount: ['customers'] });
  });

  test('a count-only exit wins over an older pick or field list', () => {
    const e = withShown({ ...env({ orders: g(['id']) }, 'orders'), picksOf: () => ({ customers: ['customers__city'] }) }, { customers: [UNIQUE_SHOWN] });
    expect(planClick(e, 'customers').grids.orders).toMatchObject({ columns: ['id'], emptyPaths: ['customers'], uniqueCount: ['customers'] });
  });

  test('an old memory with no marker comes back as before, with no count', () => {
    const e = withShown(env({ orders: g(['id']) }, 'orders'), { customers: ['email'] });
    expect(planClick(e, 'customers').grids.orders!.uniqueCount).toBeUndefined();
  });
});
