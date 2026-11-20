/**
 * Captures the real OWOX dialect builders' SQL for the engine parity tests (src/datamart/engine-parity.test.ts).
 * Writes src/datamart/__golden__/engine-sql.json. Re-run it whenever the engine's blending code changes.
 *
 * It needs a sibling checkout of the OWOX engine at ../owox-data-marts (read only; nothing is written there).
 * Run from that checkout's apps/backend folder:
 *
 *   cd ../owox-data-marts/apps/backend
 *   NODE_PATH=$PWD/node_modules:$PWD/../../node_modules TS_NODE_PROJECT=$PWD/tsconfig.json \
 *     npx ts-node -r tsconfig-paths/register --transpile-only ../../../data-explorer/scripts/engine-golden.cts
 *
 * The file is .cts because this repo is "type": "module" and ts-node would otherwise load it as ESM.
 */
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ENGINE = resolve(__dirname, '../../owox-data-marts/apps/backend/src/data-marts');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const engine = (path: string): Record<string, any> => require(join(ENGINE, path));
const { makeChain, makeRelationship, createBuildContext } = engine('data-storage-types/interfaces/__fixtures__/blended-query-builder-fixtures');
const { BigQueryBlendedQueryBuilder } = engine('data-storage-types/bigquery/services/bigquery-blended-query-builder');
const { BigQueryClauseRenderer } = engine('data-storage-types/bigquery/services/bigquery-clause-renderer');
const { AthenaBlendedQueryBuilder } = engine('data-storage-types/athena/services/athena-blended-query-builder');
const { AthenaClauseRenderer } = engine('data-storage-types/athena/services/athena-clause-renderer');
const { SnowflakeBlendedQueryBuilder } = engine('data-storage-types/snowflake/services/snowflake-blended-query-builder');
const { SnowflakeClauseRenderer } = engine('data-storage-types/snowflake/services/snowflake-clause-renderer');
const { RedshiftBlendedQueryBuilder } = engine('data-storage-types/redshift/services/redshift-blended-query-builder');
const { RedshiftClauseRenderer } = engine('data-storage-types/redshift/services/redshift-clause-renderer');
const { DatabricksBlendedQueryBuilder } = engine('data-storage-types/databricks/services/databricks-blended-query-builder');
const { DatabricksClauseRenderer } = engine('data-storage-types/databricks/services/databricks-clause-renderer');
const { inlineBigQueryNamedParams } = engine('data-storage-types/bigquery/adapters/bigquery-execution-parameters.utils');
const { inlineAthenaPositionalParams } = engine('data-storage-types/athena/adapters/athena-execution-parameters.utils');

const { BigQueryQueryBuilder } = engine('data-storage-types/bigquery/services/bigquery-query.builder');
const { AthenaQueryBuilder } = engine('data-storage-types/athena/services/athena-query.builder');
const { SnowflakeQueryBuilder } = engine('data-storage-types/snowflake/services/snowflake-query.builder');
const { RedshiftQueryBuilder } = engine('data-storage-types/redshift/services/redshift-query.builder');
const { DatabricksQueryBuilder } = engine('data-storage-types/databricks/services/databricks-query.builder');

type Join = { sourceFieldName: string; targetFieldName: string };
type Field = { name: string; alias: string; fn: string; rawType: string; hidden?: boolean };
type Mart = { alias: string; parent: string; table: string; joins: Join[]; fields: Field[]; path?: string };

const MAIN = '[Orders](dm:ord1)';
const eq = (column: string, value: unknown) => ({ column, operator: 'eq', value });

type Agg = { column: string; function: string };
type Trunc = { column: string; unit: string; timeZone?: string };
type Case = {
  id: string; marts: Mart[]; columns: string[]; types: Record<string, string>; filters: unknown[];
  sort?: { column: string; direction: 'asc' | 'desc' }[]; agg?: Agg[]; trunc?: Trunc[];
  /** Captured through the flat ReportSqlComposerService path (a main-only grid), not buildBlendedQuery. */
  flat?: boolean;
};

