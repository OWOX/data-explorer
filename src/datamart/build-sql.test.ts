import { describe, expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import { categorizeFieldType } from '../model/field-category';
import type { Edge, Field } from '../model/types';
import { buildMartSql, type MartSqlInput } from './build-sql';

const f = (name: string, type = 'STRING', joined?: Field['joined']): Field => ({ name, alias: null, type, category: type === 'INTEGER' ? 'number' : 'string', description: null, isPrimaryKey: false, ...(joined ? { joined } : {}) });
const j = (aliasPath: string, martId: string, originalName?: string): Field['joined'] => ({ martId, label: aliasPath, aliasPath, ...(originalName ? { originalName } : {}) });

const customers = (fields: Field[], extra: Partial<JoinedSource> = {}): JoinedSource => ({ aliasPath: 'customers', martId: 'customers', label: 'Customers', depth: 1, fields, uniqueCount: true, relationshipId: 'e1', mainGrainMultiplication: 'none', ...extra });
const region: JoinedSource = { aliasPath: 'customers.region', martId: 'region', label: 'Region', depth: 2, fields: [], uniqueCount: false, relationshipId: 'e2', mainGrainMultiplication: 'none' };
const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'customers', target: 'region', joins: [{ sourceField: 'region_id', targetField: 'id' }, { sourceField: 'country', targetField: 'country' }] },
];
const city = f('customers__city', 'STRING', j('customers', 'customers', 'city'));

const base = (over: Partial<MartSqlInput> = {}): MartSqlInput => ({
  dialect: 'bigquery', main: { id: 'orders', title: 'Orders' }, schema: [f('id', 'INTEGER'), f('status'), city], visible: ['id'], filters: [], sources: [customers([city])], edges, titles: new Map([['customers', 'Customers']]), ...over,
});

test('the joined count is distinct marts', () => {
  expect(buildMartSql(base())).toMatchObject({ joined: 0 });
  expect(buildMartSql(base({ visible: ['customers__city'] }))).toMatchObject({ joined: 1 });
  const rName = f('customers__region__name', 'STRING', j('customers.region', 'region', 'name'));
  expect(buildMartSql(base({ schema: [f('id'), city, rName], visible: ['customers__city', 'customers__region__name'], sources: [customers([city]), { ...region, fields: [rName] }] }))).toMatchObject({ joined: 2 });
});

test('a main-only grid reads the main mart', () => {
  expect(buildMartSql(base())).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm' });
});

test('a joined column joins its mart, and its filter sits in the outer WHERE after a LEFT JOIN', () => {
  expect(buildMartSql(base({ visible: ['id', 'customers__city'], filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }] }))).toMatchObject({
    sql: "WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  ),\n  customers_dm AS (\n    SELECT *\n    FROM [Customers](dm:customers)\n  )\nSELECT\n  base_dm.`id`,\n  customers_dm.`city` AS `customers__city`\nFROM base_dm\nLEFT JOIN customers_dm ON base_dm.`customer_id` = customers_dm.`id`\nWHERE customers_dm.`city` = 'Paris'",
    joined: 1,
  });
});

test('a nested original name is read as a path on BigQuery and one identifier elsewhere, aliased by the blended name', () => {
  const nested = f('customers__address__city', 'STRING', j('customers', 'customers', 'address.city'));
  const input = base({ schema: [f('id'), nested], visible: ['customers__address__city'], sources: [customers([nested])] });
  expect(buildMartSql(input)).toMatchObject({ sql: expect.stringContaining('customers_dm.`address`.`city` AS `customers__address__city`') });
  expect(buildMartSql({ ...input, dialect: 'snowflake' })).toMatchObject({ sql: expect.stringContaining('customers_dm."address.city" AS "customers__address__city"') });
});

