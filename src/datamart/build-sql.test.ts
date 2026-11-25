import { describe, expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import { categorizeFieldType } from '../model/field-category';
import type { Edge, Field } from '../model/types';
import { buildMartSql, type MartSqlInput } from './build-sql';
import type { DateBucket } from '../model/aggregation';
import type { Dialect } from './dialect';

const f = (name: string, type = 'STRING', joined?: Field['joined']): Field => ({ name, alias: null, type, category: categorizeFieldType(type), description: null, isPrimaryKey: false, ...(joined ? { joined } : {}) });
const j = (aliasPath: string, martId: string, originalName?: string, aggregateFunction: string | undefined = 'STRING_AGG', sourceType?: string): Field['joined'] => ({ martId, label: aliasPath, aliasPath, ...(originalName ? { originalName } : {}), ...(aggregateFunction ? { aggregateFunction } : {}), ...(sourceType ? { sourceType } : {}) });

const customers = (fields: Field[], extra: Partial<JoinedSource> = {}): JoinedSource => ({ aliasPath: 'customers', martId: 'cus1', label: 'Customers', depth: 1, fields, uniqueCount: true, relationshipId: 'e1', ...extra });
const items = (fields: Field[]): JoinedSource => ({ aliasPath: 'order_items', martId: 'itm1', label: 'Order Items', depth: 1, fields, uniqueCount: true, relationshipId: 'e3' });
const region = (fields: Field[] = []): JoinedSource => ({ aliasPath: 'customers.region', martId: 'reg1', label: 'Region', depth: 2, fields, uniqueCount: false, relationshipId: 'e2' });
const edges: Edge[] = [
  { id: 'e1', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'cus1', target: 'reg1', joins: [{ sourceField: 'region_id', targetField: 'id' }, { sourceField: 'country', targetField: 'country' }] },
  { id: 'e3', source: 'ord1', target: 'itm1', joins: [{ sourceField: 'id', targetField: 'order_id' }] },
];
const titles = new Map([['ord1', 'Orders'], ['cus1', 'Customers'], ['itm1', 'Order Items'], ['reg1', 'Region']]);

const city = f('customers__city', 'STRING', j('customers', 'cus1', 'city'));
const sku = f('order_items__sku', 'STRING', j('order_items', 'itm1', 'sku'));
const regionName = f('customers__region__name', 'STRING', j('customers.region', 'reg1', 'name'));

const base = (over: Partial<MartSqlInput> = {}): MartSqlInput => ({
  dialect: 'bigquery', main: { id: 'ord1', title: 'Orders' }, schema: [f('id', 'INTEGER'), f('status'), f('customer_id', 'INTEGER'), city, sku, regionName],
  visible: ['id'], filters: [], sources: [customers([city]), items([sku]), region([regionName])], edges, titles, ...over,
});
const run = (over: Partial<MartSqlInput> = {}) => { const r = buildMartSql(base(over)); return 'sql' in r ? r.sql : `REASON ${r.reason}`; };

const BASE = '  base_owox AS (\n    SELECT *\n    FROM [Orders](dm:ord1)\n  )';

test('a main-only grid reads the main mart', () => {
  expect(run()).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.id\nFROM base_owox`);
});

test('a main filter goes in the outer WHERE, with no join', () => {
  expect(run({ filters: [{ field: 'status', op: 'eq', value: 'paid' }] })).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.id\nFROM base_owox\nWHERE base_owox.status = 'paid'`);
});

const CUS_BQ = "  customers_owox AS (\n    SELECT\n      t.id,\n      STRING_AGG(CAST(t.city AS STRING), ', ' ORDER BY CAST(t.city AS STRING)) AS customers__city\n    FROM [Customers](dm:cus1) AS t\n    GROUP BY t.id\n  )";
const ITM_BQ = "  order_items_owox AS (\n    SELECT\n      t.order_id,\n      STRING_AGG(CAST(t.sku AS STRING), ', ' ORDER BY CAST(t.sku AS STRING)) AS order_items__sku\n    FROM [Order Items](dm:itm1) AS t\n    GROUP BY t.order_id\n  )";

test('a many-to-one shown field is rolled up by its join key and LEFT JOINed', () => {
  expect(run({ visible: ['id', 'customers__city'] })).toBe(`WITH\n${BASE},\n${CUS_BQ}\nSELECT\n  base_owox.id,\n  customers_owox.customers__city\nFROM base_owox\nLEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id`);
});

const filters51: MartSqlInput['filters'] = [{ field: 'customers__city', op: 'eq', value: 'Paris' }, { field: 'order_items__sku', op: 'is_blank' }];

test('section 5.1 in full, BigQuery', () => {
  expect(run({ visible: ['id', 'status', 'customers__city', 'order_items__sku'], filters: filters51 })).toBe(
    `WITH\n${BASE},\n${CUS_BQ},\n${ITM_BQ}\nSELECT\n  base_owox.id,\n  base_owox.status,\n  customers_owox.customers__city,\n  order_items_owox.order_items__sku\nFROM base_owox\nLEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id\nLEFT JOIN order_items_owox ON base_owox.id = order_items_owox.order_id\nWHERE customers_owox.customers__city = 'Paris'\n  AND (order_items_owox.order_items__sku IS NULL OR TRIM(order_items_owox.order_items__sku) = '')`,
  );
});

test('section 5.2 in full, Snowflake', () => {
  expect(run({ dialect: 'snowflake', visible: ['id', 'status', 'customers__city', 'order_items__sku'], filters: filters51 })).toBe([
    'WITH',
    '  base_owox AS (',
    '    SELECT *',
    '    FROM [Orders](dm:ord1)',
    '  ),',
    '  customers_owox AS (',
    '    SELECT',
    '      t."id",',
    `      LISTAGG(CAST(t."city" AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t."city") AS "customers__city"`,
    '    FROM [Customers](dm:cus1) AS t',
    '    GROUP BY t."id"',
    '  ),',
    '  order_items_owox AS (',
    '    SELECT',
    '      t."order_id",',
    `      LISTAGG(CAST(t."sku" AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t."sku") AS "order_items__sku"`,
    '    FROM [Order Items](dm:itm1) AS t',
    '    GROUP BY t."order_id"',
    '  )',
    'SELECT',
    '  base_owox."id",',
    '  base_owox."status",',
    '  customers_owox."customers__city",',
    '  order_items_owox."order_items__sku"',
    'FROM base_owox',
    'LEFT JOIN customers_owox ON base_owox."customer_id" = customers_owox."id"',
    'LEFT JOIN order_items_owox ON base_owox."id" = order_items_owox."order_id"',
    `WHERE customers_owox."customers__city" = 'Paris'`,
    `  AND (order_items_owox."order_items__sku" IS NULL OR TRIM(order_items_owox."order_items__sku", ' \\t\\n\\r') = '')`,
  ].join('\n'));
});

describe('null-matching operators on a joined field stay in the outer WHERE', () => {
  const cases: [string, MartSqlInput['filters'][number], string][] = [
    ['is_blank', { field: 'customers__city', op: 'is_blank' }, "(customers_owox.customers__city IS NULL OR TRIM(customers_owox.customers__city) = '')"],
    ['neq', { field: 'customers__city', op: 'neq', value: 'Paris' }, "(customers_owox.customers__city IS NULL OR customers_owox.customers__city <> 'Paris')"],
    ['not_contains', { field: 'customers__city', op: 'not_contains', value: 'ar' }, "(customers_owox.customers__city IS NULL OR STRPOS(customers_owox.customers__city, 'ar') = 0)"],
  ];
  for (const [name, flt, predicate] of cases) {
    test(name, () => {
      const sql = run({ filters: [flt] });
      expect(sql).toContain(`\nWHERE ${predicate}`);
      expect(sql).not.toContain('INNER');
      expect(sql).not.toMatch(/AS t\n\s+WHERE/);
    });
  }
});

test('a filter-only joined field is rolled up and joined, but not selected', () => {
  const sql = run({ filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }] });
  expect(sql).toContain(CUS_BQ);
  expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
  expect(sql).toContain("WHERE customers_owox.customers__city = 'Paris'");
  expect(sql).toContain('SELECT\n  base_owox.id\nFROM base_owox');
});

describe('depth 2', () => {
  const REGION = "  customers__region_owox AS (\n    SELECT\n      t.id,\n      t.country,\n      STRING_AGG(CAST(t.name AS STRING), ', ' ORDER BY CAST(t.name AS STRING)) AS customers__region__name\n    FROM [Region](dm:reg1) AS t\n    GROUP BY t.id, t.country\n  )";
  const PARENT = "  customers_owox AS (\n    SELECT\n      t.id,\n      STRING_AGG(CAST(t.city AS STRING), ', ' ORDER BY CAST(t.city AS STRING)) AS customers__city,\n      STRING_AGG(CAST(customers__region_owox.customers__region__name AS STRING), ', ' ORDER BY CAST(customers__region_owox.customers__region__name AS STRING)) AS customers__region__name\n    FROM [Customers](dm:cus1) AS t\n    LEFT JOIN customers__region_owox ON t.region_id = customers__region_owox.id AND t.country = customers__region_owox.country\n    GROUP BY t.id\n  )";
  test('the child CTE comes first, the parent re-aggregates it, and only the root joins in the outer query', () => {
    expect(run({ visible: ['customers__city', 'customers__region__name'], filters: [{ field: 'customers__region__name', op: 'eq', value: 'EU' }] })).toBe(
      `WITH\n${BASE},\n${REGION},\n${PARENT}\nSELECT\n  customers_owox.customers__city,\n  customers_owox.customers__region__name\nFROM base_owox\nLEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id\nWHERE customers_owox.customers__region__name = 'EU'`,
    );
  });
  test('a depth-2 field alone still brings its parent', () => {
    const sql = run({ visible: ['customers__region__name'] });
    expect(sql).toContain(REGION);
    expect(sql).toContain('FROM [Customers](dm:cus1) AS t\n    LEFT JOIN customers__region_owox');
    expect(sql).not.toContain('LEFT JOIN customers__region_owox ON base_owox');
  });
});