const cus = (fields: Field[]): Mart => ({ alias: 'customers', parent: 'main', table: '[Customers](dm:cus1)', joins: [{ sourceFieldName: 'customer_id', targetFieldName: 'id' }], fields });
const itm = (fields: Field[]): Mart => ({ alias: 'order_items', parent: 'main', table: '[Order Items](dm:itm1)', joins: [{ sourceFieldName: 'id', targetFieldName: 'order_id' }], fields });
const reg = (fields: Field[]): Mart => ({ alias: 'region', parent: 'customers', path: 'customers.region', table: '[Region](dm:reg1)', joins: [{ sourceFieldName: 'region_id', targetFieldName: 'id' }, { sourceFieldName: 'country', targetFieldName: 'country' }], fields });
const city: Field = { name: 'city', alias: 'customers__city', fn: 'STRING_AGG', rawType: 'STRING' };
const sku: Field = { name: 'sku', alias: 'order_items__sku', fn: 'STRING_AGG', rawType: 'STRING' };
const qty: Field = { name: 'quantity', alias: 'order_items__quantity', fn: 'SUM', rawType: 'INTEGER' };
const rname: Field = { name: 'name', alias: 'customers_region__name', fn: 'STRING_AGG', rawType: 'STRING' };
const MAIN_TYPES = { id: 'INTEGER', status: 'STRING', amount: 'INTEGER', created_at: 'TIMESTAMP' };