test('two joined columns sharing an original name are aliased apart', () => {
  const cName = f('customers__name', 'STRING', j('customers', 'customers', 'name'));
  const pName = f('products__name', 'STRING', j('products', 'products', 'name'));
  const products: JoinedSource = { aliasPath: 'products', martId: 'products', label: 'Products', depth: 1, fields: [pName], uniqueCount: true, relationshipId: 'e3', mainGrainMultiplication: 'none' };
  const r = buildMartSql(base({ schema: [f('id'), cName, pName], visible: ['customers__name', 'products__name'], sources: [customers([cName]), products], edges: [...edges, { id: 'e3', source: 'orders', target: 'products', joins: [{ sourceField: 'product_id', targetField: 'id' }] }] }));
  expect(r).toMatchObject({ sql: expect.stringContaining('customers_dm.`name` AS `customers__name`,\n  products_dm.`name` AS `products__name`') });
});

test('a filter on a joined column that is not shown still joins and applies; an incomplete filter is skipped', () => {
  const r = buildMartSql(base({ filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }, { field: 'status', op: 'eq', value: '' }] }));
  expect(r).toMatchObject({ sql: "WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  ),\n  customers_dm AS (\n    SELECT *\n    FROM [Customers](dm:customers)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm\nLEFT JOIN customers_dm ON base_dm.`customer_id` = customers_dm.`id`\nWHERE customers_dm.`city` = 'Paris'" });
  expect(buildMartSql(base({ filters: [{ field: 'customers__city', op: 'eq', value: '' }] }))).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm' });
});

test('a nested path joins from its parent table, ancestors first, with every key pair', () => {
  const rName = f('customers__region__name', 'STRING', j('customers.region', 'region', 'name'));
  const r = buildMartSql(base({ schema: [f('id'), rName], visible: ['customers__region__name'], sources: [customers([]), { ...region, fields: [rName] }], titles: new Map([['customers', 'Customers'], ['region', 'Region']]) }));
  expect(r).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  ),\n  customers_dm AS (\n    SELECT *\n    FROM [Customers](dm:customers)\n  ),\n  customers__region_dm AS (\n    SELECT *\n    FROM [Region](dm:region)\n  )\nSELECT\n  customers__region_dm.`name` AS `customers__region__name`\nFROM base_dm\nLEFT JOIN customers_dm ON base_dm.`customer_id` = customers_dm.`id`\nLEFT JOIN customers__region_dm ON customers_dm.`region_id` = customers__region_dm.`id` AND customers_dm.`country` = customers__region_dm.`country`' });
});

test('a joined field without an original name is a reason', () => {
  const noOrig = f('customers__city', 'STRING', j('customers', 'customers'));
  expect(buildMartSql(base({ schema: [f('id'), noOrig], visible: ['customers__city'], sources: [customers([noOrig])] }))).toHaveProperty('reason');
});

test('a calculated field, shown or filtered, is a reason', () => {
  const calc = { ...f('margin', 'INTEGER'), alias: 'Margin', isCalculated: true };
  const reason = { reason: 'Calculated field "Margin" can\'t be used in a data mart. Hide it or remove its filter.' };
  expect(buildMartSql(base({ schema: [f('id'), calc], visible: ['id', 'margin'] }))).toEqual(reason);
  expect(buildMartSql(base({ schema: [f('id'), calc], visible: ['id'], filters: [{ field: 'margin', op: 'gt', value: 1 }] }))).toEqual(reason);
  expect(buildMartSql(base({ schema: [f('id'), calc], visible: ['id'], filters: [{ field: 'margin', op: 'gt', value: '' }] }))).toHaveProperty('sql');
});

test('an edge found by id is used only in the right direction', () => {
  const wrong: Edge = { id: 'e1', source: 'other', target: 'customers', joins: [{ sourceField: 'x', targetField: 'y' }] };
  const r = buildMartSql(base({ visible: ['customers__city'], edges: [wrong, { ...edges[0]!, id: 'e7' }] }));
  expect(r).toMatchObject({ sql: expect.stringContaining('ON base_dm.`customer_id` = customers_dm.`id`') });
  expect(buildMartSql(base({ visible: ['customers__city'], edges: [wrong] }))).toHaveProperty('reason');
});

