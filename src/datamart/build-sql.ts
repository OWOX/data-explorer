import type { JoinedSource } from '../api/blendable';
import { isArrayType } from '../api/blendable';
import type { ColumnFilter } from '../filters/build';
import { isComplete } from '../filters/build';
import { havingField, sliceField } from '../filters/slice';
import type { Aggregation } from '../model/aggregation';
import { AGG_TOKENS, isGrouped, keepVisible } from '../model/aggregation';
import type { AggFn } from '../model/aggregation';
import { errorMessage } from '../model/guards';
import type { SortKey } from '../model/sort';
import type { Edge, Field, Schema } from '../model/types';
import { parentPath } from '../state/join-plan';
import type { Dialect, JoinFn } from './dialect';
import { aggregate, anyValue, dateTrunc, fieldRef, ident, isFloat, isJoinFn, leafFn, nullSafeOn, passFn, renderFilter, reportAggregate } from './dialect';

export type MartSqlInput = {
  dialect: Dialect;
  main: { id: string; title: string };
  /** The main grid's schema: main fields and joined fields (a joined field has `joined`). */
  schema: Schema;
  /** Shown columns, in grid order. */
  visible: string[];
  /** The grid's filters: a filter with `fn` is a HAVING filter on that aggregate. */
  filters: ColumnFilter[];
  /** Each slice filters a joined mart's raw rows before its join. */
  slices?: ColumnFilter[];
  /** The member's own sort order; when non-empty the SQL ends with an ORDER BY. */
  sorts?: SortKey[];
  /** The grid's functions and date buckets; when it groups, the data mart groups the same way. */
  aggregation?: Aggregation;
  /** The main mart's joined sources (`BlendableLoader.get(mainId)`). */
  sources: JoinedSource[];
  /** The model's edges (`model.edges`). */
  edges: Edge[];
  /** Mart titles by id, for reference labels. */
  titles: Map<string, string>;
};

/** What every CTE and alias name ends in, so no reserved word can clash. */
const CTE_SUFFIX = '_owox';

/** A reference to a data mart where a table name goes; the title is escaped as the OWOX backend reads it. */
const martRef = (id: string, title: string) => `[${title.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}](dm:${id})`;

/** A mart id is safe inside a reference only when it is plain. */
const safeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

/** The first segment of an alias path: the depth-1 join it hangs under. */
const rootOf = (path: string) => path.split('.')[0]!;

/** A name that needs no quoting as a CTE or alias. */
const plainName = (s: string) => /^[a-z_][a-z0-9_]*$/.test(s);
/** Each item on its own line, indented, joined by commas. */
const lines = (items: string[], indent: number) => items.map((x) => ' '.repeat(indent) + x).join(',\n');
/** The join condition between two aliases along an edge: the source fields on the left, the target fields on the right. */
const on = (d: Dialect, left: string, right: string, edge: Edge) => edge.joins.map((j) => `${left}.${fieldRef(d, j.sourceField)} = ${right}.${fieldRef(d, j.targetField)}`).join(' AND ');

type Reason = { reason: string };
type PathPlan = { source: JoinedSource; edge: Edge };

