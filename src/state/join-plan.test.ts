import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { planAddAt, planRejoin, defaultJoinFields, fieldsFor, inUsePaths, isIdField, joinedMartIds, planClick, planMakeMain, sourceOfMart, withoutMart, type PlanEnv } from './join-plan';
import type { GridState } from './store';

const f = (name: string, category: Field['category'], martId: string): Field => ({ name, alias: null, type: 'STRING', category, description: null, isPrimaryKey: false, joined: { martId, label: martId, aliasPath: martId, originalName: name.slice(martId.length + 2) } });
const src = (aliasPath: string, martId: string, fields: Field[], depth = 1): JoinedSource => ({ aliasPath, martId, label: martId, depth, fields, uniqueCount: false });
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

test('a mart made main: its own columns, the old main joined with what it showed, marts it cannot reach remembered', () => {
  const grids = { customers: g(['id', 'countries__name']), orders: g(['id', 'customers__city', 'products__sku'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' } } }) };
  const plan = planMakeMain(env(grids, 'customers'), 'orders');
  expect(plan.selection).toEqual(sel('orders'));
  expect(plan.grids.orders).toEqual(g(['id', 'customers__id']));
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

  test('a field the new main\'s source does not offer is skipped; with none left the default comes back', () => {
    shown.stores = ['city', 'zip'];
    expect(planClick(withShown(env({ orders: g(['id']) }, 'orders')), 'stores').grids.orders!.columns).toEqual(['id', 'stores__city']);
    shown.stores = ['zip'];
    expect(planClick(withShown(env({ orders: g(['id']) }, 'orders')), 'stores').grids.orders!.columns).toEqual(['id', 'stores__city']);
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
    const base: PlanEnv = { selection: sel('customers'), sourceKeyFor: () => null, sourcesOf: (id) => sources[id] ?? [], gridOf: (id) => ({ customers: g(['id', 'stores__zip']), orders: g(['id', 'stores__city']) }[id] ?? g(['id'])), ownColumns: () => ['id'], picksOf: () => ({}) };
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
    expect(planClick(e, 'stores').grids.orders!.columns).toContain('customers__stores__city');
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
const js = (path: string, owns = ['name', 'n']): JoinedSource => ({ aliasPath: path, martId: path.split('.').at(-1)!, label: path, depth: path.split('.').length, fields: owns.map((o) => jf(path, o)), uniqueCount: true });
const jc = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;
const rjSources = [js('a'), js('b'), js('a.c', ['name', 'n', 'only_a']), js('b.c')];
const base: GridState = { columns: ['id', jc('a'), jc('b'), jc('a.c'), jc('a.c', 'n'), jc('a.c', 'only_a')], filters: { [jc('a.c')]: { field: jc('a.c'), op: 'eq', value: 'x' }, [jc('a.c', 'only_a')]: { field: jc('a.c', 'only_a'), op: 'eq', value: 'y' } }, sorts: [{ field: jc('a.c', 'n'), direction: 'desc' }], limit: 100, aggregations: [{ column: jc('a.c', 'n'), function: 'SUM' }] };

test('planAddAt adds the mart through that exact path, with its default fields', () => {
  const out = planAddAt({ ...base, columns: ['id', jc('b')], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c', ['id']);
  // Both fields are text, so the default is the first text field alone.
  expect(out.columns).toContain(jc('b.c'));
  expect(out.columns).not.toContain(jc('b.c', 'n'));
  expect(out.columns.filter((c) => c.startsWith('a__c'))).toEqual([]);
});

test('planAddAt keeps remembered fields offered by the path', () => {
  const out = planAddAt({ ...base, columns: ['id'], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c', ['id'], [jc('b.c', 'n')]);
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