test('a mart id that is not plain is a reason, and a newline in a title becomes a space', () => {
  expect(buildMartSql(base({ main: { id: 'a)b', title: 'Orders' } }))).toHaveProperty('reason');
  expect(buildMartSql(base({ visible: ['customers__city'], sources: [customers([city], { martId: 'x y' })] }))).toHaveProperty('reason');
  expect(buildMartSql(base({ main: { id: 'orders', title: 'A\nB\r\nC' } }))).toMatchObject({ sql: expect.stringContaining('FROM [A B C](dm:orders)') });
});

test('without a relationship id, the single source-target edge is used; two matches are a reason', () => {
  const sources = [customers([city], { relationshipId: undefined })];
  expect(buildMartSql(base({ visible: ['customers__city'], sources }))).toMatchObject({ sql: expect.stringContaining('ON base_dm.`customer_id` = customers_dm.`id`') });
  const dup: Edge = { id: 'e9', source: 'orders', target: 'customers', joins: [{ sourceField: 'x', targetField: 'y' }] };
  expect(buildMartSql(base({ visible: ['customers__city'], sources, edges: [...edges, dup] }))).toEqual({ reason: 'The join to "Customers" could not be resolved' });
  expect(buildMartSql(base({ visible: ['customers__city'], sources: [customers([city], { relationshipId: 'gone' })], edges: [] }))).toEqual({ reason: 'The join to "Customers" could not be resolved' });
});

test('a title is escaped as the backend reads it: backslash, brackets, line breaks', () => {
  expect(buildMartSql(base({ main: { id: 'orders', title: 'Orders [raw]' } }))).toMatchObject({ sql: expect.stringContaining('FROM [Orders \\[raw\\]](dm:orders)\n') });
  expect(buildMartSql(base({ main: { id: 'orders', title: 'C:\\' } }))).toMatchObject({ sql: expect.stringContaining('FROM [C:\\\\](dm:orders)\n') });
});

test('a nested join key is read as a path on BigQuery', () => {
  const nestedEdges: Edge[] = [{ id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'geo.country', targetField: 'meta.country' }] }];
  expect(buildMartSql(base({ visible: ['customers__city'], edges: nestedEdges }))).toMatchObject({ sql: expect.stringContaining('ON base_dm.`geo`.`country` = customers_dm.`meta`.`country`') });
});

