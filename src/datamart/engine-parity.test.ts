import { describe, expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import type { ColumnFilter } from '../filters/build';
import type { Aggregation } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { SortKey } from '../model/sort';
import type { Edge, Field } from '../model/types';
import { buildMartSql } from './build-sql';
import type { Dialect } from './dialect';
import golden from './__golden__/engine-sql.json';

/** The engine's own SQL for each case, captured from the real dialect builders by scripts/engine-golden.cts (re-run it when the engine's blending code changes). */
const engine = golden as { case: string; dialect: Dialect; sql: string }[];
const DIALECTS: Dialect[] = ['bigquery', 'athena', 'snowflake', 'redshift', 'databricks'];

type PField = { name: string; alias: string; fn: string; raw: string; type?: string };
type PMart = { path: string; martId: string; label: string; edgeId: string; fields: PField[] };
type PCase = { id: string; marts: PMart[]; visible: string[]; filters: ColumnFilter[]; sorts?: SortKey[]; main: Field[]; aggregation?: Aggregation; /** Captured through the flat composer: a main-only grid. */ flat?: boolean };

const f = (name: string, type: string, joined?: Field['joined']): Field => ({ name, alias: null, type, category: categorizeFieldType(type), description: null, isPrimaryKey: false, ...(joined ? { joined } : {}) });
const MAIN = [f('id', 'INTEGER'), f('status', 'STRING'), f('customer_id', 'INTEGER')];
const MAIN_TYPES: Record<string, string> = { id: 'INTEGER', status: 'STRING', amount: 'INTEGER', created_at: 'TIMESTAMP', name: 'STRING', score: 'FLOAT', ts_a: 'TIMESTAMP', dt_b: 'DATETIME', d_c: 'DATE', ts_d: 'TIMESTAMP' };
/** Main fields in the order the case shows them, which is the schema order the grid sends. */
const mains = (...names: string[]): Field[] => names.map((n) => f(n, MAIN_TYPES[n]!));
const edges: Edge[] = [
  { id: 'e1', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'cus1', target: 'reg1', joins: [{ sourceField: 'region_id', targetField: 'id' }, { sourceField: 'country', targetField: 'country' }] },
  { id: 'e3', source: 'ord1', target: 'itm1', joins: [{ sourceField: 'id', targetField: 'order_id' }] },
  { id: 'ra', source: 'ord1', target: 'a1', joins: [{ sourceField: 'k', targetField: 'k' }] },
  { id: 'rb', source: 'a1', target: 'b1', joins: [{ sourceField: 'k', targetField: 'k' }] },
  { id: 'rc', source: 'b1', target: 'c1', joins: [{ sourceField: 'k', targetField: 'k' }] },
];
const cus = (fields: PField[]): PMart => ({ path: 'customers', martId: 'cus1', label: 'Customers', edgeId: 'e1', fields });
const itm = (fields: PField[]): PMart => ({ path: 'order_items', martId: 'itm1', label: 'Order Items', edgeId: 'e3', fields });
const reg = (fields: PField[]): PMart => ({ path: 'customers.region', martId: 'reg1', label: 'Region', edgeId: 'e2', fields });
const city: PField = { name: 'city', alias: 'customers__city', fn: 'STRING_AGG', raw: 'STRING' };
const sku: PField = { name: 'sku', alias: 'order_items__sku', fn: 'STRING_AGG', raw: 'STRING' };
const qty: PField = { name: 'quantity', alias: 'order_items__quantity', fn: 'SUM', raw: 'INTEGER' };
const rname: PField = { name: 'name', alias: 'customers_region__name', fn: 'STRING_AGG', raw: 'STRING' };

const cases: PCase[] = [
  { id: 'G1', marts: [], main: MAIN, visible: ['id'], filters: [{ field: 'status', op: 'eq', value: 'paid' }], sorts: [{ field: 'id', direction: 'asc' }] },
  {
    id: 'G2', marts: [cus([city]), itm([sku])], main: MAIN, visible: ['id', 'status', 'customers__city', 'order_items__sku'],
    filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }, { field: 'order_items__sku', op: 'is_blank' }, { field: 'customers__city', op: 'neq', value: 'Rome' }, { field: 'customers__city', op: 'not_contains', value: 'ar' }],
  },
  { id: 'G3', marts: [cus([city]), reg([rname])], main: MAIN, visible: ['customers__city', 'customers_region__name'], filters: [{ field: 'customers_region__name', op: 'eq', value: 'EU' }] },
  {
    id: 'G4',
    marts: [cus([
      { name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' },
      { name: 'cd', alias: 'customers__cd', fn: 'COUNT_DISTINCT', raw: 'STRING', type: 'INTEGER' },
      { name: 'av', alias: 'customers__av', fn: 'AVG', raw: 'INTEGER', type: 'FLOAT' },
      { name: 'as_', alias: 'customers__as', fn: 'ANY_VALUE', raw: 'STRING' },
      { name: 'ab', alias: 'customers__ab', fn: 'ANY_VALUE', raw: 'BOOLEAN' },
      { name: 'signup', alias: 'customers__signup', fn: 'MAX', raw: 'DATE' },
    ])],
    main: MAIN, visible: ['id', 'customers__n', 'customers__cd', 'customers__av', 'customers__as', 'customers__ab', 'customers__signup'],
    filters: [{ field: 'customers__signup', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } }, { field: 'customers__signup', op: 'relative', value: { kind: 'last_n_days', n: 7 } }, { field: 'customers__n', op: 'gt', value: 3 }],
  },
  { id: 'G5', marts: [cus([city]), itm([sku])], main: MAIN, visible: ['id'], filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }], sorts: [{ field: 'order_items__sku', direction: 'desc' }] },
  {
    id: 'G6',
    marts: [
      { path: 'a', martId: 'a1', label: 'A', edgeId: 'ra', fields: [] },
      { path: 'a.b', martId: 'b1', label: 'B', edgeId: 'rb', fields: [] },
      { path: 'a.b.c', martId: 'c1', label: 'C', edgeId: 'rc', fields: [{ name: 'n', alias: 'a_b_c__n', fn: 'COUNT', raw: 'INTEGER' }, { name: 'flag', alias: 'a_b_c__flag', fn: 'ANY_VALUE', raw: 'BOOLEAN' }] },
    ],
    main: MAIN, visible: ['a_b_c__n', 'a_b_c__flag'], filters: [{ field: 'a_b_c__n', op: 'gt', value: 1 }],
  },
  {
    id: 'G7', marts: [cus([city]), itm([sku, qty])], main: mains('status', 'amount', 'created_at'),
    visible: ['status', 'amount', 'created_at', 'customers__city', 'order_items__sku', 'order_items__quantity'],
    filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'SUM' }],
      dateTrunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    },
  },
  {
    id: 'G8', marts: [], main: mains('status', 'amount', 'name'), visible: ['status', 'amount', 'name'], filters: [],
    aggregation: {
      aggregations: [...['SUM', 'AVG', 'MIN', 'MAX', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'].map((fn) => ({ column: 'amount', function: fn })), ...['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'MIN'].map((fn) => ({ column: 'name', function: fn }))] as Aggregation['aggregations'],
      dateTrunc: [],
    },
    sorts: [{ field: 'status', direction: 'asc' }, { field: 'amount', direction: 'desc' }],
  },
  {
    id: 'G9', marts: [cus([{ name: 'signup', alias: 'customers__signup', fn: 'MAX', raw: 'DATE' }])], main: mains('ts_a', 'dt_b', 'd_c', 'ts_d', 'amount'),
    visible: ['ts_a', 'dt_b', 'd_c', 'ts_d', 'customers__signup', 'amount'], filters: [],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }],
      dateTrunc: [
        { column: 'ts_a', unit: 'MONTH', timeZone: 'Europe/Berlin' }, { column: 'dt_b', unit: 'DAY', timeZone: 'America/New_York' },
        { column: 'd_c', unit: 'WEEK' }, { column: 'ts_d', unit: 'YEAR' }, { column: 'customers__signup', unit: 'QUARTER' },
      ],
    },
  },
  {
    id: 'G10',
    marts: [
      cus([city, { name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' }, { name: 'tag', alias: 'customers__tag', fn: 'STRING_AGG', raw: 'STRING' }]),
      reg([{ name: 'code', alias: 'customers_region__code', fn: 'COUNT_DISTINCT', raw: 'STRING', type: 'INTEGER' }, { name: 'pop', alias: 'customers_region__pop', fn: 'SUM', raw: 'INTEGER' }]),
      itm([qty]),
    ],
    main: mains('status', 'score'),
    visible: ['status', 'score', 'customers__city', 'customers__n', 'customers__tag', 'customers_region__code', 'customers_region__pop', 'order_items__quantity'],
    filters: [{ field: 'customers_region__pop', op: 'eq', value: 5 }],
    aggregation: {
      aggregations: [
        { column: 'customers__n', function: 'COUNT' }, { column: 'customers__tag', function: 'STRING_AGG' }, { column: 'customers__tag', function: 'ANY_VALUE' },
        { column: 'customers_region__code', function: 'COUNT_DISTINCT' }, { column: 'customers_region__pop', function: 'SUM' },
        { column: 'order_items__quantity', function: 'P50' }, { column: 'order_items__quantity', function: 'AVG' },
      ],
      dateTrunc: [],
    },
    sorts: [{ field: 'status', direction: 'asc' }, { field: 'customers_region__pop', direction: 'desc' }],
  },
  {
    id: 'G11', marts: [itm([sku, qty])], main: mains('amount'), visible: ['amount', 'order_items__sku', 'order_items__quantity'], filters: [],
    aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'MAX' }], dateTrunc: [] },
  },
  { id: 'M1', flat: true, marts: [], main: mains('id', 'status'), visible: ['id', 'status'], filters: [{ field: 'status', op: 'eq', value: 'paid' }, { field: 'status', op: 'is_blank' }], sorts: [{ field: 'id', direction: 'desc' }] },
  {
    id: 'M2', flat: true, marts: [], main: mains('status', 'amount', 'created_at', 'name'), visible: ['status', 'amount', 'created_at', 'name'], filters: [{ field: 'status', op: 'eq', value: 'paid' }],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'P50' }, { column: 'name', function: 'COUNT_DISTINCT' }, { column: 'name', function: 'STRING_AGG' }],
      dateTrunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    },
    sorts: [{ field: 'amount', direction: 'desc' }],
  },
];