describe('depth 3 re-aggregation', () => {
  const l1 = f('a__n', 'INTEGER', j('a', 'a1', 'n', 'COUNT'));
  const l3 = f('a__b__c__n', 'INTEGER', j('a.b.c', 'c1', 'n', 'COUNT'));
  const flag = f('a__b__c__flag', 'BOOLEAN', j('a.b.c', 'c1', 'flag', 'ANY_VALUE'));
  const src = (aliasPath: string, martId: string, fields: Field[], depth: number): JoinedSource => ({ aliasPath, martId, label: martId, depth, fields, uniqueCount: false, relationshipId: `r_${martId}` });
  const chain: Edge[] = [
    { id: 'r_a1', source: 'ord1', target: 'a1', joins: [{ sourceField: 'k', targetField: 'k' }] },
    { id: 'r_b1', source: 'a1', target: 'b1', joins: [{ sourceField: 'k', targetField: 'k' }] },
    { id: 'r_c1', source: 'b1', target: 'c1', joins: [{ sourceField: 'k', targetField: 'k' }] },
  ];
  const input = (visible: string[]) => base({ schema: [f('id'), l1, l3, flag], visible, edges: chain, sources: [src('a', 'a1', [l1], 1), src('a.b', 'b1', [], 2), src('a.b.c', 'c1', [l3, flag], 3)], titles: new Map() });
  test('COUNT becomes COUNT, then SUM, then SUM; ANY_VALUE on BOOLEAN becomes ANY_VALUE, then MAX, then MAX', () => {
    const r = buildMartSql(input(['a__b__c__n', 'a__b__c__flag']));
    const sql = 'sql' in r ? r.sql : r.reason;
    expect(sql).toContain('COUNT(t.n) AS a__b__c__n');
    expect(sql).toContain('ANY_VALUE(t.flag) AS a__b__c__flag');
    expect(sql).toContain('SUM(a__b__c_owox.a__b__c__n) AS a__b__c__n');
    expect(sql).toContain('MAX(a__b__c_owox.a__b__c__flag) AS a__b__c__flag');
    expect(sql).toContain('SUM(a__b_owox.a__b__c__n) AS a__b__c__n');
    expect(sql).toContain('MAX(a__b_owox.a__b__c__flag) AS a__b__c__flag');
    expect(sql).toContain('SELECT\n  a_owox.a__b__c__n,\n  a_owox.a__b__c__flag\nFROM base_owox\nLEFT JOIN a_owox');
  });
});

describe('join-level functions at the leaf', () => {
  const leaf = (fn: string, type = 'INTEGER', sourceType?: string, d: Dialect = 'bigquery') => {
    const x = f('customers__x', type, j('customers', 'cus1', 'x', fn, sourceType));
    return run({ dialect: d, schema: [f('id'), x], visible: ['customers__x'], sources: [customers([x])] });
  };
  test.each([['SUM', 'SUM(t.x)'], ['MIN', 'MIN(t.x)'], ['MAX', 'MAX(t.x)'], ['AVG', 'AVG(t.x)'], ['COUNT', 'COUNT(t.x)'], ['COUNT_DISTINCT', 'COUNT(DISTINCT t.x)']])('%s', (fn, expected) => {
    expect(leaf(fn)).toContain(`${expected} AS customers__x`);
  });
  test('ANY_VALUE becomes MAX on string, date and integer source types', () => {
    for (const t of ['STRING', 'DATE', 'INTEGER']) expect(leaf('ANY_VALUE', t)).toContain('MAX(t.x) AS customers__x');
  });
  test('ANY_VALUE stays on BOOLEAN, and is arbitrary on Athena', () => {
    expect(leaf('ANY_VALUE', 'BOOLEAN')).toContain('ANY_VALUE(t.x) AS customers__x');
    expect(leaf('ANY_VALUE', 'BOOLEAN', undefined, 'athena')).toContain('arbitrary(t.x) AS customers__x');
  });
  test('the roll-up reads the source type when there is one', () => {
    expect(leaf('ANY_VALUE', 'STRING', 'BOOLEAN')).toContain('ANY_VALUE(t.x)');
    expect(leaf('ANY_VALUE', 'BOOLEAN', 'STRING')).toContain('MAX(t.x)');
  });
});

describe('STRING_AGG per dialect', () => {
  const agg = (d: Dialect) => run({ dialect: d, visible: ['customers__city'] });
  test.each([
    ['bigquery', "STRING_AGG(CAST(t.city AS STRING), ', ' ORDER BY CAST(t.city AS STRING)) AS customers__city"],
    ['athena', "ARRAY_JOIN(ARRAY_AGG(CAST(t.city AS VARCHAR) ORDER BY CAST(t.city AS VARCHAR)), ', ') AS customers__city"],
    ['snowflake', `LISTAGG(CAST(t."city" AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t."city") AS "customers__city"`],
    ['redshift', "LISTAGG(CAST(t.city AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t.city) AS customers__city"],
    ['databricks', "CONCAT_WS(', ', SORT_ARRAY(COLLECT_LIST(CAST(t.city AS STRING)))) AS customers__city"],
  ] as const)('%s', (d, expected) => {
    expect(agg(d)).toContain(expected);
  });
});

describe('identifiers', () => {
  const spaced = f('customers__city', 'STRING', j('customers', 'cus1', 'my city'));
  const nested = f('customers__city', 'STRING', j('customers', 'cus1', 'address.city'));
  const sql = (x: Field, d: Dialect) => run({ dialect: d, schema: [f('id'), x], visible: ['customers__city'], sources: [customers([x])] });
  test('a simple name is bare, a name with a space is quoted, per dialect', () => {
    expect(sql(spaced, 'bigquery')).toContain('CAST(t.`my city` AS STRING)');
    expect(sql(spaced, 'databricks')).toContain('CAST(t.`my city` AS STRING)');
    expect(sql(spaced, 'athena')).toContain('CAST(t."my city" AS VARCHAR)');
    expect(sql(spaced, 'redshift')).toContain('CAST(t."my city" AS VARCHAR)');
    expect(sql(spaced, 'snowflake')).toContain('CAST(t."my city" AS VARCHAR)');
  });
  test('Snowflake always quotes', () => {
    expect(sql(f('customers__city', 'STRING', j('customers', 'cus1', 'city')), 'snowflake')).toContain('t."city"');
  });
  test('a dotted original name is split into segments', () => {
    expect(sql(nested, 'bigquery')).toContain('CAST(t.address.city AS STRING)');
    expect(sql(nested, 'snowflake')).toContain('CAST(t."address"."city" AS VARCHAR)');
  });
  test('a quote character inside a name is doubled', () => {
    expect(sql(f('customers__city', 'STRING', j('customers', 'cus1', 'a`b')), 'bigquery')).toContain('t.`a``b`');
    expect(sql(f('customers__city', 'STRING', j('customers', 'cus1', 'a"b')), 'snowflake')).toContain('t."a""b"');
  });
});

describe('filters read the effective type', () => {
  test('a joined DATE rolled up with MAX is cast to DATE on BigQuery', () => {
    const d = f('customers__signup', 'DATE', j('customers', 'cus1', 'signup', 'MAX', 'DATE'));
    expect(run({ schema: [f('id'), d], filters: [{ field: 'customers__signup', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } }], sources: [customers([d])] })).toContain("WHERE customers_owox.customers__signup BETWEEN CAST('2026-01-01' AS DATE) AND CAST('2026-01-31' AS DATE)");
  });
  test('a STRING counted is an INTEGER and compares as a number', () => {
    const n = f('customers__n', 'INTEGER', j('customers', 'cus1', 'n', 'COUNT', 'STRING'));
    const sql = run({ schema: [f('id'), n], filters: [{ field: 'customers__n', op: 'gt', value: 3 }], sources: [customers([n])] });
    expect(sql).toContain('WHERE customers_owox.customers__n > 3');
    expect(sql).toContain('COUNT(t.n) AS customers__n');
  });
});

describe('blank form follows the engine string set', () => {
  const blank = (type: string) => {
    const x = f('customers__x', type, j('customers', 'cus1', 'x', 'MAX'));
    return run({ schema: [f('id'), x], filters: [{ field: 'customers__x', op: 'is_blank' }], sources: [customers([x])] });
  };
  test('STRING gets the TRIM form', () => expect(blank('STRING')).toContain("(customers_owox.customers__x IS NULL OR TRIM(customers_owox.customers__x) = '')"));
  test('CITEXT gets IS NULL only', () => expect(blank('CITEXT')).toContain('WHERE customers_owox.customers__x IS NULL'));
});