describe('sorting', () => {
  const sortBase = (over: Partial<MartSqlInput> = {}) => base({ schema: [f('id', 'INTEGER'), f('status'), city], ...over });
  test('no ORDER BY without sorts', () => {
    expect(buildMartSql(sortBase({ sorts: [] }))).not.toMatchObject({ sql: expect.stringContaining('ORDER BY') });
    expect(buildMartSql(sortBase())).not.toMatchObject({ sql: expect.stringContaining('ORDER BY') });
  });
  test('a main sort ends the SQL', () => {
    expect(buildMartSql(sortBase({ sorts: [{ field: 'id', direction: 'asc' }] }))).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm\nORDER BY base_dm.`id` ASC' });
  });
  test('desc, several keys in order, and after WHERE', () => {
    const r = buildMartSql(sortBase({ filters: [{ field: 'status', op: 'eq', value: 'x' }], sorts: [{ field: 'status', direction: 'desc' }, { field: 'id', direction: 'asc' }] }));
    expect(r).toMatchObject({ sql: expect.stringMatching(/WHERE `status` = 'x'\n {2}\)[\s\S]*FROM base_dm\nORDER BY base_dm\.`status` DESC, base_dm\.`id` ASC$/) });
  });
  test('a joined sort uses its table and brings the join in', () => {
    const r = buildMartSql(sortBase({ visible: ['id', 'customers__city'], sorts: [{ field: 'customers__city', direction: 'desc' }] }));
    expect(r).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  ),\n  customers_dm AS (\n    SELECT *\n    FROM [Customers](dm:customers)\n  )\nSELECT\n  base_dm.`id`,\n  customers_dm.`city` AS `customers__city`\nFROM base_dm\nLEFT JOIN customers_dm ON base_dm.`customer_id` = customers_dm.`id`\nORDER BY customers_dm.`city` DESC' });
  });
  test('a sort on a joined path that nothing shown or filtered uses is a reason; a filter on it makes it usable', () => {
    const sorts = [{ field: 'customers__city', direction: 'asc' as const }];
    expect(buildMartSql(sortBase({ sorts }))).toEqual({ reason: 'Sorting by "customers__city" needs a join that no shown column or filter uses. Show a column from it or remove that sort.' });
    expect(buildMartSql(sortBase({ sorts, filters: [{ field: 'customers__city', op: 'eq', value: 'x' }] }))).toHaveProperty('sql');
  });
  test('a sort on a parent path a deeper shown column already joins is fine', () => {
    const rName = f('customers__region__name', 'STRING', j('customers.region', 'region', 'name'));
    const r = buildMartSql(sortBase({ schema: [f('id'), city, rName], visible: ['customers__region__name'], sorts: [{ field: 'customers__city', direction: 'asc' }], sources: [customers([city]), { ...region, fields: [rName] }], titles: new Map([['customers', 'Customers'], ['region', 'Region']]) }));
    expect(r).toHaveProperty('sql');
  });
  test('a sort on an unknown field is skipped; on a calculated field it is a reason', () => {
    expect(buildMartSql(sortBase({ sorts: [{ field: 'nope', direction: 'asc' }] }))).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm' });
    const calc = { ...f('margin', 'INTEGER'), alias: 'Margin', isCalculated: true };
    expect(buildMartSql(sortBase({ schema: [f('id'), calc], sorts: [{ field: 'margin', direction: 'asc' }] }))).toEqual({ reason: 'Calculated field "Margin" can\'t be used in a data mart. Hide it or remove its filter.' });
  });
});

describe('a joined filter on a pre-join aggregated field', () => {
  const agg = (sourceType: string, type: string): Field => ({ ...f('customers__spend', type, { ...j('customers', 'customers', 'spend')!, sourceType }), category: categorizeFieldType(type) });
  const run = (field: Field, flt: MartSqlInput['filters'][number]) => buildMartSql(base({ schema: [f('id'), field], visible: ['id'], filters: [flt], sources: [customers([field])] }));
  const refused = { reason: 'Filter on "customers__spend" can\'t be saved: the joined data mart aggregates this field' };
  test('is always a reason, whatever the operator', () => {
    expect(run(agg('STRING', 'INTEGER'), { field: 'customers__spend', op: 'eq', value: '5' })).toEqual(refused);
    expect(run(agg('STRING', 'INTEGER'), { field: 'customers__spend', op: 'gt', value: 5 })).toEqual(refused);
  });
  test('an equal source type changes nothing', () => {
    expect(run(agg('INTEGER', 'INTEGER'), { field: 'customers__spend', op: 'gt', value: 5 })).toMatchObject({ sql: expect.stringContaining('WHERE customers_dm.`spend` > 5') });
  });
});

test('nothing shown is a reason, and an unknown shown column is skipped', () => {
  expect(buildMartSql(base({ visible: [] }))).toEqual({ reason: 'Show at least one column' });
  expect(buildMartSql(base({ visible: ['nope'] }))).toEqual({ reason: 'Show at least one column' });
  expect(buildMartSql(base({ visible: ['nope', 'id'] }))).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`id`\nFROM base_dm' });
});

test('a non-finite number filter is incomplete, so it is skipped rather than thrown', () => {
  expect(buildMartSql(base({ schema: [f('qty', 'INTEGER')], visible: ['qty'], filters: [{ field: 'qty', op: 'gt', value: Infinity }] }))).toMatchObject({ sql: 'WITH\n  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n  )\nSELECT\n  base_dm.`qty`\nFROM base_dm' });
});