/** What every shape of the data mart's SQL shares: names, joins, the root-qualified field reference, the filters and the dedup CTEs. */
type Plan = {
  d: Dialect;
  shown: Field[];
  sorted: { s: SortKey; field: Field }[];
  active: { flt: ColumnFilter; field: Field }[];
  order: string[];
  cte: Map<string, string>;
  /** The edge from the parent of each joined path to it. */
  edgeOf: Map<string, Edge>;
  /** Whether the grid groups its shown columns. */
  grouped: boolean;
  /** The reference to the data mart a joined path reads. */
  mart: (path: string) => string;
  /** A name for a new CTE or alias, unique among all of them, ending in `_owox`. */
  alloc: (root: string) => string;
  /** The CTE that reads the main mart, then one dedup CTE per joined path, children before parents. */
  ctes: string[];
  /** A field as the outer query reads it: `base_owox.<col>` or `<root cte>.<blended name>`. */
  ref: (f: Field) => string;
  /** `LEFT JOIN` lines for the depth-1 paths, in first-use order. */
  joins: string[];
  /** The outer WHERE predicates, in grid order. */
  where: string[];
  /**
   * The slice predicates on the raw rows of each joined path, rendered on the raw column of the alias `t`. A path with no slice has no entry.
   * A slice is never part of the outer WHERE: that would drop main rows, where a slice only empties the joined columns.
   */
  slicesOf: Map<string, string[]>;
  /** The grid's aggregation reduced to the shown columns; undefined when the grid does not group. */
  agg?: Aggregation;
  /** The schema's fields by name. */
  byName: Map<string, Field>;
  /** The schema's shown fields, in schema order (the order GROUP BY keys follow). */
  cols: Field[];
  /** The distinct functions of each aggregated shown column, in rule order. */
  fns: Map<string, AggFn[]>;
  /** The HAVING filters of a grouped grid: a complete filter with `fn`, typed by the aggregate's result. */
  having: { flt: ColumnFilter; field: Field; fn: AggFn }[];
};

