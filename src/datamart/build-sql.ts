import type { JoinedSource } from '../api/blendable';
import type { ColumnFilter } from '../filters/build';
import { isComplete } from '../filters/build';
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
  /** The main mart's joined sources (`BlendableLoader.get(mainId)`). */
  sources: JoinedSource[];
  /** The model's edges (`model.edges`). */
  edges: Edge[];
  /** Mart titles by id, for reference labels. */
  titles: Map<string, string>;
};

/** A reference to a data mart where a table name goes; brackets in the title would end the label early. */
const martRef = (id: string, title: string) => `[${title.replace(/\[/g, '(').replace(/\]/g, ')')}](dm:${id})`;

/** The column of a joined field in its own mart: `originalName`, else the blended name without its path prefix. */
function originalNameOf(f: Field): string | undefined {
  const j = f.joined!;
  if (j.originalName) return j.originalName;
  const prefix = `${j.aliasPath.replace(/\./g, '_')}__`;
  return f.name.startsWith(prefix) && f.name.length > prefix.length ? f.name.slice(prefix.length) : undefined;
}

/** The data mart's SQL for the grid: the shown columns of the main and joined marts, left joined, with the complete filters. */
export function buildMartSql(input: MartSqlInput): { sql: string } | { reason: string } {
  const { dialect: d, main, schema, visible, filters, sources, edges, titles } = input;
  const byName = new Map(schema.map((f) => [f.name, f]));
  const shown = visible.map((n) => byName.get(n)).filter((f): f is Field => !!f);
  if (shown.length === 0) return { reason: 'Show at least one column' };

  const active = filters.flatMap((flt) => {
    const field = byName.get(flt.field);
    return field && isComplete(flt, field) ? [{ flt, field }] : [];
  });

  // Table aliases: t0 is main; paths follow in order of first use, each after its ancestors.
  const alias = new Map<string, string>([['', 't0']]);
  const order: string[] = [];
  const use = (path: string) => {
    if (alias.has(path)) return;
    const parent = parentPath(path);
    if (parent) use(parent);
    alias.set(path, `t${alias.size}`);
    order.push(path);
  };
  for (const f of shown) if (f.joined) use(f.joined.aliasPath);
  for (const { field } of active) if (field.joined) use(field.joined.aliasPath);

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
    let edge = source.relationshipId ? edges.find((e) => e.id === source.relationshipId) : undefined;
    if (!edge) {
      const candidates = edges.filter((e) => e.source === parentMartId && e.target === source.martId);
      if (candidates.length !== 1) return unresolved;
      edge = candidates[0]!;
    }
    if (edge.joins.length === 0) return unresolved;
    const on = edge.joins.map((j) => `${alias.get(parent)}.${quoteIdent(d, j.sourceField)} = ${alias.get(path)}.${quoteIdent(d, j.targetField)}`).join(' AND ');
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
    if (field.joined) {
      const name = originalNameOf(field);
      if (!name) return { reason: `The filter on "${field.name}" could not be resolved` };
      col = columnRef(d, alias.get(field.joined.aliasPath)!, name);
    } else col = columnRef(d, 't0', field.name);
    try { where.push(renderFilter(d, col, field, flt)); } catch (e) { return { reason: e instanceof Error ? e.message : String(e) }; }
  }

  return { sql: [`SELECT\n${select.map((s) => `  ${s}`).join(',\n')}`, `FROM ${martRef(main.id, main.title)} AS t0`, ...joins, ...(where.length ? [`WHERE ${where.join(' AND ')}`] : [])].join('\n') };
}
