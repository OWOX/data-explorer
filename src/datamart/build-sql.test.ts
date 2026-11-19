import { describe, expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import { categorizeFieldType } from '../model/field-category';
import type { Edge, Field } from '../model/types';
import { buildMartSql, type MartSqlInput } from './build-sql';

const f = (name: string, type = 'STRING', joined?: Field['joined']): Field => ({ name, alias: null, type, category: type === 'INTEGER' ? 'number' : 'string', description: null, isPrimaryKey: false, ...(joined ? { joined } : {}) });
const j = (aliasPath: string, martId: string, originalName?: string): Field['joined'] => ({ martId, label: aliasPath, aliasPath, ...(originalName ? { originalName } : {}) });

const customers = (fields: Field[], extra: Partial<JoinedSource> = {}): JoinedSource => ({ aliasPath: 'customers', martId: 'customers', label: 'Customers', depth: 1, fields, uniqueCount: true, relationshipId: 'e1', ...extra });
const region: JoinedSource = { aliasPath: 'customers.region', martId: 'region', label: 'Region', depth: 2, fields: [], uniqueCount: false, relationshipId: 'e2' };
const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'customers', target: 'region', joins: [{ sourceField: 'region_id', targetField: 'id' }, { sourceField: 'country', targetField: 'country' }] },
];
const city = f('customers__city', 'STRING', j('customers', 'customers', 'city'));

const base = (over: Partial<MartSqlInput> = {}): MartSqlInput => ({
  dialect: 'bigquery', main: { id: 'orders', title: 'Orders' }, schema: [f('id', 'INTEGER'), f('status'), city], visible: ['id'], filters: [], sources: [customers([city])], edges, titles: new Map([['customers', 'Customers']]), ...over,
});

test('a main-only grid reads the main mart', () => {
  expect(buildMartSql(base())).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0' });
});

test('a joined column joins its mart, and a filter goes to WHERE', () => {
  expect(buildMartSql(base({ visible: ['id', 'customers__city'], filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }] }))).toEqual({
    sql: "SELECT\n  t0.`id`,\n  t1.`city` AS `customers__city`\nFROM [Orders](dm:orders) AS t0\nLEFT JOIN [Customers](dm:customers) AS t1 ON t0.`customer_id` = t1.`id`\nWHERE t1.`city` = 'Paris'",
  });
});

test('a nested original name is read as a path on BigQuery and one identifier elsewhere, aliased by the blended name', () => {
  const nested = f('customers__address__city', 'STRING', j('customers', 'customers', 'address.city'));
  const input = base({ schema: [f('id'), nested], visible: ['customers__address__city'], sources: [customers([nested])] });
  expect(buildMartSql(input)).toMatchObject({ sql: expect.stringContaining('t1.`address`.`city` AS `customers__address__city`') });
  expect(buildMartSql({ ...input, dialect: 'snowflake' })).toMatchObject({ sql: expect.stringContaining('t1."address.city" AS "customers__address__city"') });
});

test('two joined columns sharing an original name are aliased apart', () => {
  const cName = f('customers__name', 'STRING', j('customers', 'customers', 'name'));
  const pName = f('products__name', 'STRING', j('products', 'products', 'name'));
  const products: JoinedSource = { aliasPath: 'products', martId: 'products', label: 'Products', depth: 1, fields: [pName], uniqueCount: true, relationshipId: 'e3' };
  const r = buildMartSql(base({ schema: [f('id'), cName, pName], visible: ['customers__name', 'products__name'], sources: [customers([cName]), products], edges: [...edges, { id: 'e3', source: 'orders', target: 'products', joins: [{ sourceField: 'product_id', targetField: 'id' }] }] }));
  expect(r).toMatchObject({ sql: expect.stringContaining('t1.`name` AS `customers__name`,\n  t2.`name` AS `products__name`') });
});

