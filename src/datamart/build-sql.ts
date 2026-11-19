import type { JoinedSource } from '../api/blendable';
import type { ColumnFilter } from '../filters/build';
import { isComplete } from '../filters/build';
import { categorizeFieldType } from '../model/field-category';
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
  /** The grid's sort order; when non-empty the SQL ends with an ORDER BY. */
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

/** The data mart's SQL for the grid: the shown columns of the main and joined marts, left joined, with the complete filters. */
export function buildMartSql(input: MartSqlInput): { sql: string } | { reason: string } {
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

  // Table aliases: t0 is main; paths follow in order of first use, each after its ancestors.
  const alias = new Map<string, string>([['', 't0']]);
  const order: string[] = [];
  const need = (path: string) => {
    if (alias.has(path)) return;
    const parent = parentPath(path);
    if (parent) need(parent);
    alias.set(path, `t${alias.size}`);
    order.push(path);
  };
  for (const f of shown) if (f.joined) need(f.joined.aliasPath);
  for (const { field } of active) if (field.joined) need(field.joined.aliasPath);
  for (const { field } of sorted) if (field.joined) need(field.joined.aliasPath);

  const sourceOf = (path: string) => sources.find((s) => s.aliasPath === path);
  const joins: string[] = [];
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
    const on = edge.joins.map((j) => `${columnRef(d, alias.get(parent)!, j.sourceField)} = ${columnRef(d, alias.get(path)!, j.targetField)}`).join(' AND ');
    joins.push(`LEFT JOIN ${martRef(source.martId, titles.get(source.martId) ?? source.label)} AS ${alias.get(path)} ON ${on}`);
  }

  const select: string[] = [];
  for (const f of shown) {
    if (!f.joined) { select.push(columnRef(d, 't0', f.name)); continue; }
    const col = originalNameOf(f);
    if (!col) return { reason: `The column "${f.name}" could not be resolved` };
    select.push(`${columnRef(d, alias.get(f.joined.aliasPath)!, col)} AS ${quoteIdent(d, f.name)}`);
  }

  const where: string[] = [];
  for (const { flt, field } of active) {
    let col: string;
    let typed = field;
    if (field.joined) {
      const name = originalNameOf(field);
      if (!name) return { reason: `The filter on "${field.name}" could not be resolved` };
      col = columnRef(d, alias.get(field.joined.aliasPath)!, name);
      // The mart reads the raw column, so the filter takes its source type, not the type after a pre-join aggregation.
      const raw = field.joined.sourceType;
      if (raw && raw !== field.type) {
        typed = { ...field, type: raw, category: categorizeFieldType(raw) };
        if (!isComplete(flt, typed)) return { reason: `Filter on "${field.alias || field.name}" can't be saved: the joined data mart aggregates this field` };
      }
    } else col = columnRef(d, 't0', field.name);
    try { where.push(renderFilter(d, col, typed, flt)); } catch (e) { return { reason: e instanceof Error ? e.message : String(e) }; }
  }

  const ordering: string[] = [];
  for (const { s, field } of sorted) {
    let col: string;
    if (field.joined) {
      const name = originalNameOf(field);
      if (!name) return { reason: `The sort on "${field.name}" could not be resolved` };
      col = columnRef(d, alias.get(field.joined.aliasPath)!, name);
    } else col = columnRef(d, 't0', field.name);
    ordering.push(`${col} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`);
  }

  return { sql: [`SELECT\n${select.map((x) => `  ${x}`).join(',\n')}`, `FROM ${martRef(main.id, main.title)} AS t0`, ...joins, ...(where.length ? [`WHERE ${where.join(' AND ')}`] : []), ...(ordering.length ? [`ORDER BY ${ordering.join(', ')}`] : [])].join('\n') };
}
