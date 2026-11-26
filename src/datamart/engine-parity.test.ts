import { describe, expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import { buildMartSql } from './build-sql';
import type { Dialect } from './dialect';
import { cases, edges, joinedFieldsOf, schemaOf, type PCase } from './__golden__/cases';
import golden from './__golden__/engine-sql.json';

/** The engine's own SQL for each case, captured from the real dialect builders by scripts/engine-golden.cts (re-run it when the engine's blending code changes). */
const engine = golden as { case: string; dialect: Dialect; sql: string }[];
const DIALECTS: Dialect[] = ['bigquery', 'athena', 'snowflake', 'redshift', 'databricks'];

const pluginSql = (c: PCase, dialect: Dialect): string => {
  const joinedFields = joinedFieldsOf(c);
  const sources: JoinedSource[] = c.marts.map((m) => ({ aliasPath: m.path, martId: m.martId, label: m.label, depth: m.path.split('.').length, fields: joinedFields.filter((x) => x.joined!.aliasPath === m.path), uniqueCount: false, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown', relationshipId: m.edgeId }));
  const r = buildMartSql({ dialect, main: { id: 'ord1', title: 'Orders' }, schema: schemaOf(c), visible: c.visible, filters: c.filters, ...(c.slices ? { slices: c.slices } : {}), ...(c.sorts ? { sorts: c.sorts } : {}), ...(c.aggregation ? { aggregation: c.aggregation } : {}), sources, edges, titles: new Map(c.marts.map((m) => [m.martId, m.label])).set('ord1', 'Orders') });
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

/** The paths a case slices: a field named `<path with underscores>__<name>` belongs to that path. */
const slicedPaths = (c: PCase): Set<string> => new Set(c.marts.map((m) => m.path).filter((p) => (c.slices ?? []).some((x) => x.field.startsWith(`${p.replaceAll('.', '_')}__`))));

/**
 * The shape both engines must agree on: per joined path its roll-ups, key, joins and source, every sleeve CTE line by line, then the outer query
 * with names abstracted. `quotes` keeps identifier quotes, so Snowflake's always-quote rule is compared too.
 */
function canon(sql: string, paths: string[], n: Names, quotes: boolean, sliced: ReadonlySet<string> = new Set()) {
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
  const unqAll = (s: string) => s.replace(/(?:\b[A-Za-z_]\w*|"[^"]+")\./g, '').replace(/\s+/g, ' ').trim();
  /** The slice predicates a raw body filters its mart by, as one text. */
  const sliceText = (body: string[]) => {
    const at = body.findIndex((l) => l.startsWith('WHERE '));
    return at < 0 ? '' : unqAll(body.slice(at).filter((l) => /^(WHERE|AND) /.test(l)).map((l) => l.replace(/^(WHERE|AND) /, '')).join(' AND '));
  };
  const rawRef = new Map(paths.map((p) => {
    const body = bodies.get(n.raw(p)) ?? [];
    const ref = martRefOf(body.find((l) => l.startsWith('FROM ')) ?? '');
    return [`R(${p})`, ref && sliceText(body) ? `${ref} WHERE ${sliceText(body)}` : ref];
  }));
  // The data mart's sliced raw join is a filtered derived table; the engine's is its filtered raw CTE.
  const derived = (l: string) => l.replace(/^LEFT JOIN \(SELECT \* FROM (\[[^\]]*\]\(dm:\w+\)) AS t WHERE (.*)\) AS (R\([^)]*\))/, (_m, ref: string, pred: string, r: string) => `LEFT JOIN ${r}=${ref} WHERE ${unqAll(pred)}`);
  const joinLine = (l: string) => derived(abstract(l)).replace(/^LEFT JOIN (\[[^\]]*\]\(dm:\w+\)) AS (R\([^)]*\))/, 'LEFT JOIN $2=$1').replace(/^LEFT JOIN (R\([^)]*\))(?= ON| *$)/, (_m, r: string) => (rawRef.get(r) ? `LEFT JOIN ${r}=${rawRef.get(r)}` : _m)).replace(/\s+/g, ' ').trim();

  const perPath = paths.map((p) => {
    const dedup = bodies.get(n.cte(p))!;
    const joinedBody = bodies.get(`${n.cte(p)}_joined`) ?? dedup;
    const from = dedup.findIndex((l) => l.startsWith('FROM '));
    // A dedup CTE is only SELECT, its items, FROM, LEFT JOINs, a WHERE that holds the path's slices, and GROUP BY.
    expect(dedup[0]).toBe('SELECT');
    expect(from).toBeGreaterThan(1);
    expect(dedup.slice(from + 1).every((l) => /^(LEFT JOIN|WHERE|AND|GROUP BY) /.test(l))).toBe(true);
    // A `_joined` body has no WHERE of its own either, unless a slice on this path puts its predicates there.
    expect(joinedBody.slice(1).filter((l) => (sliced.has(p) ? /^(HAVING|ORDER BY|LIMIT)\b/ : /^(WHERE|HAVING|ORDER BY|LIMIT)\b/).test(l))).toEqual([]);
    // The engine filters the raw CTE, the data mart its dedup CTE: the same predicates on the same mart rows.
    const slice = sliceText(bodies.get(n.raw(p)) ?? dedup);
    const items = dedup.slice(1, from).map((l) => unq(l.replace(/,$/, ''))).sort();
    const groupBy = dedup.filter((l) => l.startsWith('GROUP BY ')).map(unq);
    const joins = joinedBody.filter((l) => l.startsWith('LEFT JOIN ')).map((l) => abstract(unq(l)));
    // The engine reads the mart in `_raw`, the data mart in the dedup CTE.
    const source = martRefOf((bodies.get(n.raw(p)) ?? dedup).find((l) => l.startsWith('FROM '))!);
    return { path: p, items, groupBy, joins, source, slice };
  });

  // Sections of the outer query, found by the line each starts with.
  const sel = outer.findIndex((l) => l === 'SELECT');
  const fromAt = outer.findIndex((l) => l.startsWith('FROM '));
  const whereAt = outer.findIndex((l) => l.startsWith('WHERE '));
  const groupAt = outer.findIndex((l) => l.startsWith('GROUP BY'));
  const orderAt = outer.findIndex((l) => l.startsWith('ORDER BY'));
  const havingAt = outer.findIndex((l) => l.startsWith('HAVING '));
  const end = (at: number) => [whereAt, groupAt, havingAt, orderAt].filter((x) => x > at).sort((a, b) => a - b)[0] ?? outer.length;
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
    items, joins: joins.map(joinLine), where, groupBy: text(groupAt, 'GROUP BY'), having: text(havingAt, 'HAVING'), orderBy: text(orderAt, 'ORDER BY'),
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
        const a = canon(ours, paths, pluginNames, false, slicedPaths(c));
        const b = canon(theirs, paths, engineNames, false, slicedPaths(c));
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
      const a = canon(pluginSql(c, 'snowflake'), paths, pluginNames, true, slicedPaths(c));
      const b = canon(theirs, paths, engineNames, true, slicedPaths(c));
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