describe('Redshift', () => {
  test('each mart is a derived table, with no WITH; joined filters stay in the outer WHERE', () => {
    const r = buildMartSql(base({ dialect: 'redshift', visible: ['id', 'customers__city'], filters: [{ field: 'status', op: 'eq', value: 'paid' }, { field: 'customers__city', op: 'is_blank' }], sources: [customers([city])] }));
    expect(r).toMatchObject({ joined: 1 });
    const sql = 'sql' in r ? r.sql : '';
    expect(sql).not.toContain('WITH');
    expect(sql).toContain(`FROM (\n  SELECT *\n  FROM [Orders](dm:orders)\n  WHERE "status" = 'paid'\n) AS base_dm\nLEFT JOIN (\n  SELECT *\n  FROM [Customers](dm:customers)\n) AS customers_dm ON base_dm."customer_id" = customers_dm."id"\nWHERE `);
    expect(sql).toMatch(/\nWHERE \(*customers_dm\."city"/);
  });
});

describe('CTE layout', () => {
  const run = (over: Partial<MartSqlInput>) => { const r = buildMartSql(base(over)); return 'sql' in r ? r.sql : r.reason; };
  test('a main filter sits in the base CTE and the join stays LEFT', () => {
    const sql = run({ visible: ['id', 'customers__city'], filters: [{ field: 'status', op: 'eq', value: 'paid' }] });
    expect(sql).toContain("  base_dm AS (\n    SELECT *\n    FROM [Orders](dm:orders)\n    WHERE `status` = 'paid'\n  )");
    expect(sql).toContain('LEFT JOIN customers_dm ON');
    expect(sql).not.toContain('INNER JOIN');
  });
  test('several filters of one mart are joined by AND', () => {
    const sql = run({ filters: [{ field: 'status', op: 'eq', value: 'a' }, { field: 'id', op: 'gt', value: 1 }] });
    expect(sql).toContain("WHERE `status` = 'a' AND `id` > 1");
  });
  test('a filter-only joined mart joins LEFT, filters in the outer WHERE and adds no column', () => {
    const sql = run({ filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }] });
    expect(sql).toContain('LEFT JOIN customers_dm ON base_dm.`customer_id` = customers_dm.`id`\nWHERE customers_dm.`city` = \'Paris\'');
    expect(sql).not.toContain('INNER JOIN');
    expect(sql).toContain('SELECT\n  base_dm.`id`\nFROM base_dm');
  });
  test('null-tolerant filters on a joined field keep the LEFT JOIN and sit in the outer WHERE', () => {
    for (const flt of [{ field: 'customers__city', op: 'is_blank' as const }, { field: 'customers__city', op: 'neq' as const, value: 'Paris' }]) {
      const sql = run({ filters: [flt] });
      expect(sql).toContain('LEFT JOIN customers_dm ON');
      expect(sql).not.toContain('INNER JOIN');
      expect(sql).toMatch(/\nWHERE \(*customers_dm\./);
      expect(sql).not.toMatch(/customers_dm AS \([^)]*WHERE/);
    }
  });
  test('nested: a filter on the child sits in the outer WHERE and both joins stay LEFT', () => {
    const rName = f('customers__region__name', 'STRING', j('customers.region', 'region', 'name'));
    const sql = run({ schema: [f('id'), rName], visible: ['id'], filters: [{ field: 'customers__region__name', op: 'eq', value: 'EU' }], sources: [customers([]), { ...region, fields: [rName] }], titles: new Map([['customers', 'Customers'], ['region', 'Region']]) });
    expect(sql).toContain('LEFT JOIN customers_dm ON');
    expect(sql).toContain('LEFT JOIN customers__region_dm ON customers_dm.`region_id` = customers__region_dm.`id`');
    expect(sql).toContain("\nWHERE customers__region_dm.`name` = 'EU'");
    expect(sql).not.toContain('INNER JOIN');
  });
  test('a nested filter column is a path on BigQuery', () => {
    const nested = f('customers__address__city', 'STRING', j('customers', 'customers', 'address.city'));
    const input = { schema: [f('id'), nested], visible: ['id'], filters: [{ field: 'customers__address__city', op: 'eq' as const, value: 'x' }], sources: [customers([nested])] };
    expect(run(input)).toContain("WHERE customers_dm.`address`.`city` = 'x'");
    expect(run({ ...input, dialect: 'snowflake' })).toContain('WHERE customers_dm."address.city" = \'x\'');
  });
  test('a CTE name equal to base or another CTE gets a numeric suffix, and an unusable one falls back to jN', () => {
    const baseF = f('base__x', 'STRING', j('base', 'customers', 'x'));
    const sql = run({ schema: [f('id'), baseF], visible: ['id', 'base__x'], sources: [customers([baseF], { aliasPath: 'base' })] });
    expect(sql).toContain('  base_2_dm AS (');
    expect(sql).toContain('LEFT JOIN base_2_dm ON');
    const odd = f('weird', 'STRING', j('Cust-1', 'customers', 'x'));
    const sql2 = run({ schema: [f('id'), odd], visible: ['id', 'weird'], sources: [customers([odd], { aliasPath: 'Cust-1' })] });
    expect(sql2).toContain('  j1_dm AS (');
    expect(sql2).toContain('j1_dm.`x` AS `weird`');
  });
  test('a path that is a reserved word gets the _dm suffix', () => {
    const o = f('order__x', 'STRING', j('order', 'customers', 'x'));
    const sql = run({ schema: [f('id'), o], visible: ['id', 'order__x'], sources: [customers([o], { aliasPath: 'order' })] });
    expect(sql).toContain('  order_dm AS (');
    expect(sql).toContain('LEFT JOIN order_dm ON');
    expect(sql).toContain('order_dm.`x` AS `order__x`');
  });
  test('a sort on a joined mart orders by its CTE column', () => {
    expect(run({ visible: ['id', 'customers__city'], sorts: [{ field: 'customers__city', direction: 'asc' }] })).toMatch(/\nORDER BY customers_dm\.`city` ASC$/);
  });
});