const pluginSql = (c: PCase, dialect: Dialect): string => {
  const joinedFields = c.marts.flatMap((m) => m.fields.map((x) => f(x.alias, x.type ?? x.raw, { martId: m.martId, label: m.label, aliasPath: m.path, originalName: x.name, aggregateFunction: x.fn, sourceType: x.raw })));
  const sources: JoinedSource[] = c.marts.map((m) => ({ aliasPath: m.path, martId: m.martId, label: m.label, depth: m.path.split('.').length, fields: joinedFields.filter((x) => x.joined!.aliasPath === m.path), uniqueCount: false, relationshipId: m.edgeId }));
  const r = buildMartSql({ dialect, main: { id: 'ord1', title: 'Orders' }, schema: [...c.main, ...joinedFields], visible: c.visible, filters: c.filters, ...(c.sorts ? { sorts: c.sorts } : {}), ...(c.aggregation ? { aggregation: c.aggregation } : {}), sources, edges, titles: new Map(c.marts.map((m) => [m.martId, m.label])).set('ord1', 'Orders') });
  if ('reason' in r) throw new Error(r.reason);
  return r.sql;
};


type Names = { main: string; cte: (path: string) => string; raw: (path: string) => string };
const engineNames: Names = { main: 'main', cte: (p) => p.replace(/\./g, '_'), raw: (p) => `${p.replace(/\./g, '_')}_raw` };
const pluginNames: Names = { main: 'base_owox', cte: (p) => `${p.replace(/\./g, '__')}_owox`, raw: (p) => `${p.replace(/\./g, '__')}_raw_owox` };