/** Resolves every input the SQL needs, or says why the grid can't be saved. */
function prepare(input: MartSqlInput): Plan | Reason {
  const { dialect: d, main, schema, visible, filters, sources, edges, titles } = input;
  const byName = new Map(schema.map((f) => [f.name, f]));
  const shown = visible.map((n) => byName.get(n)).filter((f): f is Field => !!f);
  if (shown.length === 0) return { reason: 'Show at least one column' };

  // A grouped grid only sorts what it shows.
  const shownNames = new Set(visible);
  const kept = input.aggregation && keepVisible(input.aggregation, visible);
  const grouped = isGrouped(kept);
  const sorted = (input.sorts ?? []).flatMap((s) => { const field = byName.get(s.field); return field && (!grouped || shownNames.has(s.field)) ? [{ s, field }] : []; });
  const active = filters.flatMap((flt) => {
    const field = byName.get(flt.field);
    return !flt.fn && field && isComplete(flt, field) ? [{ flt, field }] : [];
  });
  // A HAVING filter belongs to the grouped query, so an ungrouped grid has none.
  const having = !grouped ? [] : filters.flatMap((flt) => {
    const field = byName.get(flt.field);
    return flt.fn && field && isComplete(flt, havingField(field, flt.fn)) ? [{ flt, field, fn: flt.fn }] : [];
  });
  const calculated = shown.find((x) => x.isCalculated) ?? sorted.find((x) => x.field.isCalculated)?.field ?? active.find((x) => x.field.isCalculated)?.field;
  if (calculated) return { reason: `Calculated field "${calculated.alias || calculated.name}" can't be used in a data mart. Hide it or remove its filter.` };
  if (!safeId(main.id)) return { reason: 'The data mart id is not valid' };

  // Paths in use, in order of first use, each after its ancestors.
  const order: string[] = [];
  const need = (path: string) => {
    if (order.includes(path)) return;
    const parent = parentPath(path);
    if (parent) need(parent);
    order.push(path);
  };
  const used = [...shown, ...active.map((x) => x.field), ...sorted.map((x) => x.field)];
  for (const f of used) if (f.joined) need(f.joined.aliasPath);

  // CTE names end in _owox so no reserved word can clash: base_owox for main; a path with `.` as `__`; a clash gets _2, _3 before the suffix; an unusable name falls back to jN.
  const cte = new Map<string, string>([['', 'base_owox']]);
  const taken = new Set(['base']);
  const alloc = (root: string) => {
    let name = root;
    for (let n = 2; taken.has(name); n++) name = `${root}_${n}`;
    taken.add(name);
    return `${name}${CTE_SUFFIX}`;
  };
  order.forEach((path, i) => {
    const plain = path.replace(/\./g, '__');
    cte.set(path, alloc(plainName(plain) ? plain : `j${i + 1}`));
  });

  // The join of each path: its source, and the edge from its parent's mart.
  // A middle mart with no field to offer is not in the sources list, but the relationship that reaches the mart below it starts at it.
  // That mart may lack a source too, so this walks down to the nearest paths that have one and climbs back up their relationships.
  const sourceOf = (path: string): JoinedSource | undefined => {
    const hit = sources.find((s) => s.aliasPath === path);
    if (hit) return hit;
    const depth = path.split('.').length;
    const childPaths = new Set(sources.filter((s) => s.aliasPath.startsWith(`${path}.`)).map((s) => s.aliasPath.split('.').slice(0, depth + 1).join('.')));
    for (const q of childPaths) {
      const child = sourceOf(q);
      if (!child) continue;
      const incoming = edges.filter((e) => e.target === child.martId);
      // Only the relationship the child names is climbed: the model holds canvas marts only, so a lone incoming edge may belong to another route.
      const via = child.relationshipId ? incoming.find((e) => e.id === child.relationshipId) : undefined;
      if (via) return { aliasPath: path, martId: via.source, label: titles.get(via.source) ?? '', depth, fields: [], uniqueCount: false };
    }
    return undefined;
  };
  const plans = new Map<string, PathPlan>();
  for (const path of order) {
    const source = sourceOf(path);
    // A mart the list does not know is named by its title when the model has one that matches the alias, else not named (the alias path is not for the user).
    const last = path.split('.').at(-1)!;
    const label = source?.label ?? [...titles.values()].find((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_') === last.toLowerCase());
    const unresolved = { reason: label ? `The join to "${label}" could not be resolved` : 'A join could not be resolved' };
    if (!source) return unresolved;
    const parent = parentPath(path);
    const parentSource = parent ? sourceOf(parent) : undefined;
    const parentMartId = parent ? parentSource?.martId : main.id;
    if (!parentMartId || !safeId(source.martId)) return unresolved;
    let edge = source.relationshipId ? edges.find((e) => e.id === source.relationshipId && e.source === parentMartId && e.target === source.martId) : undefined;
    if (!edge) {
      const candidates = edges.filter((e) => e.source === parentMartId && e.target === source.martId);
      if (candidates.length !== 1) return unresolved;
      edge = candidates[0]!;
    }
    if (edge.joins.length === 0) return unresolved;
    if (edge.joins.some((j) => j.sourceField.includes('.') || j.targetField.includes('.'))) return { reason: `The join to "${label}" uses a nested key, which OWOX can't join on` };
    plans.set(path, { source, edge });
  }

  // The joined fields in use per path, each once, in first-use order.
  const own = new Map<string, { field: Field; original: string; fn: JoinFn }[]>();
  for (const field of used) {
    const jf = field.joined;
    if (!jf) continue;
    const label = field.alias || field.name;
    if (!jf.originalName) return { reason: `The column "${label}" could not be resolved` };
    if (!isJoinFn(jf.aggregateFunction)) return { reason: `OWOX didn't say how the join rolls up "${label}". Reload the data mart and try again.` };
    if (isArrayType(jf.sourceType ?? field.type)) return { reason: `"${label}" is a list field from a joined data mart, which a data mart can't save yet. Hide it or remove its filter.` };
    const list = own.get(jf.aliasPath) ?? [];
    if (!list.some((x) => x.field.name === field.name)) list.push({ field, original: jf.originalName, fn: jf.aggregateFunction });
    own.set(jf.aliasPath, list);
  }

  // Slices apply to the paths in use; a slice on a main field or on a path nothing reads has nothing to filter.
  const slices = (input.slices ?? []).flatMap((flt) => {
    const field = byName.get(flt.field);
    const jf = field?.joined;
    return field && jf?.originalName && order.includes(jf.aliasPath) && isComplete(flt, sliceField(field)) ? [{ flt, field: sliceField(field), path: jf.aliasPath, original: jf.originalName }] : [];
  });
  // Every path's slices are rendered once, here, so a filter the dialect cannot render is a reason before any SQL is built.
  const slicesOf = new Map<string, string[]>();
  for (const x of slices) {
    try { slicesOf.set(x.path, [...(slicesOf.get(x.path) ?? []), renderFilter(d, `t.${fieldRef(d, x.original)}`, x.field, x.flt)]); } catch (e) { return { reason: errorMessage(e) }; }
  }

  const ref = (f: Field) => (f.joined ? `${cte.get(rootOf(f.joined.aliasPath))}.${ident(d, f.name)}` : `base_owox.${fieldRef(d, f.name)}`);

  const mart = (path: string) => { const { source } = plans.get(path)!; return martRef(source.martId, titles.get(source.martId) ?? source.label); };

  // One dedup CTE per path: its own fields rolled up by its join key, its children's values rolled up again. Emitted children first.
  const ctes = [`  base_owox AS (\n    SELECT *\n    FROM ${martRef(main.id, main.title)}\n  )`];
  const dedup = (path: string): { sql: string[]; carried: { name: string; fn: JoinFn }[] } => {
    const { edge } = plans.get(path)!;
    const sql: string[] = [];
    const keys = edge.joins.map((j) => `t.${fieldRef(d, j.targetField)}`);
    const items = [...keys];
    const carried: { name: string; fn: JoinFn }[] = [];
    for (const o of own.get(path) ?? []) {
      items.push(`${aggregate(d, leafFn(o.fn, o.field.joined!.sourceType ?? o.field.type), `t.${fieldRef(d, o.original)}`)} AS ${ident(d, o.field.name)}`);
      carried.push({ name: o.field.name, fn: passFn(o.fn) });
    }
    const joins: string[] = [];
    for (const child of order.filter((p) => parentPath(p) === path)) {
      const sub = dedup(child);
      sql.push(...sub.sql);
      const childCte = cte.get(child)!;
      for (const c of sub.carried) {
        items.push(`${aggregate(d, c.fn, `${childCte}.${ident(d, c.name)}`)} AS ${ident(d, c.name)}`);
        carried.push({ name: c.name, fn: passFn(c.fn) });
      }
      joins.push(`    LEFT JOIN ${childCte} ON ${on(d, 't', childCte, plans.get(child)!.edge)}`);
    }
    // The slice filters P's raw rows here, before they roll up, so a failing row never reaches P's columns or its children's.
    const sliced = slicesOf.get(path) ?? [];
    sql.push(`  ${cte.get(path)} AS (\n    SELECT\n${lines(items, 6)}\n    FROM ${mart(path)} AS t${joins.length ? `\n${joins.join('\n')}` : ''}${sliced.length ? `\n    WHERE ${sliced.join('\n      AND ')}` : ''}\n    GROUP BY ${keys.join(', ')}\n  )`);
    return { sql, carried };
  };
  const roots = order.filter((p) => !parentPath(p));
  for (const root of roots) ctes.push(...dedup(root).sql);

  const joins = roots.map((root) => `LEFT JOIN ${cte.get(root)} ON ${on(d, 'base_owox', cte.get(root)!, plans.get(root)!.edge)}`);

  const where: string[] = [];
  for (const { flt, field } of active) {
    try { where.push(renderFilter(d, ref(field), field, flt)); } catch (e) { return { reason: errorMessage(e) }; }
  }
  const edgeOf = new Map([...plans].map(([path, pl]) => [path, pl.edge]));
  // Only the rules on shown columns count, and a column's functions are listed once each.
  const agg = grouped ? kept : undefined;
  const cols = schema.filter((f) => shownNames.has(f.name));
  const fns = new Map<string, AggFn[]>();
  for (const r of agg?.aggregations ?? []) {
    if (!shownNames.has(r.column) || !byName.has(r.column)) continue;
    const list = fns.get(r.column) ?? [];
    if (!list.includes(r.function)) list.push(r.function);
    fns.set(r.column, list);
  }
  return { d, agg, byName, cols, fns, shown, sorted, active, order, cte, edgeOf, grouped, mart, alloc, ctes, ref, joins, where, slicesOf, having };
}

/** The outer query both shapes share: WITH, SELECT, FROM base_owox, the joins, WHERE, then the grouped parts when there are any. */
function outer(p: Plan, q: { ctes: string[]; items: string[]; joins: string[]; groupBy?: string; having?: string[]; ordering: string[] }): string {
  return [
    `WITH\n${q.ctes.join(',\n')}`,
    `SELECT\n${lines(q.items, 2)}`,
    'FROM base_owox',
    ...q.joins,
    ...(p.where.length ? [`WHERE ${p.where.join('\n  AND ')}`] : []),
    ...(q.groupBy ? [`GROUP BY ${q.groupBy}`] : []),
    ...(q.having?.length ? [`HAVING ${q.having.join('\n  AND ')}`] : []),
    ...(q.ordering.length ? [`ORDER BY ${q.ordering.join(', ')}`] : []),
  ].join('\n');
}

/** The ungrouped data mart: the shown fields, one row per main row. */
function assembleFlat(p: Plan): string {
  const ordering = p.sorted.map(({ s, field }) => `${p.ref(field)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`);
  return outer(p, { ctes: p.ctes, items: p.shown.map((f) => p.ref(f)), joins: p.joins, ordering });
}

/** The functions a joined field's roll-up is re-aggregated by in a value sleeve (the engine's `value` shape). */
const VALUE_FNS: readonly AggFn[] = ['SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'P25', 'P50', 'P75', 'P95'];

/** The grouped data mart: keys and metrics as the grid's aggregation asks, with a sleeve CTE for each joined metric the engine computes apart. */
function assembleGrouped(p: Plan & { agg: Aggregation }): string | Reason {
  const { agg } = p;
  const { d, byName, cols } = p;
  const rules = agg.aggregations.filter((r) => p.fns.has(r.column));
  const fnsOf = (f: Field): AggFn[] => p.fns.get(f.name) ?? [];
  const label = (f: Field) => f.alias || f.name;

  for (const f of cols) {
    const fns = fnsOf(f);
    if (!f.joined || fns.length === 0) continue;
    if (fns.includes('COUNT') && fns.includes('COUNT_DISTINCT')) return { reason: `Count and Count Unique together on "${label(f)}" aren't available for a joined column. Remove one of them.` };
    if (f.joined.aggregateFunction === 'ANY_VALUE' && fns.some((fn) => VALUE_FNS.includes(fn))) return { reason: `"${label(f)}" can't be saved: its join keeps one sample value per row, which a data mart can't reproduce yet. Pick another function for it, or change its join setting.` };
  }

  // Output names: a plain identifier per key and per metric, unique across the output, in grid order.
  const used = new Set<string>();
  const unique = (base: string) => { let n = base; for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base}_${i}`; used.add(n.toLowerCase()); return n; };
  const outNames = new Map<string, string>();
  for (const f of p.shown) {
    const base = f.name.replace(/\./g, '_');
    const fns = fnsOf(f);
    if (fns.length === 0) outNames.set(f.name, unique(base));
    else for (const fn of fns) outNames.set(`${f.name}|${fn}`, unique(`${base}__${AGG_TOKENS[fn].toLowerCase()}`));
  }
  const outName = (f: Field, fn?: AggFn) => outNames.get(fn ? `${f.name}|${fn}` : f.name)!;

  const keys = cols.filter((f) => fnsOf(f).length === 0);
  const bucketOf = (f: Field) => agg.dateTrunc.find((r) => r.column === f.name);
  const keyExprs = new Map<string, string>();
  try {
    for (const k of keys) {
      const b = bucketOf(k);
      keyExprs.set(k.name, b ? dateTrunc(d, p.ref(k), b.unit, b.timeZone, k.type) : p.ref(k));
    }
  } catch (e) { return { reason: errorMessage(e) }; }
  const keyExpr = (k: Field) => keyExprs.get(k.name)!;
  const dimAlias = (i: number) => ident(d, `_owox_dim_${i}`);
  const dimItems = keys.map((k, i) => `${keyExpr(k)} AS ${dimAlias(i)}`);

  const pathBase = (path: string) => p.cte.get(path)!.slice(0, -CTE_SUFFIX.length);
  const safe = (base: string, fallback: string) => (plainName(base) ? base : fallback);
  const raws = new Map<string, string>();
  const rawOf = (path: string) => { if (!raws.has(path)) raws.set(path, p.alloc(`${pathBase(path)}_raw`)); return raws.get(path)!; };
  const parentRef = (path: string) => { const parent = parentPath(path); return parent ? rawOf(parent) : 'base_owox'; };
  /** The paths from the depth-1 join down to `path`, ancestors first. */
  const chain = (path: string): string[] => (path ? [...chain(parentPath(path) ?? ''), path] : []);
  /**
   * A raw join of a path with slices reads a filtered derived table, so it stays a LEFT JOIN: where a slice fails, the path's columns and its descendants' are empty and the row stays.
   * The same predicates filter the path's dedup CTE, so every read of the path agrees.
   */
  const rawMart = (path: string) => { const sliced = p.slicesOf.get(path) ?? []; return sliced.length ? `(SELECT * FROM ${p.mart(path)} AS t WHERE ${sliced.join(' AND ')})` : p.mart(path); };
  const rawJoin = (path: string) => `LEFT JOIN ${rawMart(path)} AS ${rawOf(path)} ON ${on(d, parentRef(path), rawOf(path), p.edgeOf.get(path)!)}`;
  const dedupJoin = (path: string) => `LEFT JOIN ${p.cte.get(path)} ON ${on(d, parentRef(path), p.cte.get(path)!, p.edgeOf.get(path)!)}`;
  // The depth-1 dedup CTEs a key or a filter reads: a sleeve joins them so its WHERE and grain match the outer query.
  const roots = new Set([...keys, ...p.active.map((x) => x.field)].filter((f) => f.joined).map((f) => rootOf(f.joined!.aliasPath)));
  const wherePart = (indent: number) => (p.where.length ? `\n${' '.repeat(indent)}WHERE ${p.where.join(`\n${' '.repeat(indent + 2)}AND `)}` : '');
  const groupBy = keys.length ? `\n    GROUP BY ${keys.map(keyExpr).join(', ')}` : '';

  // Joined metrics that need a sleeve, in rule order: COUNT_DISTINCT per owner path, the value functions per column.
  const cdByOwner = new Map<string, Field[]>();
  const valueByColumn = new Map<string, { f: Field; fns: AggFn[] }>();
  for (const r of rules) {
    const f = byName.get(r.column)!;
    if (!f.joined) continue;
    if (r.function === 'COUNT_DISTINCT') {
      const list = cdByOwner.get(f.joined.aliasPath) ?? [];
      if (!list.includes(f)) list.push(f);
      cdByOwner.set(f.joined.aliasPath, list);
    } else if (VALUE_FNS.includes(r.function)) {
      const entry = valueByColumn.get(f.name) ?? { f, fns: [] };
      if (!entry.fns.includes(r.function)) entry.fns.push(r.function);
      valueByColumn.set(f.name, entry);
    }
  }
  const sleeves: { name: string; sql: string }[] = [];
  const cdName = new Map<string, string>();
  const valueName = new Map<string, string>();
  for (const [owner] of cdByOwner) cdName.set(owner, p.alloc(`sleeve_${pathBase(owner)}_cd`));
  for (const [column] of valueByColumn) valueName.set(column, p.alloc(safe(`sleeve_${column}`, `sleeve_v${valueName.size + 1}`)));

  for (const [owner, ms] of cdByOwner) {
    const name = cdName.get(owner)!;
    const items = [...dimItems, ...ms.map((m) => `${reportAggregate(d, 'COUNT_DISTINCT', `${rawOf(owner)}.${fieldRef(d, m.joined!.originalName!)}`)} AS ${ident(d, outName(m, 'COUNT_DISTINCT'))}`)];
    const joins = [...chain(owner).map(rawJoin), ...p.order.filter((q) => roots.has(q)).map(dedupJoin)];
    sleeves.push({ name, sql: `  ${name} AS (\n    SELECT\n${lines(items, 6)}\n    FROM base_owox\n${joins.map((x) => `    ${x}`).join('\n')}${wherePart(4)}${groupBy}\n  )` });
  }
  for (const [column, { f, fns }] of valueByColumn) {
    const name = valueName.get(column)!;
    const owner = f.joined!.aliasPath;
      const ownerCte = p.cte.get(owner)!;
      const tgt = p.edgeOf.get(owner)!.joins.map((j) => `${ownerCte}.${fieldRef(d, j.targetField)}`);
      const oid = tgt.map((x, i) => `${x} AS ${ident(d, tgt.length === 1 ? '_oid' : `_oid_${i}`)}`);
      const inner = [...dimItems, ...oid, `${ownerCte}.${ident(d, f.name)} AS ${ident(d, '_val')}`];
      const joins = [...chain(parentPath(owner) ?? '').map(rawJoin), ...p.order.filter((q) => q === owner || roots.has(q)).map(dedupJoin)];
      const dimCols = keys.map((_, i) => dimAlias(i));
      const outerItems = [...dimCols, ...fns.map((fn) => `${aggregate(d, fn, ident(d, '_val'))} AS ${ident(d, outName(f, fn))}`)];
    sleeves.push({ name, sql: `  ${name} AS (\n    SELECT\n${lines(outerItems, 6)}\n    FROM (\n      SELECT DISTINCT\n${lines(inner, 8)}\n      FROM base_owox\n${joins.map((x) => `      ${x}`).join('\n')}${wherePart(6)}\n    ) _dedup${dimCols.length ? `\n    GROUP BY ${dimCols.join(', ')}` : ''}\n  )` });
  }

  // The exact aggregate expression the SELECT uses for (column, fn). A HAVING filter reuses it. It stays valid when the aggregate comes from a sleeve: the sleeve holds one row per group, so the outer query's ANY_VALUE over it is the scalar the SELECT shows, and the HAVING compares that same value after grouping. The outer WHERE would be wrong here, as it would compare before grouping and, with no group keys, turn an empty result into a row of NULLs.
  const aggExpr = (f: Field, fn: AggFn): string => {
    const out = ident(d, outName(f, fn));
    if (f.joined && fn === 'COUNT_DISTINCT') return `COALESCE(${anyValue(d, `${cdName.get(f.joined.aliasPath)}.${out}`)}, 0)`;
    if (f.joined && VALUE_FNS.includes(fn)) return anyValue(d, `${valueName.get(f.name)}.${out}`);
    return reportAggregate(d, fn, p.ref(f));
  };
  const havingRules: string[] = [];
  try {
    for (const { flt, field, fn } of p.having) if (rules.some((r) => r.column === field.name && r.function === fn)) havingRules.push(renderFilter(d, aggExpr(field, fn), havingField(field, fn), flt));
  } catch (e) { return { reason: errorMessage(e) }; }

  const items: string[] = [];
  for (const f of p.shown) {
    const fns = fnsOf(f);
    if (fns.length === 0) { items.push(`${keyExpr(f)} AS ${ident(d, outName(f))}`); continue; }
    for (const fn of fns) {
      items.push(`${aggExpr(f, fn)} AS ${ident(d, outName(f, fn))}`);
    }
  }
  const sleeveJoins = sleeves.map(({ name }) => (keys.length
    ? `LEFT JOIN ${name} ON ${nullSafeOn(keys.map((k, i) => ({ left: keyExpr(k), right: `${name}.${dimAlias(i)}`, nanSafe: isFloat(k.type) })))}`
    : `CROSS JOIN ${name}`));
  const ordering = p.sorted.flatMap(({ s, field }) => {
    const fn = fnsOf(field)[0];
    return [`${ident(d, outName(field, fn))} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`];
  });
  return outer(p, {
    ctes: [...p.ctes, ...sleeves.map((x) => x.sql)],
    items,
    joins: [...p.joins, ...sleeveJoins],
    groupBy: keys.length ? keys.map(keyExpr).join(', ') : undefined,
    having: havingRules,
    ordering,
  });
}

/** The data mart's SQL for the grid: one deduplicated CTE per joined mart in use, LEFT JOINed to the main mart, with the grid's filters in the outer WHERE; a grouped grid adds its GROUP BY and a sleeve per joined metric the engine computes apart. */
export function buildMartSql(input: MartSqlInput): { sql: string } | { reason: string } {
  const plan = prepare(input);
  if ('reason' in plan) return plan;
  if (!plan.agg) return { sql: assembleFlat(plan) };
  const sql = assembleGrouped({ ...plan, agg: plan.agg });
  return typeof sql === 'string' ? { sql } : sql;
}