describe('a joined mart with several rows per main row', () => {
  const run = (mult: JoinedSource['mainGrainMultiplication'] | undefined, filters: MartSqlInput['filters'], visible = ['id']) => {
    const source = customers([city]);
    if (mult) source.mainGrainMultiplication = mult; else delete source.mainGrainMultiplication;
    return buildMartSql(base({ visible, filters, sources: [source] }));
  };
  const flt: MartSqlInput['filters'] = [{ field: 'customers__city', op: 'eq', value: 'Paris' }];
  const reason = (r: ReturnType<typeof buildMartSql>) => ('reason' in r ? r.reason : null);
  test('refuses a filter on its field, naming both marts', () => {
    const msg = 'Filtering by "customers__city" can\'t be saved: Customers has several rows per Orders row, and the grid filters their combined value.';
    expect(reason(run('multiplies', flt))).toBe(msg);
    expect(reason(run('unknown', flt))).toBe(msg);
    expect(reason(run(undefined, flt))).toBe(msg);
  });
  test('allows the filter when the join keeps the grain', () => {
    expect(run('none', flt)).toMatchObject({ repeats: false, sql: expect.stringContaining("WHERE customers_dm.`city` = 'Paris'") });
  });
  test('allows a shown column and reports that rows can repeat', () => {
    expect(run('multiplies', [], ['id', 'customers__city'])).toMatchObject({ repeats: true });
    expect(run('none', [], ['id', 'customers__city'])).toMatchObject({ repeats: false });
    expect(run('multiplies', [])).toMatchObject({ repeats: false });
  });
});