const cases: Case[] = [
  { id: 'G1', marts: [], columns: ['id'], types: { id: 'INTEGER', status: 'STRING' }, filters: [eq('status', 'paid')], sort: [{ column: 'id', direction: 'asc' }] },
  {
    id: 'G2', marts: [cus([city]), itm([sku])], columns: ['id', 'status', 'customers__city', 'order_items__sku'],
    types: { id: 'INTEGER', status: 'STRING', customers__city: 'STRING', order_items__sku: 'STRING' },
    filters: [eq('customers__city', 'Paris'), { column: 'order_items__sku', operator: 'is_blank' }, { column: 'customers__city', operator: 'neq', value: 'Rome' }, { column: 'customers__city', operator: 'not_contains', value: 'ar' }],
  },
  { id: 'G3', marts: [cus([city]), reg([rname])], columns: ['customers__city', 'customers_region__name'], types: { customers__city: 'STRING', customers_region__name: 'STRING' }, filters: [eq('customers_region__name', 'EU')] },
  {
    id: 'G4', marts: [cus([
      { name: 'n', alias: 'customers__n', fn: 'COUNT', rawType: 'STRING' },
      { name: 'cd', alias: 'customers__cd', fn: 'COUNT_DISTINCT', rawType: 'STRING' },
      { name: 'av', alias: 'customers__av', fn: 'AVG', rawType: 'INTEGER' },
      { name: 'as_', alias: 'customers__as', fn: 'ANY_VALUE', rawType: 'STRING' },
      { name: 'ab', alias: 'customers__ab', fn: 'ANY_VALUE', rawType: 'BOOLEAN' },
      { name: 'signup', alias: 'customers__signup', fn: 'MAX', rawType: 'DATE' },
    ])],
    columns: ['id', 'customers__n', 'customers__cd', 'customers__av', 'customers__as', 'customers__ab', 'customers__signup'],
    types: { id: 'INTEGER', customers__n: 'INTEGER', customers__cd: 'INTEGER', customers__av: 'FLOAT', customers__as: 'STRING', customers__ab: 'BOOLEAN', customers__signup: 'DATE' },
    filters: [{ column: 'customers__signup', operator: 'between', value: { from: '2026-01-01', to: '2026-01-31' } }, { column: 'customers__signup', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }, { column: 'customers__n', operator: 'gt', value: 3 }],
  },
  { id: 'G5', marts: [cus([city]), itm([sku])], columns: ['id'], types: { id: 'INTEGER', customers__city: 'STRING', order_items__sku: 'STRING' }, filters: [eq('customers__city', 'Paris')], sort: [{ column: 'order_items__sku', direction: 'desc' }] },
  {
    id: 'G6', marts: [
      { alias: 'a', parent: 'main', table: '[A](dm:a1)', joins: [{ sourceFieldName: 'k', targetFieldName: 'k' }], fields: [] },
      { alias: 'b', parent: 'a', path: 'a.b', table: '[B](dm:b1)', joins: [{ sourceFieldName: 'k', targetFieldName: 'k' }], fields: [] },
      { alias: 'c', parent: 'a_b', path: 'a.b.c', table: '[C](dm:c1)', joins: [{ sourceFieldName: 'k', targetFieldName: 'k' }], fields: [{ name: 'n', alias: 'a_b_c__n', fn: 'COUNT', rawType: 'INTEGER' }, { name: 'flag', alias: 'a_b_c__flag', fn: 'ANY_VALUE', rawType: 'BOOLEAN' }] },
    ],
    columns: ['a_b_c__n', 'a_b_c__flag'], types: { a_b_c__n: 'INTEGER', a_b_c__flag: 'BOOLEAN' }, filters: [{ column: 'a_b_c__n', operator: 'gt', value: 1 }],
  },
  {
    // Spec 8.6: a bucket in a zone, a main SUM, a joined COUNT_DISTINCT and a joined SUM, one joined key and a filter on it.
    id: 'G7', marts: [cus([city]), itm([sku, qty])],
    columns: ['status', 'amount', 'created_at', 'customers__city', 'order_items__sku', 'order_items__quantity'],
    types: { ...MAIN_TYPES, customers__city: 'STRING', order_items__sku: 'STRING', order_items__quantity: 'INTEGER' },
    filters: [eq('customers__city', 'Paris')],
    agg: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'SUM' }],
    trunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
  },
  {
    // Main-only grouping with every function, through the blended builder with no chains.
    id: 'G8', marts: [], columns: ['status', 'amount', 'name'],
    types: { status: 'STRING', amount: 'INTEGER', name: 'STRING' }, filters: [],
    agg: ['SUM', 'AVG', 'MIN', 'MAX', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'].map((fn) => ({ column: 'amount', function: fn }))
      .concat(['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'MIN'].map((fn) => ({ column: 'name', function: fn }))),
    sort: [{ column: 'status', direction: 'asc' }, { column: 'amount', direction: 'desc' }],
  },
  {
    // Buckets: TIMESTAMP and DATETIME with a zone, DATE, TIMESTAMP without a zone, and a joined DATE.
    id: 'G9', marts: [cus([{ name: 'signup', alias: 'customers__signup', fn: 'MAX', rawType: 'DATE' }])],
    columns: ['ts_a', 'dt_b', 'd_c', 'ts_d', 'customers__signup', 'amount'],
    types: { ts_a: 'TIMESTAMP', dt_b: 'DATETIME', d_c: 'DATE', ts_d: 'TIMESTAMP', customers__signup: 'DATE', amount: 'INTEGER' }, filters: [],
    agg: [{ column: 'amount', function: 'SUM' }],
    trunc: [
      { column: 'ts_a', unit: 'MONTH', timeZone: 'Europe/Berlin' }, { column: 'dt_b', unit: 'DAY', timeZone: 'America/New_York' },
      { column: 'd_c', unit: 'WEEK' }, { column: 'ts_d', unit: 'YEAR' }, { column: 'customers__signup', unit: 'QUARTER' },
    ],
  },
  {
    // Depth 2 COUNT_DISTINCT and SUM, a depth-1 COUNT and ANY_VALUE in the outer query, value sleeves with STRING_AGG, P50 and AVG on one column, a float key.
    id: 'G10', marts: [
      cus([city, { name: 'n', alias: 'customers__n', fn: 'COUNT', rawType: 'STRING' }, { name: 'tag', alias: 'customers__tag', fn: 'STRING_AGG', rawType: 'STRING' }]),
      reg([{ name: 'code', alias: 'customers_region__code', fn: 'COUNT_DISTINCT', rawType: 'STRING' }, { name: 'pop', alias: 'customers_region__pop', fn: 'SUM', rawType: 'INTEGER' }]),
      itm([qty]),
    ],
    columns: ['status', 'score', 'customers__city', 'customers__n', 'customers__tag', 'customers_region__code', 'customers_region__pop', 'order_items__quantity'],
    types: { status: 'STRING', score: 'FLOAT', customers__city: 'STRING', customers__n: 'INTEGER', customers__tag: 'STRING', customers_region__code: 'INTEGER', customers_region__pop: 'INTEGER', order_items__quantity: 'INTEGER' },
    filters: [eq('customers_region__pop', 5)],
    agg: [
      { column: 'customers__n', function: 'COUNT' }, { column: 'customers__tag', function: 'STRING_AGG' }, { column: 'customers__tag', function: 'ANY_VALUE' },
      { column: 'customers_region__code', function: 'COUNT_DISTINCT' }, { column: 'customers_region__pop', function: 'SUM' },
      { column: 'order_items__quantity', function: 'P50' }, { column: 'order_items__quantity', function: 'AVG' },
    ],
    sort: [{ column: 'status', direction: 'asc' }, { column: 'customers_region__pop', direction: 'desc' }],
  },
  {
    // No group keys: every sleeve is attached with a CROSS JOIN.
    id: 'G11', marts: [itm([sku, qty])], columns: ['amount', 'order_items__sku', 'order_items__quantity'],
    types: { amount: 'INTEGER', order_items__sku: 'STRING', order_items__quantity: 'INTEGER' }, filters: [],
    agg: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'MAX' }],
  },
  // Main-only grids reach the engine through the flat composer, not buildBlendedQuery (stream-http-data.service.ts:509-514).
  { id: 'M1', flat: true, marts: [], columns: ['id', 'status'], types: { id: 'INTEGER', status: 'STRING', amount: 'INTEGER' }, filters: [eq('status', 'paid'), { column: 'status', operator: 'is_blank' }], sort: [{ column: 'id', direction: 'desc' }] },
  {
    id: 'M2', flat: true, marts: [], columns: ['status', 'amount', 'created_at', 'name'],
    types: { status: 'STRING', amount: 'INTEGER', created_at: 'TIMESTAMP', name: 'STRING' }, filters: [eq('status', 'paid')],
    agg: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'P50' }, { column: 'name', function: 'COUNT_DISTINCT' }, { column: 'name', function: 'STRING_AGG' }],
    trunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    sort: [{ column: 'amount', direction: 'desc' }],
  },
];

