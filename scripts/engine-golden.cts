/**
 * Captures the real OWOX dialect builders' SQL for the engine parity tests (src/datamart/engine-parity.test.ts).
 * The cases live in src/datamart/__golden__/cases.ts, shared with that test; `engineCase` below derives the engine's shape.
 * ENGINE_DIR overrides the engine's src/data-marts folder when the checkout is not a sibling.
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
import type { ColumnFilter } from '../src/filters/build';
import type { PCase } from '../src/datamart/__golden__/cases';

const ENGINE = process.env.ENGINE_DIR ?? resolve(__dirname, '../../owox-data-marts/apps/backend/src/data-marts');
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

/**
 * The plugin's own modules are ESM, and ts-node loads this file as CJS, so it cannot `require` them. The engine checkout's esbuild (on NODE_PATH) bundles the
 * shared cases module (and the filter builder) into one CommonJS blob, which is evaluated here: the cases are read, not copied.
 */
function plugin(): { cases: PCase[]; edges: { id: string; joins: { sourceField: string; targetField: string }[] }[]; schemaOf: (c: PCase) => { name: string; type: string }[]; toTraverseFilters: (schema: unknown, filters: ColumnFilter[], slices: ColumnFilter[], aggregations: unknown[]) => unknown[] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildSync } = require('esbuild') as typeof import('esbuild');
  const entry = `export { cases, edges, schemaOf } from './src/datamart/__golden__/cases'; export { toTraverseFilters } from './src/filters/build';`;
  const out = buildSync({ stdin: { contents: entry, resolveDir: resolve(__dirname, '..'), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false });
  const mod = { exports: {} as never };
  new Function('module', 'exports', 'require', out.outputFiles[0]!.text)(mod, mod.exports, require);
  return mod.exports;
}
const { cases: planCases, edges, schemaOf, toTraverseFilters } = plugin();

type Agg = { column: string; function: string };
type Trunc = { column: string; unit: string; timeZone?: string };
/** A case in the engine's shape, derived from the plugin's case by `engineCase`. */
type Case = {
  id: string; marts: Mart[]; columns: string[]; types: Record<string, string>; filters: unknown[];
  sort?: { column: string; direction: 'asc' | 'desc' }[]; agg?: Agg[]; trunc?: Trunc[];
  /** Captured through the flat ReportSqlComposerService path (a main-only grid), not buildBlendedQuery. */
  flat?: boolean;
};

/** The one mapper from the plugin's case (src/datamart/__golden__/cases.ts, which the parity test also reads) to what the engine's builders take. */
function engineCase(c: PCase): Case {
  const schema = schemaOf(c);
  const marts = c.marts.map((m): Mart => {
    const parts = m.path.split('.');
    const edge = edges.find((e) => e.id === m.edgeId)!;
    return {
      alias: parts[parts.length - 1]!, parent: parts.length > 1 ? parts.slice(0, -1).join('_') : 'main', ...(parts.length > 1 ? { path: m.path } : {}),
      table: `[${m.label}](dm:${m.martId})`, joins: edge.joins.map((j) => ({ sourceFieldName: j.sourceField, targetFieldName: j.targetField })),
      fields: m.fields.map((x) => ({ name: x.name, alias: x.alias, fn: x.fn, rawType: x.raw })),
    };
  });
  return {
    id: c.id, marts, columns: c.visible, types: Object.fromEntries(schema.map((x) => [x.name, x.type])),
    filters: toTraverseFilters(schema, c.filters, c.slices ?? [], c.aggregation?.aggregations ?? []),
    ...(c.sorts ? { sort: c.sorts.map((x) => ({ column: x.field, direction: x.direction })) } : {}),
    ...(c.aggregation?.aggregations.length ? { agg: c.aggregation.aggregations.map((x) => ({ column: x.column, function: x.function })) } : {}),
    ...(c.aggregation?.dateTrunc.length ? { trunc: c.aggregation.dateTrunc } : {}),
    ...(c.flat ? { flat: true } : {}),
  };
}
const cases: Case[] = planCases.map(engineCase);

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