describe('relative dates on a joined MAX TIMESTAMP', () => {
  const ts = f('customers__seen', 'TIMESTAMP', j('customers', 'cus1', 'seen', 'MAX', 'TIMESTAMP'));
  const rel = (d: Dialect) => run({ dialect: d, schema: [f('id'), ts], filters: [{ field: 'customers__seen', op: 'relative', value: { kind: 'last_n_days', n: 7 } }], sources: [customers([ts])] });
  test('BigQuery wraps in DATE()', () => expect(rel('bigquery')).toContain('WHERE DATE(customers_owox.customers__seen) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE(customers_owox.customers__seen) <= CURRENT_DATE()'));
  test('Snowflake uses DATEADD', () => expect(rel('snowflake')).toContain('WHERE customers_owox."customers__seen" >= DATEADD(day, -7, CURRENT_DATE) AND customers_owox."customers__seen" < DATEADD(day, 1, CURRENT_DATE)'));
});

describe('sorting', () => {
  test('no ORDER BY without sorts', () => {
    expect(run({ sorts: [] })).not.toContain('ORDER BY');
    expect(run()).not.toContain('ORDER BY');
  });
  test('a main sort ends the SQL', () => {
    expect(run({ sorts: [{ field: 'id', direction: 'asc' }] })).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.id\nFROM base_owox\nORDER BY base_owox.id ASC`);
  });
  test('several keys keep their order and come after the WHERE', () => {
    expect(run({ filters: [{ field: 'status', op: 'eq', value: 'x' }], sorts: [{ field: 'status', direction: 'desc' }, { field: 'id', direction: 'asc' }] })).toMatch(/\nWHERE base_owox\.status = 'x'\nORDER BY base_owox\.status DESC, base_owox\.id ASC$/);
  });
  test('a sort on a joined field that is not shown brings its join in', () => {
    const sql = run({ sorts: [{ field: 'customers__city', direction: 'desc' }] });
    expect(sql).toContain(CUS_BQ);
    expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
    expect(sql).toMatch(/\nORDER BY customers_owox\.customers__city DESC$/);
  });
  test('a filter on a joined field of a mart kept with no column joins it and filters', () => {
    const sql = run({ filters: [{ field: 'customers__city', op: 'eq', value: 'Kyiv' }] });
    expect(sql).toContain(CUS_BQ);
    expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
    expect(sql).toContain("WHERE customers_owox.customers__city = 'Kyiv'");
    expect(sql).toContain('SELECT\n  base_owox.id\nFROM');
  });
  test('a sort on an unknown field is skipped', () => {
    expect(run({ sorts: [{ field: 'nope', direction: 'asc' }] })).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.id\nFROM base_owox`);
  });
});