test('a filter on a joined column that is not shown still joins and applies; an incomplete filter is skipped', () => {
  const r = buildMartSql(base({ filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }, { field: 'status', op: 'eq', value: '' }] }));
  expect(r).toEqual({ sql: "SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0\nLEFT JOIN [Customers](dm:customers) AS t1 ON t0.`customer_id` = t1.`id`\nWHERE t1.`city` = 'Paris'" });
  expect(buildMartSql(base({ filters: [{ field: 'customers__city', op: 'eq', value: '' }] }))).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0' });
});

test('a nested path joins from its parent table, ancestors first, with every key pair', () => {
  const rName = f('customers__region__name', 'STRING', j('customers.region', 'region', 'name'));
  const r = buildMartSql(base({ schema: [f('id'), rName], visible: ['customers__region__name'], sources: [customers([]), { ...region, fields: [rName] }], titles: new Map([['customers', 'Customers'], ['region', 'Region']]) }));
  expect(r).toEqual({ sql: 'SELECT\n  t2.`name` AS `customers__region__name`\nFROM [Orders](dm:orders) AS t0\nLEFT JOIN [Customers](dm:customers) AS t1 ON t0.`customer_id` = t1.`id`\nLEFT JOIN [Region](dm:region) AS t2 ON t1.`region_id` = t2.`id` AND t1.`country` = t2.`country`' });
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
  expect(r).toMatchObject({ sql: expect.stringContaining('ON t0.`customer_id` = t1.`id`') });
  expect(buildMartSql(base({ visible: ['customers__city'], edges: [wrong] }))).toHaveProperty('reason');
});

test('a mart id that is not plain is a reason, and a newline in a title becomes a space', () => {
  expect(buildMartSql(base({ main: { id: 'a)b', title: 'Orders' } }))).toHaveProperty('reason');
  expect(buildMartSql(base({ visible: ['customers__city'], sources: [customers([city], { martId: 'x y' })] }))).toHaveProperty('reason');
  expect(buildMartSql(base({ main: { id: 'orders', title: 'A\nB\r\nC' } }))).toMatchObject({ sql: expect.stringContaining('FROM [A B C](dm:orders)') });
});

test('without a relationship id, the single source-target edge is used; two matches are a reason', () => {
  const sources = [customers([city], { relationshipId: undefined })];
  expect(buildMartSql(base({ visible: ['customers__city'], sources }))).toMatchObject({ sql: expect.stringContaining('ON t0.`customer_id` = t1.`id`') });
  const dup: Edge = { id: 'e9', source: 'orders', target: 'customers', joins: [{ sourceField: 'x', targetField: 'y' }] };
  expect(buildMartSql(base({ visible: ['customers__city'], sources, edges: [...edges, dup] }))).toEqual({ reason: 'The join to "Customers" could not be resolved' });
  expect(buildMartSql(base({ visible: ['customers__city'], sources: [customers([city], { relationshipId: 'gone' })], edges: [] }))).toEqual({ reason: 'The join to "Customers" could not be resolved' });
});

test('a title is escaped as the backend reads it: backslash, brackets, line breaks', () => {
  expect(buildMartSql(base({ main: { id: 'orders', title: 'Orders [raw]' } }))).toMatchObject({ sql: expect.stringContaining('FROM [Orders \\[raw\\]](dm:orders) AS t0') });
  expect(buildMartSql(base({ main: { id: 'orders', title: 'C:\\' } }))).toMatchObject({ sql: expect.stringContaining('FROM [C:\\\\](dm:orders) AS t0') });
});

test('a nested join key is read as a path on BigQuery', () => {
  const nestedEdges: Edge[] = [{ id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'geo.country', targetField: 'meta.country' }] }];
  expect(buildMartSql(base({ visible: ['customers__city'], edges: nestedEdges }))).toMatchObject({ sql: expect.stringContaining('ON t0.`geo`.`country` = t1.`meta`.`country`') });
});