const blended = {
  bigquery: () => new BigQueryBlendedQueryBuilder(new BigQueryClauseRenderer()),
  athena: () => new AthenaBlendedQueryBuilder(new AthenaClauseRenderer()),
  snowflake: () => new SnowflakeBlendedQueryBuilder(new SnowflakeClauseRenderer()),
  redshift: () => new RedshiftBlendedQueryBuilder(new RedshiftClauseRenderer()),
  databricks: () => new DatabricksBlendedQueryBuilder(new DatabricksClauseRenderer()),
} as const;
const flat = {
  bigquery: () => new BigQueryQueryBuilder(new BigQueryClauseRenderer()),
  athena: () => new AthenaQueryBuilder(new AthenaClauseRenderer()),
  snowflake: () => new SnowflakeQueryBuilder(new SnowflakeClauseRenderer()),
  redshift: () => new RedshiftQueryBuilder(new RedshiftClauseRenderer()),
  databricks: () => new DatabricksQueryBuilder(new DatabricksClauseRenderer()),
} as const;

type Built = { sql: string; params: { name: string; value: unknown }[] };

/** The alias path of a mart: the joins' own path when given, else its alias under main. */
const pathOf = (m: Mart) => m.path ?? m.alias;

async function main() {
  const out: { case: string; dialect: string; sql: string }[] = [];
  for (const c of cases) {
    for (const dialect of Object.keys(blended) as (keyof typeof blended)[]) {
      let built: Built;
      if (c.flat) {
        const builder = flat[dialect]() as { buildQuery: (d: unknown, o: unknown) => Promise<Built | string> };
        const r = await builder.buildQuery({ type: 'sql', sqlQuery: 'SELECT 1' }, {
          columns: c.columns, filters: c.filters, sort: c.sort, aggregations: c.agg, dateTruncs: c.trunc,
          mainTableReference: MAIN, columnTypes: new Map(Object.entries(c.types)),
        });
        built = typeof r === 'string' ? { sql: r, params: [] } : r;
      } else {
        const chains = c.marts.map((m) => makeChain({
          relationship: makeRelationship({ targetAlias: m.alias, joinConditions: m.joins }),
          targetTableReference: m.table, parentAlias: m.parent,
          blendedFields: m.fields.map((x) => ({ targetFieldName: x.name, outputAlias: x.alias, isHidden: false, aggregateFunction: x.fn, targetFieldType: x.rawType })),
        }));
        const fieldIndex = new Map(c.marts.flatMap((m) => m.fields.map((x) => [x.alias, {
          aliasPath: pathOf(m), cteName: pathOf(m).replace(/\./g, '_'), originalFieldName: x.name, type: c.types[x.alias]!, sourceFieldType: x.rawType, isIncluded: true,
        }] as const)));
        const ctx = {
          ...createBuildContext(MAIN)(chains, c.columns),
          filters: c.filters, sort: c.sort, aggregations: c.agg, dateTruncs: c.trunc, fieldIndex,
          columnTypes: { postJoin: new Map(Object.entries(c.types)) },
        };
        built = blended[dialect]().buildBlendedQuery(ctx);
      }
      let sql = built.sql;
      if (dialect === 'bigquery') sql = inlineBigQueryNamedParams(sql, built.params);
      if (dialect === 'athena') sql = inlineAthenaPositionalParams(sql, built.params);
      out.push({ case: c.id, dialect, sql });
    }
  }
  writeFileSync(resolve(__dirname, '../src/datamart/__golden__/engine-sql.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${out.length} captures`);
}

main().catch((e) => { console.error(e); process.exit(1); });