describe('reasons', () => {
  const calc = { ...f('margin', 'INTEGER'), alias: 'Margin', isCalculated: true };
  const calcReason = 'REASON Calculated field "Margin" can\'t be used in a data mart. Hide it or remove its filter.';
  test('nothing shown, and an unknown shown column', () => {
    expect(run({ visible: [] })).toBe('REASON Show at least one column');
    expect(run({ visible: ['nope'] })).toBe('REASON Show at least one column');
    expect(run({ visible: ['nope', 'id'] })).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.id\nFROM base_owox`);
  });
  test('a calculated field shown, filtered or sorted', () => {
    expect(run({ schema: [f('id'), calc], visible: ['id', 'margin'] })).toBe(calcReason);
    expect(run({ schema: [f('id'), calc], filters: [{ field: 'margin', op: 'gt', value: 1 }] })).toBe(calcReason);
    expect(run({ schema: [f('id'), calc], sorts: [{ field: 'margin', direction: 'asc' }] })).toBe(calcReason);
    expect(run({ schema: [f('id'), calc], filters: [{ field: 'margin', op: 'gt', value: '' }] })).toContain('SELECT');
  });
  test('a joined field without an original name', () => {
    const x = f('customers__city', 'STRING', j('customers', 'cus1'));
    expect(run({ schema: [f('id'), x], visible: ['customers__city'], sources: [customers([x])] })).toBe('REASON The column "customers__city" could not be resolved');
  });
  test('a missing or unknown aggregateFunction', () => {
    for (const fn of ['', 'MEDIAN']) {
      const x = { ...f('customers__city', 'STRING', j('customers', 'cus1', 'city', fn)), alias: 'City' };
      expect(run({ schema: [f('id'), x], visible: ['customers__city'], sources: [customers([x])] })).toBe('REASON OWOX didn\'t say how the join rolls up "City". Reload the data mart and try again.');
    }
  });
  test('an array source type', () => {
    const x = f('customers__tags', 'STRING', j('customers', 'cus1', 'tags', 'STRING_AGG', 'ARRAY<STRING>'));
    expect(run({ schema: [f('id'), x], visible: ['customers__tags'], sources: [customers([x])] })).toBe('REASON "customers__tags" is a list field from a joined data mart, which a data mart can\'t save yet. Hide it or remove its filter.');
  });
  test('a dotted join key', () => {
    const nestedEdges: Edge[] = [{ id: 'e1', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'geo.country', targetField: 'meta.country' }] }];
    expect(run({ visible: ['customers__city'], edges: nestedEdges })).toBe('REASON The join to "Customers" uses a nested key, which OWOX can\'t join on');
  });
  test('an edge found by id is used only in the right direction', () => {
    const wrong: Edge = { id: 'e1', source: 'other', target: 'cus1', joins: [{ sourceField: 'x', targetField: 'y' }] };
    expect(run({ visible: ['customers__city'], edges: [wrong, { ...edges[0]!, id: 'e7' }] })).toContain('ON base_owox.customer_id = customers_owox.id');
    expect(run({ visible: ['customers__city'], edges: [wrong] })).toBe('REASON The join to "Customers" could not be resolved');
  });
  test('without a relationship id the single edge is used, and two candidates are a reason', () => {
    const sources = [customers([city], { relationshipId: undefined })];
    expect(run({ visible: ['customers__city'], sources })).toContain('ON base_owox.customer_id = customers_owox.id');
    const dup: Edge = { id: 'e9', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'x', targetField: 'y' }] };
    expect(run({ visible: ['customers__city'], sources, edges: [...edges, dup] })).toBe('REASON The join to "Customers" could not be resolved');
    expect(run({ visible: ['customers__city'], sources: [customers([city], { relationshipId: 'gone' })], edges: [] })).toBe('REASON The join to "Customers" could not be resolved');
  });
  test('an unsafe mart id', () => {
    expect(run({ main: { id: 'a)b', title: 'Orders' } })).toBe('REASON The data mart id is not valid');
    expect(run({ visible: ['customers__city'], sources: [customers([city], { martId: 'x y' })] })).toBe('REASON The join to "Customers" could not be resolved');
  });
});

describe('CTE naming', () => {
  const src = (aliasPath: string, fields: Field[]) => customers(fields, { aliasPath });
  test('a clash with base gets _2 before the suffix', () => {
    const x = f('base__x', 'STRING', j('base', 'cus1', 'x'));
    const sql = run({ schema: [f('id'), x], visible: ['id', 'base__x'], sources: [src('base', [x])] });
    expect(sql).toContain('  base_2_owox AS (');
    expect(sql).toContain('LEFT JOIN base_2_owox ON');
  });
  test('an unusable path falls back to jN_owox', () => {
    const x = f('weird', 'STRING', j('Cust-1', 'cus1', 'x'));
    const sql = run({ schema: [f('id'), x], visible: ['id', 'weird'], sources: [src('Cust-1', [x])] });
    expect(sql).toContain('  j1_owox AS (');
    expect(sql).not.toContain('customers_owox');
    expect(sql).toContain('j1_owox.weird');
  });
  test('a reserved word gets the _owox suffix', () => {
    const x = f('order__x', 'STRING', j('order', 'cus1', 'x'));
    const sql = run({ schema: [f('id'), x], visible: ['id', 'order__x'], sources: [src('order', [x])] });
    expect(sql).toContain('  order_owox AS (');
    expect(sql).toContain('order_owox.order__x');
  });
});

test('a title is escaped as the backend reads it: backslash, brackets, line breaks', () => {
  expect(run({ main: { id: 'ord1', title: 'Orders [raw]' } })).toContain('FROM [Orders \\[raw\\]](dm:ord1)\n');
  expect(run({ main: { id: 'ord1', title: 'C:\\' } })).toContain('FROM [C:\\\\](dm:ord1)\n');
  expect(run({ main: { id: 'ord1', title: 'A\nB\r\nC' } })).toContain('FROM [A B C](dm:ord1)');
});

test('a non-finite number filter is incomplete, so it is skipped rather than thrown', () => {
  expect(run({ schema: [f('qty', 'INTEGER')], visible: ['qty'], filters: [{ field: 'qty', op: 'gt', value: Infinity }] })).toBe(`WITH\n${BASE}\nSELECT\n  base_owox.qty\nFROM base_owox`);
});

describe('grouped', () => {
  const qty = f('order_items__quantity', 'INTEGER', j('order_items', 'itm1', 'quantity', 'SUM', 'INTEGER'));
  const amount = f('amount', 'INTEGER');
  const created = f('created_at', 'TIMESTAMP');
  const gschema = [f('id', 'INTEGER'), f('status'), f('customer_id', 'INTEGER'), amount, created, city, sku, qty, regionName];
  const gsources = [customers([city]), items([sku, qty]), region([regionName])];
  const g = (over: Partial<MartSqlInput> = {}) => run({ schema: gschema, sources: gsources, ...over });
  const spec86: Partial<MartSqlInput> = {
    visible: ['status', 'amount', 'created_at', 'customers__city', 'order_items__sku', 'order_items__quantity'],
    filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'SUM' }],
      dateTrunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    },
  };

  test('an aggregation with no function or bucket is the ungrouped SQL byte for byte', () => {
    const plain = run({ visible: ['id', 'customers__city'] });
    expect(g({ visible: ['id', 'customers__city'], aggregation: { aggregations: [], dateTrunc: [] } })).toBe(plain);
    expect(g({ visible: ['id', 'customers__city'], aggregation: { aggregations: [{ column: 'status', function: 'SUM' }], dateTrunc: [] } })).toBe(plain);
  });

  test('main-only grouping: a key, a metric, GROUP BY, no sleeve and no join', () => {
    expect(g({ visible: ['status', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } })).toBe(
      `WITH\n${BASE}\nSELECT\n  base_owox.status AS status,\n  SUM(base_owox.amount) AS amount__sum\nFROM base_owox\nGROUP BY base_owox.status`,
    );
  });

  test('a grouping with no key has no GROUP BY', () => {
    expect(g({ visible: ['amount'], aggregation: { aggregations: [{ column: 'amount', function: 'AVG' }], dateTrunc: [] } })).toBe(`WITH\n${BASE}\nSELECT\n  AVG(base_owox.amount) AS amount__avg\nFROM base_owox`);
  });

  describe('every main function, per dialect', () => {
    const fns = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'] as const;
    const out = (d: Dialect) => g({ dialect: d, visible: ['amount'], aggregation: { aggregations: fns.map((fn) => ({ column: 'amount', function: fn })), dateTrunc: [] } });
    test('BigQuery', () => {
      expect(out('bigquery')).toContain([
        'SELECT',
        '  SUM(base_owox.amount) AS amount__sum,',
        '  AVG(base_owox.amount) AS amount__avg,',
        '  MIN(base_owox.amount) AS amount__min,',
        '  MAX(base_owox.amount) AS amount__max,',
        '  COUNT(base_owox.amount) AS amount__count,',
        '  COUNT(DISTINCT base_owox.amount) AS amount__countunique,',
        "  STRING_AGG(CAST(base_owox.amount AS STRING), ', ') AS amount__stringagg,",
        '  ANY_VALUE(base_owox.amount) AS amount__anyvalue,',
        '  APPROX_QUANTILES(base_owox.amount, 100)[OFFSET(25)] AS amount__p25,',
        '  APPROX_QUANTILES(base_owox.amount, 100)[OFFSET(50)] AS amount__median,',
        '  APPROX_QUANTILES(base_owox.amount, 100)[OFFSET(75)] AS amount__p75,',
        '  APPROX_QUANTILES(base_owox.amount, 100)[OFFSET(95)] AS amount__p95',
      ].join('\n'));
    });
    test('Athena', () => {
      const sql = out('athena');
      expect(sql).toContain("array_join(array_agg(CAST(base_owox.amount AS VARCHAR)), ', ') AS amount__stringagg");
      expect(sql).toContain('arbitrary(base_owox.amount) AS amount__anyvalue');
      expect(sql).toContain('APPROX_PERCENTILE(CAST(base_owox.amount AS DOUBLE), 0.5) AS amount__median');
    });
    test('Snowflake quotes every name', () => {
      const sql = out('snowflake');
      expect(sql).toContain(`LISTAGG(CAST(base_owox."amount" AS VARCHAR), ', ') AS "amount__stringagg"`);
      expect(sql).toContain('PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY base_owox."amount") AS "amount__p25"');
      expect(sql).toContain('COUNT(DISTINCT base_owox."amount") AS "amount__countunique"');
    });
    test('Redshift and Databricks', () => {
      expect(out('redshift')).toContain("LISTAGG(CAST(base_owox.amount AS VARCHAR), ', ') AS amount__stringagg");
      expect(out('redshift')).toContain('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY base_owox.amount) AS amount__p95');
      expect(out('databricks')).toContain("array_join(collect_list(CAST(base_owox.amount AS STRING)), ', ') AS amount__stringagg");
      expect(out('databricks')).toContain('PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY base_owox.amount) AS amount__p75');
    });
  });

  describe('date buckets', () => {
    const bucket = (d: Dialect, unit: DateBucket, timeZone?: string, col = 'created_at') => g({ dialect: d, visible: [col, 'amount'], schema: [...gschema, f('ts', 'TIMESTAMP'), f('dt', 'DATETIME'), f('d', 'DATE')], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [{ column: col, unit, ...(timeZone ? { timeZone } : {}) }] } });
    test('each unit on each dialect, with and without a zone, projected under the column name and repeated in GROUP BY', () => {
      for (const unit of ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const) {
        const l = unit.toLowerCase();
        const cases: [Dialect, string | undefined, string][] = [
          ['bigquery', undefined, `DATE_TRUNC(DATE(base_owox.created_at), ${unit})`],
          ['bigquery', 'UTC', `DATE_TRUNC(DATE(base_owox.created_at, 'UTC'), ${unit})`],
          ['athena', undefined, `date_trunc('${l}', base_owox.created_at)`],
          ['athena', 'UTC', `date_trunc('${l}', (base_owox.created_at) AT TIME ZONE 'UTC')`],
          ['snowflake', undefined, `DATE_TRUNC('${unit}', base_owox."created_at")`],
          ['snowflake', 'UTC', `DATE_TRUNC('${unit}', CONVERT_TIMEZONE('UTC', base_owox."created_at"))`],
          ['redshift', undefined, `DATE_TRUNC('${l}', base_owox.created_at)`],
          ['redshift', 'UTC', `DATE_TRUNC('${l}', CONVERT_TIMEZONE('UTC', base_owox.created_at))`],
          ['databricks', undefined, `DATE_TRUNC('${unit}', base_owox.created_at)`],
          ['databricks', 'UTC', `DATE_TRUNC('${unit}', FROM_UTC_TIMESTAMP(base_owox.created_at, 'UTC'))`],
        ];
        for (const [d, zone, expr] of cases) {
          const sql = bucket(d, unit, zone);
          expect(sql).toContain(`  ${expr} AS ${d === 'snowflake' ? '"created_at"' : 'created_at'},`);
          expect(sql).toMatch(new RegExp(`\\nGROUP BY ${expr.replace(/[()[\]\\.]/g, '\\$&')}$`));
        }
      }
    });
    test('BigQuery: a DATE column truncates directly, a DATETIME with a zone goes through TIMESTAMP', () => {
      expect(bucket('bigquery', 'MONTH', 'Europe/Berlin', 'd')).toContain('DATE_TRUNC(base_owox.d, MONTH) AS d');
      expect(bucket('bigquery', 'DAY', 'America/New_York', 'dt')).toContain("DATE_TRUNC(DATE(TIMESTAMP(base_owox.dt, 'America/New_York'), 'America/New_York'), DAY) AS dt");
      expect(bucket('bigquery', 'DAY', undefined, 'dt')).toContain('DATE_TRUNC(DATE(base_owox.dt), DAY) AS dt');
    });
    test('a bucket on a joined date column keys on the roll-up', () => {
      const signup = f('customers__signup', 'DATE', j('customers', 'cus1', 'signup', 'MAX', 'DATE'));
      const sql = g({ schema: [...gschema, signup], sources: [customers([city, signup]), items([sku, qty]), region([regionName])], visible: ['customers__signup', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [{ column: 'customers__signup', unit: 'QUARTER' }] } });
      expect(sql).toContain('DATE_TRUNC(customers_owox.customers__signup, QUARTER) AS customers__signup');
      expect(sql).toContain('MAX(t.signup) AS customers__signup');
    });
    test('a bad zone or unit is a reason', () => {
      expect(bucket('bigquery', 'MONTH', "UTC'; DROP TABLE x")).toBe("REASON Invalid time zone: UTC'; DROP TABLE x");
      expect(bucket('bigquery', 'HOUR' as DateBucket)).toBe('REASON Unknown date bucket: HOUR');
    });
  });

  test('a joined key is the roll-up, in SELECT and GROUP BY', () => {
    const sql = g({ visible: ['customers__city', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } });
    expect(sql).toContain('  customers_owox.customers__city AS customers__city,\n  SUM(base_owox.amount) AS amount__sum\nFROM base_owox\nLEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id\nGROUP BY customers_owox.customers__city');
  });

  test('joined COUNT and ANY_VALUE stay in the outer query, with no sleeve', () => {
    const agg = { aggregations: [{ column: 'customers__city', function: 'COUNT' as const }, { column: 'order_items__sku', function: 'ANY_VALUE' as const }], dateTrunc: [] };
    const sql = g({ visible: ['status', 'customers__city', 'order_items__sku'], aggregation: agg });
    expect(sql).toContain('  COUNT(customers_owox.customers__city) AS customers__city__count,\n  ANY_VALUE(order_items_owox.order_items__sku) AS order_items__sku__anyvalue\n');
    expect(sql).not.toContain('sleeve');
    expect(g({ dialect: 'athena', visible: ['status', 'order_items__sku'], aggregation: agg })).toContain('arbitrary(order_items_owox.order_items__sku) AS order_items__sku__anyvalue');
  });

  test('section 8.6 in full, BigQuery', () => {
    expect(g(spec86)).toBe(`WITH
  base_owox AS (
    SELECT *
    FROM [Orders](dm:ord1)
  ),
  customers_owox AS (
    SELECT
      t.id,
      STRING_AGG(CAST(t.city AS STRING), ', ' ORDER BY CAST(t.city AS STRING)) AS customers__city
    FROM [Customers](dm:cus1) AS t
    GROUP BY t.id
  ),
  order_items_owox AS (
    SELECT
      t.order_id,
      STRING_AGG(CAST(t.sku AS STRING), ', ' ORDER BY CAST(t.sku AS STRING)) AS order_items__sku,
      SUM(t.quantity) AS order_items__quantity
    FROM [Order Items](dm:itm1) AS t
    GROUP BY t.order_id
  ),
  sleeve_order_items_cd_owox AS (
    SELECT
      base_owox.status AS _owox_dim_0,
      DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH) AS _owox_dim_1,
      customers_owox.customers__city AS _owox_dim_2,
      COUNT(DISTINCT order_items_raw_owox.sku) AS order_items__sku__countunique
    FROM base_owox
    LEFT JOIN [Order Items](dm:itm1) AS order_items_raw_owox ON base_owox.id = order_items_raw_owox.order_id
    LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id
    WHERE customers_owox.customers__city = 'Paris'
    GROUP BY base_owox.status, DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH), customers_owox.customers__city
  ),
  sleeve_order_items__quantity_owox AS (
    SELECT
      _owox_dim_0,
      _owox_dim_1,
      _owox_dim_2,
      SUM(_val) AS order_items__quantity__sum
    FROM (
      SELECT DISTINCT
        base_owox.status AS _owox_dim_0,
        DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH) AS _owox_dim_1,
        customers_owox.customers__city AS _owox_dim_2,
        order_items_owox.order_id AS _oid,
        order_items_owox.order_items__quantity AS _val
      FROM base_owox
      LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id
      LEFT JOIN order_items_owox ON base_owox.id = order_items_owox.order_id
      WHERE customers_owox.customers__city = 'Paris'
    ) _dedup
    GROUP BY _owox_dim_0, _owox_dim_1, _owox_dim_2
  )
SELECT
  base_owox.status AS status,
  SUM(base_owox.amount) AS amount__sum,
  DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH) AS created_at,
  customers_owox.customers__city AS customers__city,
  COALESCE(ANY_VALUE(sleeve_order_items_cd_owox.order_items__sku__countunique), 0) AS order_items__sku__countunique,
  ANY_VALUE(sleeve_order_items__quantity_owox.order_items__quantity__sum) AS order_items__quantity__sum
