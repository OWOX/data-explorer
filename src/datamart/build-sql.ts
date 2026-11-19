import type { JoinedSource } from '../api/blendable';
import type { ColumnFilter } from '../filters/build';
import { isComplete } from '../filters/build';
import type { SortKey } from '../model/sort';
import type { Edge, Field, Schema } from '../model/types';
import { parentPath } from '../state/join-plan';
import type { Dialect } from './dialect';
import { columnRef, quoteIdent, renderFilter } from './dialect';

export type MartSqlInput = {
  dialect: Dialect;
  main: { id: string; title: string };
  /** The main grid's schema: main fields and joined fields (a joined field has `joined`). */
  schema: Schema;
  /** Shown columns, in grid order. */
  visible: string[];
  filters: ColumnFilter[];
  /** The member's own sort order; when non-empty the SQL ends with an ORDER BY. */
  sorts?: SortKey[];
  /** The main mart's joined sources (`BlendableLoader.get(mainId)`). */
  sources: JoinedSource[];
  /** The model's edges (`model.edges`). */
  edges: Edge[];
  /** Mart titles by id, for reference labels. */
  titles: Map<string, string>;
};

/** A reference to a data mart where a table name goes; the title is escaped as the OWOX backend reads it. */
const martRef = (id: string, title: string) => `[${title.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}](dm:${id})`;

/** A mart id is safe inside a reference only when it is plain. */
const safeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

/** The column of a joined field in its own mart, when the schema says. */
const originalNameOf = (f: Field): string | undefined => f.joined?.originalName || undefined;