describe('sorting', () => {
  const sortBase = (over: Partial<MartSqlInput> = {}) => base({ schema: [f('id', 'INTEGER'), f('status'), city], ...over });
  test('no ORDER BY without sorts', () => {
    expect(buildMartSql(sortBase({ sorts: [] }))).not.toMatchObject({ sql: expect.stringContaining('ORDER BY') });
    expect(buildMartSql(sortBase())).not.toMatchObject({ sql: expect.stringContaining('ORDER BY') });
  });
  test('a main sort ends the SQL', () => {
    expect(buildMartSql(sortBase({ sorts: [{ field: 'id', direction: 'asc' }] }))).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0\nORDER BY t0.`id` ASC' });
  });
  test('desc, several keys in order, and after WHERE', () => {
    const r = buildMartSql(sortBase({ filters: [{ field: 'status', op: 'eq', value: 'x' }], sorts: [{ field: 'status', direction: 'desc' }, { field: 'id', direction: 'asc' }] }));
    expect(r).toMatchObject({ sql: expect.stringMatching(/WHERE t0\.`status` = 'x'\nORDER BY t0\.`status` DESC, t0\.`id` ASC$/) });
  });
  test('a joined sort uses its table and brings the join in', () => {
    const r = buildMartSql(sortBase({ sorts: [{ field: 'customers__city', direction: 'desc' }] }));
    expect(r).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0\nLEFT JOIN [Customers](dm:customers) AS t1 ON t0.`customer_id` = t1.`id`\nORDER BY t1.`city` DESC' });
  });
  test('a sort on an unknown field is skipped; on a calculated field it is a reason', () => {
    expect(buildMartSql(sortBase({ sorts: [{ field: 'nope', direction: 'asc' }] }))).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0' });
    const calc = { ...f('margin', 'INTEGER'), alias: 'Margin', isCalculated: true };
    expect(buildMartSql(sortBase({ schema: [f('id'), calc], sorts: [{ field: 'margin', direction: 'asc' }] }))).toEqual({ reason: 'Calculated field "Margin" can\'t be used in a data mart. Hide it or remove its filter.' });
  });
});

describe('a joined filter on a pre-join aggregated field', () => {
  const agg = (sourceType: string, type: string): Field => ({ ...f('customers__spend', type, { ...j('customers', 'customers', 'spend')!, sourceType }), category: categorizeFieldType(type) });
  const run = (field: Field, flt: MartSqlInput['filters'][number]) => buildMartSql(base({ schema: [f('id'), field], visible: ['id'], filters: [flt], sources: [customers([field])] }));
  test('renders against the raw column type', () => {
    expect(run(agg('STRING', 'INTEGER'), { field: 'customers__spend', op: 'eq', value: '5' })).toMatchObject({ sql: expect.stringContaining("WHERE t1.`spend` = '5'") });
  });
  test('an operator the raw type lacks is a reason', () => {
    expect(run(agg('STRING', 'INTEGER'), { field: 'customers__spend', op: 'gt', value: 5 })).toEqual({ reason: 'Filter on "customers__spend" can\'t be saved: the joined data mart aggregates this field' });
  });
  test('an equal source type changes nothing', () => {
    expect(run(agg('INTEGER', 'INTEGER'), { field: 'customers__spend', op: 'gt', value: 5 })).toMatchObject({ sql: expect.stringContaining('WHERE t1.`spend` > 5') });
  });
});

test('nothing shown is a reason, and an unknown shown column is skipped', () => {
  expect(buildMartSql(base({ visible: [] }))).toEqual({ reason: 'Show at least one column' });
  expect(buildMartSql(base({ visible: ['nope'] }))).toEqual({ reason: 'Show at least one column' });
  expect(buildMartSql(base({ visible: ['nope', 'id'] }))).toEqual({ sql: 'SELECT\n  t0.`id`\nFROM [Orders](dm:orders) AS t0' });
});

test('a non-finite number filter is incomplete, so it is skipped rather than thrown', () => {
  expect(buildMartSql(base({ schema: [f('qty', 'INTEGER')], visible: ['qty'], filters: [{ field: 'qty', op: 'gt', value: Infinity }] }))).toEqual({ sql: 'SELECT\n  t0.`qty`\nFROM [Orders](dm:orders) AS t0' });
});