FROM base_owox
LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id
LEFT JOIN order_items_owox ON base_owox.id = order_items_owox.order_id
LEFT JOIN sleeve_order_items_cd_owox ON ((base_owox.status) = (sleeve_order_items_cd_owox._owox_dim_0) OR ((base_owox.status) IS NULL AND (sleeve_order_items_cd_owox._owox_dim_0) IS NULL)) AND ((DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH)) = (sleeve_order_items_cd_owox._owox_dim_1) OR ((DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH)) IS NULL AND (sleeve_order_items_cd_owox._owox_dim_1) IS NULL)) AND ((customers_owox.customers__city) = (sleeve_order_items_cd_owox._owox_dim_2) OR ((customers_owox.customers__city) IS NULL AND (sleeve_order_items_cd_owox._owox_dim_2) IS NULL))
LEFT JOIN sleeve_order_items__quantity_owox ON ((base_owox.status) = (sleeve_order_items__quantity_owox._owox_dim_0) OR ((base_owox.status) IS NULL AND (sleeve_order_items__quantity_owox._owox_dim_0) IS NULL)) AND ((DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH)) = (sleeve_order_items__quantity_owox._owox_dim_1) OR ((DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH)) IS NULL AND (sleeve_order_items__quantity_owox._owox_dim_1) IS NULL)) AND ((customers_owox.customers__city) = (sleeve_order_items__quantity_owox._owox_dim_2) OR ((customers_owox.customers__city) IS NULL AND (sleeve_order_items__quantity_owox._owox_dim_2) IS NULL))
WHERE customers_owox.customers__city = 'Paris'
GROUP BY base_owox.status, DATE_TRUNC(DATE(base_owox.created_at, 'Europe/Berlin'), MONTH), customers_owox.customers__city`);
  });

  test('section 8.6 on Snowflake in full: every column is quoted and the buckets use CONVERT_TIMEZONE', () => {
    expect(g({ ...spec86, dialect: 'snowflake' })).toBe(`WITH
  base_owox AS (
    SELECT *
    FROM [Orders](dm:ord1)
  ),
  customers_owox AS (
    SELECT
      t."id",
      LISTAGG(CAST(t."city" AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t."city") AS "customers__city"
    FROM [Customers](dm:cus1) AS t
    GROUP BY t."id"
  ),
  order_items_owox AS (
    SELECT
      t."order_id",
      LISTAGG(CAST(t."sku" AS VARCHAR), ', ') WITHIN GROUP (ORDER BY t."sku") AS "order_items__sku",
      SUM(t."quantity") AS "order_items__quantity"
    FROM [Order Items](dm:itm1) AS t
    GROUP BY t."order_id"
  ),
  sleeve_order_items_cd_owox AS (
    SELECT
      base_owox."status" AS "_owox_dim_0",
      DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at")) AS "_owox_dim_1",
      customers_owox."customers__city" AS "_owox_dim_2",
      COUNT(DISTINCT order_items_raw_owox."sku") AS "order_items__sku__countunique"
    FROM base_owox
    LEFT JOIN [Order Items](dm:itm1) AS order_items_raw_owox ON base_owox."id" = order_items_raw_owox."order_id"
    LEFT JOIN customers_owox ON base_owox."customer_id" = customers_owox."id"
    WHERE customers_owox."customers__city" = 'Paris'
    GROUP BY base_owox."status", DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at")), customers_owox."customers__city"
  ),
  sleeve_order_items__quantity_owox AS (
    SELECT
      "_owox_dim_0",
      "_owox_dim_1",
      "_owox_dim_2",
      SUM("_val") AS "order_items__quantity__sum"
    FROM (
      SELECT DISTINCT
        base_owox."status" AS "_owox_dim_0",
        DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at")) AS "_owox_dim_1",
        customers_owox."customers__city" AS "_owox_dim_2",
        order_items_owox."order_id" AS "_oid",
        order_items_owox."order_items__quantity" AS "_val"
      FROM base_owox
      LEFT JOIN customers_owox ON base_owox."customer_id" = customers_owox."id"
      LEFT JOIN order_items_owox ON base_owox."id" = order_items_owox."order_id"
      WHERE customers_owox."customers__city" = 'Paris'
    ) _dedup
    GROUP BY "_owox_dim_0", "_owox_dim_1", "_owox_dim_2"
  )
SELECT
  base_owox."status" AS "status",
  SUM(base_owox."amount") AS "amount__sum",
  DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at")) AS "created_at",
  customers_owox."customers__city" AS "customers__city",
  COALESCE(ANY_VALUE(sleeve_order_items_cd_owox."order_items__sku__countunique"), 0) AS "order_items__sku__countunique",
  ANY_VALUE(sleeve_order_items__quantity_owox."order_items__quantity__sum") AS "order_items__quantity__sum"
FROM base_owox
LEFT JOIN customers_owox ON base_owox."customer_id" = customers_owox."id"
LEFT JOIN order_items_owox ON base_owox."id" = order_items_owox."order_id"
LEFT JOIN sleeve_order_items_cd_owox ON ((base_owox."status") = (sleeve_order_items_cd_owox."_owox_dim_0") OR ((base_owox."status") IS NULL AND (sleeve_order_items_cd_owox."_owox_dim_0") IS NULL)) AND ((DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at"))) = (sleeve_order_items_cd_owox."_owox_dim_1") OR ((DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at"))) IS NULL AND (sleeve_order_items_cd_owox."_owox_dim_1") IS NULL)) AND ((customers_owox."customers__city") = (sleeve_order_items_cd_owox."_owox_dim_2") OR ((customers_owox."customers__city") IS NULL AND (sleeve_order_items_cd_owox."_owox_dim_2") IS NULL))
LEFT JOIN sleeve_order_items__quantity_owox ON ((base_owox."status") = (sleeve_order_items__quantity_owox."_owox_dim_0") OR ((base_owox."status") IS NULL AND (sleeve_order_items__quantity_owox."_owox_dim_0") IS NULL)) AND ((DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at"))) = (sleeve_order_items__quantity_owox."_owox_dim_1") OR ((DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at"))) IS NULL AND (sleeve_order_items__quantity_owox."_owox_dim_1") IS NULL)) AND ((customers_owox."customers__city") = (sleeve_order_items__quantity_owox."_owox_dim_2") OR ((customers_owox."customers__city") IS NULL AND (sleeve_order_items__quantity_owox."_owox_dim_2") IS NULL))
WHERE customers_owox."customers__city" = 'Paris'
GROUP BY base_owox."status", DATE_TRUNC('MONTH', CONVERT_TIMEZONE('Europe/Berlin', base_owox."created_at")), customers_owox."customers__city"`);
  });

  describe('count-distinct sleeves', () => {
    const skuB = f('order_items__sku_b', 'STRING', j('order_items', 'itm1', 'sku_b'));
    const cd = (column: string) => ({ column, function: 'COUNT_DISTINCT' as const });
    test('two COUNT_DISTINCTs on one owner share one sleeve; the pull is COALESCEd', () => {
      const sql = g({ schema: [...gschema, skuB], sources: [customers([city]), items([sku, skuB]), region([regionName])], visible: ['status', 'order_items__sku', 'order_items__sku_b'], aggregation: { aggregations: [cd('order_items__sku'), cd('order_items__sku_b')], dateTrunc: [] } });
      expect(sql.match(/sleeve_\w+ AS \(/g)).toEqual(['sleeve_order_items_cd_owox AS (']);
      expect(sql).toContain('      COUNT(DISTINCT order_items_raw_owox.sku) AS order_items__sku__countunique,\n      COUNT(DISTINCT order_items_raw_owox.sku_b) AS order_items__sku_b__countunique\n');
      expect(sql).toContain('COALESCE(ANY_VALUE(sleeve_order_items_cd_owox.order_items__sku__countunique), 0) AS order_items__sku__countunique');
    });
    test('COUNT_DISTINCTs on different owners get a sleeve each', () => {
      const sql = g({ visible: ['status', 'customers__city', 'order_items__sku'], aggregation: { aggregations: [cd('order_items__sku'), cd('customers__city')], dateTrunc: [] } });
      expect(sql.match(/sleeve_\w+ AS \(/g)).toEqual(['sleeve_order_items_cd_owox AS (', 'sleeve_customers_cd_owox AS (']);
      expect(sql).toContain('    FROM base_owox\n    LEFT JOIN [Customers](dm:cus1) AS customers_raw_owox ON base_owox.customer_id = customers_raw_owox.id\n    GROUP BY base_owox.status');
    });
    test('a depth-2 owner joins every raw ancestor, parents first', () => {
      const code = f('customers__region__name', 'STRING', j('customers.region', 'reg1', 'name'));
      const sql = g({ schema: [...gschema.filter((x) => x.name !== 'customers__region__name'), code], visible: ['status', 'customers__region__name'], aggregation: { aggregations: [cd('customers__region__name')], dateTrunc: [] } });
      expect(sql).toContain('      COUNT(DISTINCT customers__region_raw_owox.name) AS customers__region__name__countunique\n    FROM base_owox\n    LEFT JOIN [Customers](dm:cus1) AS customers_raw_owox ON base_owox.customer_id = customers_raw_owox.id\n    LEFT JOIN [Region](dm:reg1) AS customers__region_raw_owox ON customers_raw_owox.region_id = customers__region_raw_owox.id AND customers_raw_owox.country = customers__region_raw_owox.country\n');
    });
  });

  describe('value sleeves', () => {
    test('SUM and AVG on one column share one sleeve and one _val', () => {
      const sql = g({ visible: ['status', 'order_items__quantity'], aggregation: { aggregations: [{ column: 'order_items__quantity', function: 'SUM' }, { column: 'order_items__quantity', function: 'AVG' }], dateTrunc: [] } });
      expect(sql.match(/sleeve_\w+ AS \(/g)).toEqual(['sleeve_order_items__quantity_owox AS (']);
      expect(sql).toContain('      SUM(_val) AS order_items__quantity__sum,\n      AVG(_val) AS order_items__quantity__avg\n    FROM (');
      expect(sql.match(/AS _val/g)).toHaveLength(1);
      expect(sql).toContain('ANY_VALUE(sleeve_order_items__quantity_owox.order_items__quantity__sum) AS order_items__quantity__sum');
      expect(sql).not.toContain('COALESCE');
    });
    test('a two-column join key gives _oid_0 and _oid_1; a depth-2 owner joins its parent raw alias, then its own CTE', () => {
      const pop = f('customers__region__pop', 'INTEGER', j('customers.region', 'reg1', 'pop', 'SUM', 'INTEGER'));
      const sql = g({ schema: [...gschema, pop], sources: [customers([city]), items([sku, qty]), region([regionName, pop])], visible: ['status', 'customers__region__pop'], aggregation: { aggregations: [{ column: 'customers__region__pop', function: 'SUM' }], dateTrunc: [] } });
      expect(sql).toContain('        customers__region_owox.id AS _oid_0,\n        customers__region_owox.country AS _oid_1,\n        customers__region_owox.customers__region__pop AS _val\n      FROM base_owox\n      LEFT JOIN [Customers](dm:cus1) AS customers_raw_owox ON base_owox.customer_id = customers_raw_owox.id\n      LEFT JOIN customers__region_owox ON customers_raw_owox.region_id = customers__region_owox.id AND customers_raw_owox.country = customers__region_owox.country\n    ) _dedup');
    });
    test('STRING_AGG inside is the ordered form; P50 on Snowflake is PERCENTILE_CONT over _val', () => {
      const tag = f('customers__tag', 'STRING', j('customers', 'cus1', 'tag'));
      const aggs = { aggregations: [{ column: 'customers__tag', function: 'STRING_AGG' as const }], dateTrunc: [] };
      expect(g({ schema: [...gschema, tag], sources: [customers([city, tag]), items([sku, qty]), region([regionName])], visible: ['status', 'customers__tag'], aggregation: aggs })).toContain("STRING_AGG(CAST(_val AS STRING), ', ' ORDER BY CAST(_val AS STRING)) AS customers__tag__stringagg");
      const p50 = { aggregations: [{ column: 'order_items__quantity', function: 'P50' as const }], dateTrunc: [] };
      expect(g({ dialect: 'snowflake', visible: ['status', 'order_items__quantity'], aggregation: p50 })).toContain('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "_val") AS "order_items__quantity__median"');
    });
  });

  test('with no keys a sleeve has no GROUP BY, is attached with CROSS JOIN, and the outer query has no GROUP BY', () => {
    const sql = g({ visible: ['amount', 'order_items__sku', 'order_items__quantity'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'MAX' }], dateTrunc: [] } });
    expect(sql).toContain('  sleeve_order_items_cd_owox AS (\n    SELECT\n      COUNT(DISTINCT order_items_raw_owox.sku) AS order_items__sku__countunique\n    FROM base_owox\n    LEFT JOIN [Order Items](dm:itm1) AS order_items_raw_owox ON base_owox.id = order_items_raw_owox.order_id\n  ),');
    expect(sql).toContain('    ) _dedup\n  )\nSELECT');
    expect(sql).toContain('FROM base_owox\nLEFT JOIN order_items_owox ON base_owox.id = order_items_owox.order_id\nCROSS JOIN sleeve_order_items_cd_owox\nCROSS JOIN sleeve_order_items__quantity_owox');
    expect(sql.slice(sql.indexOf('sleeve_order_items_cd_owox AS'))).not.toContain('GROUP BY');
  });

  test('a FLOAT key adds the NaN leg to the null-safe ON; an INTEGER key does not', () => {
    const score = f('score', 'FLOAT');
    const aggs = { aggregations: [{ column: 'order_items__quantity', function: 'SUM' as const }], dateTrunc: [] };
    expect(g({ schema: [...gschema, score], visible: ['score', 'order_items__quantity'], aggregation: aggs })).toContain('OR ((base_owox.score) != (base_owox.score) AND (sleeve_order_items__quantity_owox._owox_dim_0) != (sleeve_order_items__quantity_owox._owox_dim_0))');
    expect(g({ visible: ['id', 'order_items__quantity'], aggregation: aggs })).not.toContain('!=');
  });

  test('the filter is in the outer WHERE and every sleeve WHERE, and its root is joined in a sleeve with no other use for it', () => {
    const sql = g({ visible: ['status', 'order_items__sku'], filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }], aggregation: { aggregations: [{ column: 'order_items__sku', function: 'COUNT_DISTINCT' }], dateTrunc: [] } });
    expect(sql.match(/WHERE customers_owox\.customers__city = 'Paris'/g)).toHaveLength(2);
    expect(sql).toContain("    LEFT JOIN [Order Items](dm:itm1) AS order_items_raw_owox ON base_owox.id = order_items_raw_owox.order_id\n    LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id\n    WHERE customers_owox.customers__city = 'Paris'");
  });

  describe('output names', () => {
    test('metrics are column__token; a dotted main column keeps its underscore form; a clash gets _2; Snowflake quotes them', () => {
      const nested = f('address.city');
      const aggs = { aggregations: [{ column: 'amount', function: 'SUM' as const }, { column: 'amount', function: 'P50' as const }, { column: 'address.city', function: 'COUNT_DISTINCT' as const }], dateTrunc: [] };
      const sql = g({ schema: [...gschema, nested], visible: ['status', 'address.city', 'amount'], aggregation: aggs });
      expect(sql).toContain('COUNT(DISTINCT base_owox.address.city) AS address_city__countunique');
      expect(sql).toContain('APPROX_QUANTILES(base_owox.amount, 100)[OFFSET(50)] AS amount__median');
      const clash = f('amount__sum', 'INTEGER');
      const second = g({ schema: [...gschema, clash], visible: ['amount__sum', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } });
      expect(second).toContain('base_owox.amount__sum AS amount__sum,\n  SUM(base_owox.amount) AS amount__sum_2');
      expect(g({ dialect: 'snowflake', visible: ['amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } })).toContain('SUM(base_owox."amount") AS "amount__sum"');
    });
    test('a clash that differs only by case still gets the suffix', () => {
      const upper = f('AMOUNT__SUM', 'INTEGER');
      const sql = g({ schema: [...gschema, upper], visible: ['AMOUNT__SUM', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } });
      expect(sql).toContain('base_owox.AMOUNT__SUM AS AMOUNT__SUM,\n  SUM(base_owox.amount) AS amount__sum_2');
    });
    test('a dotted main key is projected as address_city', () => {
      const sql = g({ schema: [...gschema, f('address.city')], visible: ['address.city', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] } });
      expect(sql).toContain('base_owox.address.city AS address_city');
    });
  });

  describe('ORDER BY', () => {
    const aggs = { aggregations: [{ column: 'amount', function: 'SUM' as const }, { column: 'amount', function: 'MAX' as const }, { column: 'order_items__quantity', function: 'SUM' as const }], dateTrunc: [] };
    const vis = ['status', 'amount', 'order_items__quantity'];
    test('there is none without a sort', () => {
      expect(g({ visible: vis, aggregation: aggs })).not.toContain('ORDER BY amount');
      expect(g({ visible: vis, aggregation: aggs })).not.toMatch(/\nORDER BY/);
    });
    test('a key sorts by its output name, a function column by its first rule, a sleeve metric by its sleeve output', () => {
      expect(g({ visible: vis, aggregation: aggs, sorts: [{ field: 'status', direction: 'asc' }, { field: 'amount', direction: 'desc' }, { field: 'order_items__quantity', direction: 'asc' }] })).toMatch(/\nORDER BY status ASC, amount__sum DESC, order_items__quantity__sum ASC$/);
    });
    test('a sort on a column that is not shown is left out', () => {
      const sql = g({ visible: ['status', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] }, sorts: [{ field: 'customers__city', direction: 'asc' }] });
      expect(sql).not.toContain('ORDER BY');
      expect(sql).not.toContain('customers_owox');
    });
  });

  describe('reasons', () => {
    const joinedAny = f('order_items__flag', 'STRING', j('order_items', 'itm1', 'flag', 'ANY_VALUE', 'STRING'));
    test('a value function on a joined field whose join keeps one sample value per row', () => {
      for (const fn of ['SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'P25', 'P50', 'P75', 'P95'] as const) {
        expect(g({ schema: [...gschema, joinedAny], sources: [customers([city]), items([sku, qty, joinedAny]), region([regionName])], visible: ['status', 'order_items__flag'], aggregation: { aggregations: [{ column: 'order_items__flag', function: fn }], dateTrunc: [] } }))
          .toBe('REASON "order_items__flag" can\'t be saved: its join keeps one sample value per row, which a data mart can\'t reproduce yet. Pick another function for it, or change its join setting.');
      }
    });
    test('Count, Count Unique and Sample on that field are fine', () => {
      for (const fn of ['COUNT', 'COUNT_DISTINCT', 'ANY_VALUE'] as const) {
        expect(g({ schema: [...gschema, joinedAny], sources: [customers([city]), items([sku, qty, joinedAny]), region([regionName])], visible: ['status', 'order_items__flag'], aggregation: { aggregations: [{ column: 'order_items__flag', function: fn }], dateTrunc: [] } })).not.toMatch(/^REASON/);
      }
    });
    test('Count and Count Unique together on one joined column', () => {
      expect(g({ visible: ['status', 'order_items__sku'], aggregation: { aggregations: [{ column: 'order_items__sku', function: 'COUNT' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }], dateTrunc: [] } }))
        .toBe('REASON Count and Count Unique together on "order_items__sku" aren\'t available for a joined column. Remove one of them.');
    });
    test('Count and Count Unique together on a main column are fine', () => {
      expect(g({ visible: ['status', 'amount'], aggregation: { aggregations: [{ column: 'amount', function: 'COUNT' }, { column: 'amount', function: 'COUNT_DISTINCT' }], dateTrunc: [] } })).not.toMatch(/^REASON/);
    });
    test('an array-typed joined field and a calculated field keep their reasons', () => {
      const arr = f('order_items__tags', 'ARRAY<STRING>', j('order_items', 'itm1', 'tags', 'STRING_AGG', 'ARRAY<STRING>'));
      expect(g({ schema: [...gschema, arr], sources: [customers([city]), items([sku, qty, arr]), region([regionName])], visible: ['status', 'order_items__tags'], aggregation: { aggregations: [{ column: 'order_items__tags', function: 'COUNT' }], dateTrunc: [] } })).toMatch(/^REASON "order_items__tags" is a list field/);
      const calc = { ...f('margin', 'INTEGER'), isCalculated: true };
      expect(g({ schema: [...gschema, calc], visible: ['status', 'margin'], aggregation: { aggregations: [{ column: 'margin', function: 'SUM' }], dateTrunc: [] } })).toMatch(/^REASON Calculated field "margin"/);
    });
  });
});

describe('slices', () => {
  const cityPara = { field: 'customers__city', op: 'eq' as const, value: 'Paris' };
  const nameSlice = { field: 'customers__region__name', op: 'eq' as const, value: 'EU' };

  test('a slice filters the path\'s raw rows inside its dedup CTE and never the outer WHERE', () => {
    const sql = run({ visible: ['id', 'customers__city'], slices: [cityPara] });
    expect(sql).toContain('FROM [Customers](dm:cus1) AS t\n    WHERE t.city = \'Paris\'\n    GROUP BY t.id');
    expect(sql).not.toMatch(/\nWHERE /);
    expect(sql).toContain('FROM base_owox\nLEFT JOIN customers_owox ON');
  });

  test('a slice uses the raw type, not the rolled-up one', () => {
    const n = f('customers__n', 'INTEGER', j('customers', 'cus1', 'n', 'COUNT', 'STRING'));
    const sql = run({ schema: [f('id', 'INTEGER'), n], visible: ['id', 'customers__n'], sources: [customers([n])], slices: [{ field: 'customers__n', op: 'contains', value: 'a' }] });
    expect(sql).toContain('STRPOS(t.n, \'a\') > 0');
  });

  test('a slice on a depth-2 path sits in that path\'s CTE, and the parent stays unfiltered', () => {
    const sql = run({ visible: ['id', 'customers__region__name'], slices: [nameSlice] });
    expect(sql).toMatch(/customers__region_owox AS \([\s\S]*FROM \[Region\]\(dm:reg1\) AS t\n {4}WHERE t\.name = 'EU'\n {4}GROUP BY/);
    expect(sql).not.toMatch(/customers_owox AS \([^)]*WHERE/);
  });

  test('a slice on a parent filters the rows its child joins to', () => {
    const sql = run({ visible: ['id', 'customers__region__name'], slices: [cityPara] });
    expect(sql).toMatch(/customers_owox AS \([\s\S]*FROM \[Customers\]\(dm:cus1\) AS t\n {4}LEFT JOIN customers__region_owox ON[^\n]*\n {4}WHERE t\.city = 'Paris'\n {4}GROUP BY/);
  });

  test('a sleeve reads a sliced path through a filtered derived table, a LEFT JOIN that keeps the rows', () => {
    const code = f('customers__region__code', 'INTEGER', j('customers.region', 'reg1', 'code', 'COUNT_DISTINCT', 'STRING'));
    const sql = run({
      schema: [f('id', 'INTEGER'), f('status'), city, regionName, code], visible: ['status', 'customers__city', 'customers__region__code'],
      sources: [customers([city]), region([code])], slices: [cityPara, nameSlice],
      aggregation: { aggregations: [{ column: 'customers__region__code', function: 'COUNT_DISTINCT' }], dateTrunc: [] },
    });
    expect(sql).toContain("LEFT JOIN (SELECT * FROM [Customers](dm:cus1) AS t WHERE t.city = 'Paris') AS customers_raw_owox ON base_owox.customer_id = customers_raw_owox.id");
    expect(sql).toContain("LEFT JOIN (SELECT * FROM [Region](dm:reg1) AS t WHERE t.name = 'EU') AS customers__region_raw_owox ON");
    expect(sql).not.toMatch(/\nWHERE /);
  });

  test('a slice on a main field, on an unread path or an incomplete one adds nothing', () => {
    const plain = run({ visible: ['id', 'customers__city'] });
    expect(run({ visible: ['id', 'customers__city'], slices: [{ field: 'status', op: 'eq', value: 'x' }, nameSlice, { field: 'customers__city', op: 'eq' }] })).toBe(plain);
  });
});

describe('HAVING filters', () => {
  const agg = (...rules: { column: string; function: 'SUM' | 'COUNT' | 'MAX' | 'COUNT_DISTINCT' }[]) => ({ aggregations: rules, dateTrunc: [] });
  const amount = f('amount', 'INTEGER');

  test('a main metric gets HAVING on the SELECT\'s own aggregate expression, none in the WHERE', () => {
    const sql = run({ schema: [f('status'), amount], visible: ['status', 'amount'], aggregation: agg({ column: 'amount', function: 'SUM' }), filters: [{ field: 'amount', op: 'gt', value: 100, fn: 'SUM' }] });
    expect(sql).toContain('  SUM(base_owox.amount) AS amount__sum');
    expect(sql).toContain('GROUP BY base_owox.status\nHAVING SUM(base_owox.amount) > 100');
    expect(sql).not.toMatch(/\nWHERE /);
  });

  test('a joined metric the outer query aggregates is a HAVING on that aggregate', () => {
    const n = f('customers__n', 'INTEGER', j('customers', 'cus1', 'n', 'COUNT', 'STRING'));
    const sql = run({ schema: [f('status'), n], visible: ['status', 'customers__n'], sources: [customers([n])], aggregation: agg({ column: 'customers__n', function: 'COUNT' }), filters: [{ field: 'customers__n', op: 'lte', value: 5, fn: 'COUNT' }] });
    expect(sql).toContain('HAVING COUNT(customers_owox.customers__n) <= 5');
  });

  test('a metric a sleeve computes is filtered after grouping, on the value the SELECT shows', () => {
    const q = f('order_items__q', 'INTEGER', j('order_items', 'itm1', 'q', 'SUM', 'INTEGER'));
    const sql = run({ schema: [f('status'), q], visible: ['status', 'order_items__q'], sources: [items([q])], aggregation: agg({ column: 'order_items__q', function: 'MAX' }), filters: [{ field: 'order_items__q', op: 'gt', value: 3, fn: 'MAX' }] });
    expect(sql).toMatch(/ANY_VALUE\((\w+)\.order_items__q__max\) AS order_items__q__max/);
    expect(sql).toMatch(/\nHAVING ANY_VALUE\(\w+\.order_items__q__max\) > 3$/);
    expect(sql).not.toMatch(/\nWHERE /);
  });

  test('a HAVING filter on a function the grid does not aggregate, or on an ungrouped grid, is dropped', () => {
    const grouped = run({ schema: [f('status'), amount], visible: ['status', 'amount'], aggregation: agg({ column: 'amount', function: 'SUM' }), filters: [{ field: 'amount', op: 'gt', value: 1, fn: 'MAX' }] });
    expect(grouped).not.toContain('HAVING');
    expect(run({ schema: [f('status'), amount], visible: ['status', 'amount'], filters: [{ field: 'amount', op: 'gt', value: 1, fn: 'SUM' }] })).not.toMatch(/HAVING|WHERE/);
  });

  test('a sleeve COUNT_DISTINCT is filtered on its COALESCE(ANY_VALUE(...), 0) form, as the SELECT shows it', () => {
    const sku2 = f('order_items__sku', 'STRING', j('order_items', 'itm1', 'sku', 'COUNT_DISTINCT', 'STRING'));
    const sql = run({ schema: [f('status'), sku2], visible: ['status', 'order_items__sku'], sources: [items([sku2])], aggregation: agg({ column: 'order_items__sku', function: 'COUNT_DISTINCT' }), filters: [{ field: 'order_items__sku', op: 'gt', value: 2, fn: 'COUNT_DISTINCT' }] });
    expect(sql).toMatch(/\nHAVING COALESCE\(ANY_VALUE\(\w+\.order_items__sku__countunique\), 0\) > 2$/);
    expect(sql).not.toMatch(/\nWHERE /);
  });

  test('on Athena a sleeve HAVING spells ANY_VALUE as arbitrary', () => {
    const q = f('order_items__q', 'INTEGER', j('order_items', 'itm1', 'q', 'SUM', 'INTEGER'));
    const sql = run({ dialect: 'athena', schema: [f('status'), q], visible: ['status', 'order_items__q'], sources: [items([q])], aggregation: agg({ column: 'order_items__q', function: 'MAX' }), filters: [{ field: 'order_items__q', op: 'gt', value: 3, fn: 'MAX' }] });
    expect(sql).toMatch(/\nHAVING arbitrary\(\w+\.order_items__q__max\) > 3$/);
  });

  test('a grid with no group keys has a HAVING and no GROUP BY, so an empty result stays empty', () => {
    const q = f('order_items__q', 'INTEGER', j('order_items', 'itm1', 'q', 'SUM', 'INTEGER'));
    const sql = run({ schema: [f('status'), q], visible: ['order_items__q'], sources: [items([q])], aggregation: agg({ column: 'order_items__q', function: 'MAX' }), filters: [{ field: 'order_items__q', op: 'gt', value: 3, fn: 'MAX' }] });
    expect(sql).toContain('CROSS JOIN');
    expect(sql).not.toContain('GROUP BY base_owox');
    expect(sql).toMatch(/\nHAVING ANY_VALUE\(\w+\.order_items__q__max\) > 3$/);
    expect(sql).not.toMatch(/\nWHERE /);
  });

});

describe('a chain through a middle mart with no column of its own', () => {
  test('the middle hop is a CTE with only its join key and the leaf, joined from the main mart', () => {
    const sql = run({ visible: ['id', 'customers__region__name'] });
    expect(sql).toContain('customers_owox AS (');
    expect(sql).toContain('customers__region_owox AS (');
    expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
    expect(sql).not.toContain('customers__city');
  });

  test('a middle mart the source list lacks (no field to offer) resolves from the relationship of the mart below it', () => {
    const sql = run({ visible: ['id', 'customers__region__name'], sources: [region([regionName])] });
    expect(sql).toContain('FROM [Customers](dm:cus1) AS t');
    expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
  });

  test('two missing middle levels cannot be resolved when the synthetic hop names no relationship', () => {
    const e = [...edges, { id: 'e4', source: 'reg1', target: 'ctr1', joins: [{ sourceField: 'country_id', targetField: 'id' }] }];
    const deep: JoinedSource = { aliasPath: 'customers.region.country', martId: 'ctr1', label: 'Country', depth: 3, fields: [], uniqueCount: false, relationshipId: 'e4' };
    const name = f('customers__region__country__name', 'STRING', j('customers.region.country', 'ctr1', 'name'));
    expect(run({ visible: ['id', 'customers__region__country__name'], schema: [f('id', 'INTEGER'), name], sources: [{ ...deep, fields: [name] }], edges: e, titles: new Map([...titles, ['ctr1', 'Country']]) })).toMatch(/^REASON The join to ".*" could not be resolved$/);
  });

  test('two levels resolve when every hop names its relationship', () => {
    const e = [...edges, { id: 'e4', source: 'reg1', target: 'ctr1', joins: [{ sourceField: 'country_id', targetField: 'id' }] }];
    const deep: JoinedSource = { aliasPath: 'customers.region.country', martId: 'ctr1', label: 'Country', depth: 3, fields: [], uniqueCount: false, relationshipId: 'e4' };
    const name = f('customers__region__country__name', 'STRING', j('customers.region.country', 'ctr1', 'name'));
    const sql = run({ visible: ['id', 'customers__region__country__name'], schema: [f('id', 'INTEGER'), name], sources: [{ ...deep, fields: [name] }, region()], edges: e, titles: new Map([...titles, ['ctr1', 'Country']]) });
    expect(sql).toContain('FROM [Customers](dm:cus1) AS t');
    expect(sql).toContain('FROM [Region](dm:reg1) AS t');
    expect(sql).toContain('LEFT JOIN customers_owox ON base_owox.customer_id = customers_owox.id');
  });

  test('a hop whose relationship is not in the model is not replaced by another route into the same mart', () => {
    // main -> Y -> c, but Y is not on the canvas: the model has main -> X and X -> c only.
    const e: Edge[] = [
      { id: 'eX', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
      { id: 'eXc', source: 'cus1', target: 'ctr1', joins: [{ sourceField: 'country_id', targetField: 'id' }] },
    ];
    const deep: JoinedSource = { aliasPath: 'y.country', martId: 'ctr1', label: 'Country', depth: 2, fields: [], uniqueCount: false, relationshipId: 'eYc' };
    const name = f('y__country__name', 'STRING', j('y.country', 'ctr1', 'name'));
    expect(run({ visible: ['id', 'y__country__name'], schema: [f('id', 'INTEGER'), name], sources: [{ ...deep, fields: [name] }], edges: e, titles: new Map([['ord1', 'Orders'], ['cus1', 'Customers'], ['ctr1', 'Country']]) })).toMatch(/^REASON A join could not be resolved$/);
  });

  test('an unresolved middle mart is named by its title when the model has it', () => {
    expect(run({ visible: ['id', 'customers__region__name'], edges: [...edges, { id: 'e9', source: 'itm1', target: 'reg1', joins: [{ sourceField: 'x', targetField: 'id' }] }], sources: [{ ...region([regionName]), relationshipId: undefined }] })).toBe('REASON The join to "Customers" could not be resolved');
  });

  test('a middle mart the source list lacks and no relationship names cannot be resolved', () => {
    expect(run({ visible: ['id', 'customers__region__name'], sources: [{ ...region([regionName]), relationshipId: undefined }], edges: [...edges, { id: 'e9', source: 'itm1', target: 'reg1', joins: [{ sourceField: 'x', targetField: 'id' }] }], titles: new Map() })).toBe('REASON A join could not be resolved');
  });
});