type Block = { name: string; body: string[] };

/** The engine spells an output `<column> | <TOKEN>`; the data mart spells it `<column>__<token>`. */
const relabel = (l: string) => l.replace(/([`"])([^`"|]+) \| ([A-Z0-9]+)\1/g, (_m, q: string, col: string, tok: string) => `${q}${col}__${tok.toLowerCase()}${q}`);

/** The `[Title](dm:id)` a line reads from. */
const martRefOf = (l: string) => /\[[^\]]*\]\(dm:\w+\)/.exec(l)?.[0];

/**
 * The shape both engines must agree on: per joined path its roll-ups, key, joins and source, every sleeve CTE line by line, then the outer query
 * with names abstracted. `quotes` keeps identifier quotes, so Snowflake's always-quote rule is compared too.
 */
function canon(sql: string, paths: string[], n: Names, quotes: boolean) {
  const lines = sql.split('\n').map((l) => relabel(l.trim())).map((l) => (quotes ? l : l.replace(/["`]/g, ''))).filter((l) => l && !l.startsWith('--'));
  const blocks: Block[] = [];
  let i = lines[0] === 'WITH' ? 1 : 0;
  while (i < lines.length) {
    const m = /^"?(\w+)"? AS \($/.exec(lines[i]!);
    if (!m) break;
    const body: string[] = [];
    i++;
    while (!/^\),?$/.test(lines[i]!)) body.push(lines[i++]!);
    blocks.push({ name: m[1]!, body });
    i++;
  }
  const outer = lines.slice(i);
  const bodies = new Map(blocks.map((b) => [b.name, b.body]));
  const q = quotes ? '"?' : '';
  const unq = (s: string) => s.replace(/(?:\b[A-Za-z_]\w*|"[^"]+")\./g, '');
  const token = new Map<string, string>([[n.main, 'MAIN'], ...paths.flatMap((p): [string, string][] => [[n.cte(p), `J(${p})`], [n.raw(p), `R(${p})`]])]);
  const names = [...token.keys()].sort((a, b) => b.length - a.length).join('|');
  const sleeves = blocks.filter((b) => b.name.startsWith('sleeve_'));
  const labelsOf = (body: string[]) => body.map((l) => /\bAS (\S+?),?$/.exec(l)?.[1]).filter((x): x is string => !!x && !/^"?_(owox_dim_\d+|oid\w*|val\w*)"?$/.test(x)).sort();
  const sleeveToken = new Map(sleeves.map((b): [string, string] => [b.name, `S(${labelsOf(b.body).join(',')})`]));
  const abstract = (s: string) => {
    let out = s.replace(new RegExp(`${q}\\b(${names})\\b${q}`, 'g'), (_x, name: string) => token.get(name)!);
    for (const [name, tok] of sleeveToken) out = out.replace(new RegExp(`${q}\\b${name}\\b${q}`, 'g'), tok);
    return out.replace(new RegExp(`${q}_dedup${q}`, 'g'), '_dedup');
  };
  // A raw mart join: the engine joins the `_raw` CTE and names its source in that CTE; the data mart joins the mart itself.
  const rawRef = new Map(paths.map((p) => [`R(${p})`, martRefOf((bodies.get(n.raw(p)) ?? []).find((l) => l.startsWith('FROM ')) ?? '')]));
  const joinLine = (l: string) => abstract(l).replace(/^LEFT JOIN (\[[^\]]*\]\(dm:\w+\)) AS (R\([^)]*\))/, 'LEFT JOIN $2=$1').replace(/^LEFT JOIN (R\([^)]*\))(?= ON| *$)/, (_m, r: string) => (rawRef.get(r) ? `LEFT JOIN ${r}=${rawRef.get(r)}` : _m)).replace(/\s+/g, ' ').trim();

  const perPath = paths.map((p) => {
    const dedup = bodies.get(n.cte(p))!;
    const joinedBody = bodies.get(`${n.cte(p)}_joined`) ?? dedup;
    const from = dedup.findIndex((l) => l.startsWith('FROM '));
    // A dedup CTE is only SELECT, its items, FROM, LEFT JOINs and GROUP BY: a WHERE or any other clause would be a filter inside a joined mart.
    expect(dedup[0]).toBe('SELECT');
    expect(from).toBeGreaterThan(1);
    expect(dedup.slice(from + 1).every((l) => l.startsWith('LEFT JOIN ') || l.startsWith('GROUP BY '))).toBe(true);
    expect(joinedBody.slice(1).filter((l) => /^(WHERE|HAVING|ORDER BY|LIMIT)\b/.test(l))).toEqual([]);
    const items = dedup.slice(1, from).map((l) => unq(l.replace(/,$/, ''))).sort();
    const groupBy = dedup.filter((l) => l.startsWith('GROUP BY ')).map(unq);
    const joins = joinedBody.filter((l) => l.startsWith('LEFT JOIN ')).map((l) => abstract(unq(l)));
    // The engine reads the mart in `_raw`, the data mart in the dedup CTE.
    const source = martRefOf((bodies.get(n.raw(p)) ?? dedup).find((l) => l.startsWith('FROM '))!);
    return { path: p, items, groupBy, joins, source };
  });

  // Sections of the outer query, found by the line each starts with.
  const sel = outer.findIndex((l) => l === 'SELECT');
  const fromAt = outer.findIndex((l) => l.startsWith('FROM '));
  const whereAt = outer.findIndex((l) => l.startsWith('WHERE '));
  const groupAt = outer.findIndex((l) => l.startsWith('GROUP BY'));
  const orderAt = outer.findIndex((l) => l.startsWith('ORDER BY'));
  const end = (at: number) => [whereAt, groupAt, orderAt].filter((x) => x > at).sort((a, b) => a - b)[0] ?? outer.length;
  const clean = (s: string) => abstract(s).replace(/\s+/g, ' ').trim();
  const items = outer.slice(sel + 1, fromAt).map((l) => clean(l.replace(/,$/, '')));
  const joins = outer.slice(fromAt + 1, whereAt >= 0 ? whereAt : end(fromAt));
  const where = whereAt >= 0 ? outer.slice(whereAt, end(whereAt)).map((l) => clean(l.replace(/^WHERE /, ''))) : [];
  const text = (at: number, word: string) => (at >= 0 ? clean(outer.slice(at, end(at)).join(' ').replace(new RegExp(`^${word}\\s*`), '')) : '');
  const mainBody = bodies.get(n.main);
  return {
    main: martRefOf(((mainBody ?? outer.slice(fromAt, fromAt + 1)).find((l) => l.startsWith('FROM ')) ?? outer[fromAt])!),
    perPath,
    sleeves: sleeves.map((b) => ({ token: sleeveToken.get(b.name)!, body: b.body.map(joinLine) })).sort((a, b) => a.token.localeCompare(b.token)),
    items, joins: joins.map(joinLine), where, groupBy: text(groupAt, 'GROUP BY'), orderBy: text(orderAt, 'ORDER BY'),
    // The columns are the same set, in the grid's order or the engine's.
    itemSet: [...items].sort(),
  };
}

/** A main-only grid reaches the engine through the flat composer, which has no CTEs and no table qualifiers on the main mart. */
function canonFlat(sql: string, quotes: boolean) {
  const lines = sql.split('\n').map((l) => relabel(l.trim())).map((l) => (quotes ? l : l.replace(/["`]/g, ''))).filter((l) => l && !l.startsWith('--'));
  const unq = (s: string) => s.replace(/(?:\b[A-Za-z_]\w*|"[^"]+")\./g, '').replace(/\s+/g, ' ').trim();
  // The mart is read once, by name, whether in the engine's FROM or the data mart's base CTE.
  const from = lines.findIndex((l) => l.startsWith('FROM '));
  const sel = lines.lastIndexOf('SELECT');
  const rest = lines.slice(from + 1).filter((l) => !l.startsWith('LEFT JOIN') && l !== ')');
  const at = (re: RegExp) => rest.findIndex((l) => re.test(l));
  const whereAt = at(/^WHERE /);
  const groupAt = at(/^GROUP BY/);
  const orderAt = at(/^ORDER BY/);
  const end = (x: number) => [whereAt, groupAt, orderAt].filter((y) => y > x).sort((a, b) => a - b)[0] ?? rest.length;
  const text = (x: number, word: string) => (x >= 0 ? unq(rest.slice(x, end(x)).join(' ').replace(new RegExp(`^${word}\\s*`), '')) : '');
  return {
    items: lines.slice(sel + 1, lines.findIndex((l, i) => i > sel && l.startsWith('FROM '))).map((l) => unq(l.replace(/,$/, '')).replace(/^(\S+) AS \1$/, '$1')),
    where: whereAt >= 0 ? rest.slice(whereAt, end(whereAt)).map((l) => unq(l.replace(/^WHERE /, ''))) : [],
    groupBy: text(groupAt, 'GROUP BY'),
    orderBy: text(orderAt, 'ORDER BY'),
  };
}

const flatMartRef = (sql: string, isEngine: boolean) => {
  const lines = sql.split('\n').map((l) => l.trim());
  // The data mart's base CTE reads the mart; the engine's flat query reads it in its only FROM.
  const at = isEngine ? lines.findIndex((l) => l.startsWith('FROM ')) : lines.findIndex((l) => l === 'SELECT *') + 1;
  return martRefOf(lines[at]!);
};

describe('the plugin SQL matches the engine SQL', () => {
  test('every case was captured in every dialect', () => {
    expect(engine).toHaveLength(cases.length * DIALECTS.length);
  });
  for (const c of cases) {
    for (const dialect of DIALECTS) {
      test(`${c.id} on ${dialect}`, () => {
        const paths = c.marts.map((m) => m.path);
        const theirs = engine.find((x) => x.case === c.id && x.dialect === dialect)!.sql;
        const ours = pluginSql(c, dialect);
        if (c.flat) {
          expect(canonFlat(ours, false)).toEqual(canonFlat(theirs, false));
          expect(flatMartRef(ours, false)).toBe(flatMartRef(theirs, true));
          return;
        }
        const a = canon(ours, paths, pluginNames, false);
        const b = canon(theirs, paths, engineNames, false);
        // The outer SELECT lists the same columns; a grouped query may order them differently (the engine puts sleeve pulls last).
        const grouped = !!c.aggregation;
        expect({ ...a, items: grouped ? a.itemSet : a.items }).toEqual({ ...b, items: grouped ? b.itemSet : b.items });
      });
    }
  }
  // Snowflake's always-quote rule: identifier quotes are kept in the comparison, so a bare column where the engine quotes one fails.
  for (const c of cases.filter((x) => !x.flat)) {
    test(`${c.id} on snowflake with identifier quotes kept`, () => {
      const paths = c.marts.map((m) => m.path);
      const theirs = engine.find((x) => x.case === c.id && x.dialect === 'snowflake')!.sql;
      const grouped = !!c.aggregation;
      const a = canon(pluginSql(c, 'snowflake'), paths, pluginNames, true);
      const b = canon(theirs, paths, engineNames, true);
      expect({ ...a, items: grouped ? a.itemSet : a.items }).toEqual({ ...b, items: grouped ? b.itemSet : b.items });
    });
  }
  for (const c of cases.filter((x) => x.flat)) {
    test(`${c.id} on snowflake with identifier quotes kept`, () => {
      const theirs = engine.find((x) => x.case === c.id && x.dialect === 'snowflake')!.sql;
      expect(canonFlat(pluginSql(c, 'snowflake'), true)).toEqual(canonFlat(theirs, true));
    });
  }
});
