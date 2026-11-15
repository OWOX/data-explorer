import type { ColumnFilter } from '../filters/build';
import { isDateTimeField } from '../filters/catalogue';
import type { Edge, Field, Schema } from '../model/types';
import type { Row } from '../sdk/types';

export function primaryKeys(schema: Schema): string[] {
  return schema.filter((f) => f.isPrimaryKey).map((f) => f.name);
}

export type RelColumn = {
  field: string;
  edgeId: string;
  relatedMartId: string;
  relatedField: string;
  composite: boolean;
  /** Sourced from this mart's side: sourceField is this mart's field, targetField the related mart's. */
  joins: { sourceField: string; targetField: string }[];
};

/** Relationship cells of the grid and the record: this mart's own outgoing edges only. */
export function relationshipColumns(martId: string, edges: Edge[]): Map<string, RelColumn> {
  const out = new Map<string, RelColumn>();
  for (const e of edges) {
    if (e.source !== martId) continue;
    for (const j of e.joins) {
      if (out.has(j.sourceField)) continue;
      out.set(j.sourceField, { field: j.sourceField, edgeId: e.id, relatedMartId: e.target, relatedField: j.targetField, composite: e.joins.length > 1, joins: e.joins });
    }
  }
  return out;
}

export type IncomingLink = {
  edgeId: string;
  sourceMartId: string;
  /** sourceField is the referencing mart's field, targetField this mart's. */
  joins: { sourceField: string; targetField: string }[];
};

/** Every edge that points at this mart, for the record's "Referenced by" section. */
export function incomingLinks(martId: string, edges: Edge[]): IncomingLink[] {
  return edges
    .filter((e) => e.target === martId && e.source !== martId)
    .map((e) => ({ edgeId: e.id, sourceMartId: e.source, joins: e.joins }));
}

export type ClickTarget =
  | { kind: 'record'; martId: string; pk: Record<string, unknown> }
  | { kind: 'mart'; martId: string; filters: ColumnFilter[] };

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const isTrue = (v: unknown) => v === true || ['true', '1'].includes(String(v).trim().toLowerCase());

/** One equality filter on the field a join points at, using an operator that field's type supports. */
export function equalsFilter(field: Field | undefined, name: string, value: unknown): ColumnFilter {
  const v = value as string | number;
  if (field?.category === 'boolean') return { field: name, op: isTrue(value) ? 'is_true' : 'is_false' };
  if (field?.category === 'time' || (field && isDateTimeField(field))) return { field: name, op: 'between', value: { from: v, to: v } };
  if (field?.type.trim().toUpperCase() === 'DATE') return { field: name, op: 'on', value: v };
  return { field: name, op: 'eq', value: v };
}

/** Filters on `targetSchema` for every join: `join.targetField = row[join.sourceField]`. Null when a value is blank. */
export function joinFilters(joins: { sourceField: string; targetField: string }[], row: Row, targetSchema: Schema): ColumnFilter[] | null {
  if (joins.some((j) => blank(row[j.sourceField]))) return null;
  return joins.map((j) => equalsFilter(targetSchema.find((f) => f.name === j.targetField), j.targetField, row[j.sourceField]));
}

/** `relatedSchema` undefined means it has not loaded yet: no target until the filter operators are known. */
export function clickTarget(rel: RelColumn, row: Row, relatedSchema: Schema | undefined): ClickTarget | null {
  if (!relatedSchema) return null;
  const filters = joinFilters(rel.joins, row, relatedSchema);
  if (!filters) return null;
  const pks = primaryKeys(relatedSchema);
  if (!rel.composite && pks.length === 1 && pks[0] === rel.relatedField) {
    return { kind: 'record', martId: rel.relatedMartId, pk: { [rel.relatedField]: row[rel.field] } };
  }
  return { kind: 'mart', martId: rel.relatedMartId, filters };
}

export function recordTabId(martId: string, pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return `record:${martId}:${JSON.stringify(keys.map((k) => [k, pk[k]]))}`;
}