/** The data mart's SQL for the grid: one CTE per mart in use (with its own complete filters), then the shown columns joined from the CTEs. */
export function buildMartSql(input: MartSqlInput): { sql: string; /** How many distinct joined data marts the SQL reads. */ joined: number; /** A joined mart in use has several rows per main row (or the backend didn't say), so main rows can repeat. */ repeats: boolean } | { reason: string } {
  const { dialect: d, main, schema, visible, filters, sources, edges, titles } = input;
  const sorts = input.sorts ?? [];
  const byName = new Map(schema.map((f) => [f.name, f]));
  const shown = visible.map((n) => byName.get(n)).filter((f): f is Field => !!f);
  if (shown.length === 0) return { reason: 'Show at least one column' };

  const sorted = sorts.flatMap((s) => { const field = byName.get(s.field); return field ? [{ s, field }] : []; });
  const calculated = shown.find((x) => x.isCalculated) ?? sorted.find((x) => x.field.isCalculated)?.field ?? filters.map((flt) => byName.get(flt.field)).find((x) => x?.isCalculated && filters.some((flt) => flt.field === x.name && isComplete(flt, x)));
  if (calculated) return { reason: `Calculated field "${calculated.alias || calculated.name}" can't be used in a data mart. Hide it or remove its filter.` };
  if (!safeId(main.id)) return { reason: 'The data mart id is not valid' };

  const active = filters.flatMap((flt) => {
    const field = byName.get(flt.field);
    return field && isComplete(flt, field) ? [{ flt, field }] : [];
  });

  // Paths in use, in order of first use, each after its ancestors.
  const order: string[] = [];
  const need = (path: string) => {
    if (order.includes(path)) return;
    const parent = parentPath(path);
    if (parent) need(parent);
    order.push(path);
  };
  for (const f of shown) if (f.joined) need(f.joined.aliasPath);
  for (const { field } of active) if (field.joined) need(field.joined.aliasPath);
  // A sort never adds a join: a join nothing shown or filtered uses could multiply the rows.
  for (const { field } of sorted) {
    if (field.joined && !order.includes(field.joined.aliasPath)) return { reason: `Sorting by "${field.alias || field.name}" needs a join that no shown column or filter uses. Show a column from it or remove that sort.` };
  }

  // CTE names end in _dm so no reserved word can clash: base_dm for main; a path with `.` as `__`; a clash gets _2, _3 before the suffix; an unusable name falls back to jN.
  const cte = new Map<string, string>([['', 'base_dm']]);
  const taken = new Set(['base']);
  order.forEach((path, i) => {
    const plain = path.replace(/\./g, '__');
    const root = /^[a-z_][a-z0-9_]*$/.test(plain) ? plain : `j${i + 1}`;
    let name = root;
    for (let n = 2; taken.has(name); n++) name = `${root}_${n}`;
    taken.add(name);
    cte.set(path, `${name}_dm`);
  });

  // Filters on the main mart go in its own query; filters on a joined field go in the outer WHERE after the joins, as the grid applies them.
  const mainWhere: string[] = [];
  const outerWhere: string[] = [];
  for (const { flt, field } of active) {
    try {
      if (field.joined) {
        const name = originalNameOf(field);
        if (!name) return { reason: `The filter on "${field.name}" could not be resolved` };
        // The grid filters a multiplying join's rolled-up value; the SQL would filter its raw rows.
        const src = sources.find((s) => s.aliasPath === field.joined!.aliasPath);
        if (src?.mainGrainMultiplication !== 'none') return { reason: `Filtering by "${field.alias || field.name}" can't be saved: ${src?.label ?? field.joined.label} has several rows per ${main.title} row, and the grid filters their combined value.` };
        // A pre-join aggregated field has no raw per-row meaning to filter on.
        if (field.joined.sourceType && field.joined.sourceType !== field.type) return { reason: `Filter on "${field.alias || field.name}" can't be saved: the joined data mart aggregates this field` };
        outerWhere.push(renderFilter(d, columnRef(d, cte.get(field.joined.aliasPath)!, name), field, flt));
      } else mainWhere.push(renderFilter(d, columnRef(d, '', field.name), field, flt));
    } catch (e) { return { reason: e instanceof Error ? e.message : String(e) }; }
  }

  const sourceOf = (path: string) => sources.find((s) => s.aliasPath === path);
  // Redshift: a reference inside a WITH makes the backend create technical views, so each mart is a derived table there.
  const derived = d === 'redshift';
  const body = (ref: string, w: string[] | undefined, pad: string) => `${pad}SELECT *\n${pad}FROM ${ref}${w?.length ? `\n${pad}WHERE ${w.join(' AND ')}` : ''}`;
  const ctes: string[] = [];
  const mart = (path: string, ref: string, w?: string[]) => {
    if (derived) return `(\n${body(ref, w, '  ')}\n) AS ${cte.get(path)}`;
    ctes.push(`  ${cte.get(path)} AS (\n${body(ref, w, '    ')}\n  )`);
    return cte.get(path)!;
  };
  const from = mart('', martRef(main.id, main.title), mainWhere);
  const joins: string[] = [];
  const martIds = new Set<string>();
  for (const path of order) {
    const source = sourceOf(path);
    const label = source?.label ?? path;
    const unresolved = { reason: `The join to "${label}" could not be resolved` };
    if (!source) return unresolved;
    const parent = parentPath(path);
    const parentMartId = parent ? sourceOf(parent)?.martId : main.id;
    if (!parentMartId) return unresolved;
    if (!safeId(source.martId)) return unresolved;
    let edge = source.relationshipId ? edges.find((e) => e.id === source.relationshipId && e.source === parentMartId && e.target === source.martId) : undefined;
    if (!edge) {
      const candidates = edges.filter((e) => e.source === parentMartId && e.target === source.martId);
      if (candidates.length !== 1) return unresolved;
      edge = candidates[0]!;
    }
    if (edge.joins.length === 0) return unresolved;
    const on = edge.joins.map((j) => `${columnRef(d, cte.get(parent)!, j.sourceField)} = ${columnRef(d, cte.get(path)!, j.targetField)}`).join(' AND ');
    martIds.add(source.martId);
    joins.push(`LEFT JOIN ${mart(path, martRef(source.martId, titles.get(source.martId) ?? source.label))} ON ${on}`);
  }

  const select: string[] = [];
  for (const f of shown) {
    if (!f.joined) { select.push(columnRef(d, 'base_dm', f.name)); continue; }
    const col = originalNameOf(f);
    if (!col) return { reason: `The column "${f.name}" could not be resolved` };
    select.push(`${columnRef(d, cte.get(f.joined.aliasPath)!, col)} AS ${quoteIdent(d, f.name)}`);
  }

  const ordering: string[] = [];
  for (const { s, field } of sorted) {
    let col: string;
    if (field.joined) {
      const name = originalNameOf(field);
      if (!name) return { reason: `The sort on "${field.name}" could not be resolved` };
      col = columnRef(d, cte.get(field.joined.aliasPath)!, name);
    } else col = columnRef(d, 'base_dm', field.name);
    ordering.push(`${col} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`);
  }

  const sql = [...(derived ? [] : [`WITH\n${ctes.join(',\n')}`]), `SELECT\n${select.map((x) => `  ${x}`).join(',\n')}`, `FROM ${from}`, ...joins, ...(outerWhere.length ? [`WHERE ${outerWhere.join(' AND ')}`] : []), ...(ordering.length ? [`ORDER BY ${ordering.join(', ')}`] : [])].join('\n');
  return { sql, joined: martIds.size, repeats: order.some((path) => sourceOf(path)?.mainGrainMultiplication !== 'none') };
}
