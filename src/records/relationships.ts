import type { ColumnFilter } from '../filters/build';
import type { Edge, Schema } from '../model/types';
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
  direction: 'outgoing' | 'incoming';
  /** Always from this mart's side: sourceField is this mart's field, targetField the related mart's. */
  joins: { sourceField: string; targetField: string }[];
};

export function relationshipColumns(martId: string, edges: Edge[]): Map<string, RelColumn> {
  const out = new Map<string, RelColumn>();
  for (const e of edges) {
    if (e.source !== martId) continue;
    for (const j of e.joins) {
      if (out.has(j.sourceField)) continue;
      out.set(j.sourceField, { field: j.sourceField, edgeId: e.id, relatedMartId: e.target, relatedField: j.targetField, composite: e.joins.length > 1, direction: 'outgoing', joins: e.joins });
    }
  }
  // Incoming edges: the target field of this mart is referenced by the source mart. Outgoing wins on a clash,
  // and the first incoming edge wins when several reference the same field (a cell has one click).
  for (const e of edges) {
    if (e.target !== martId || e.source === martId) continue;
    for (const j of e.joins) {
      if (out.has(j.targetField)) continue;
      out.set(j.targetField, { field: j.targetField, edgeId: e.id, relatedMartId: e.source, relatedField: j.sourceField, composite: e.joins.length > 1, direction: 'incoming', joins: e.joins.map((x) => ({ sourceField: x.targetField, targetField: x.sourceField })) });
    }
  }
  return out;
}

export type ClickTarget =
  | { kind: 'record'; martId: string; pk: Record<string, unknown> }
  | { kind: 'mart'; martId: string; filters: ColumnFilter[] };

const isDateField = (schema: Schema, name: string) => schema.find((f) => f.name === name)?.type.trim().toUpperCase() === 'DATE';
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export function clickTarget(rel: RelColumn, row: Row, relatedSchema: Schema): ClickTarget | null {
  if (rel.joins.some((j) => blank(row[j.sourceField]))) return null;
  const pks = primaryKeys(relatedSchema);
  // An incoming relationship is one-to-many: it always opens the related mart, filtered.
  if (rel.direction === 'outgoing' && !rel.composite && pks.length === 1 && pks[0] === rel.relatedField) {
    return { kind: 'record', martId: rel.relatedMartId, pk: { [rel.relatedField]: row[rel.field] } };
  }
  return {
    kind: 'mart',
    martId: rel.relatedMartId,
    filters: rel.joins.map((j) => ({ field: j.targetField, op: isDateField(relatedSchema, j.targetField) ? 'on' : 'eq', value: row[j.sourceField] as string | number })),
  };
}

export function recordTabId(martId: string, pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return `record:${martId}:${JSON.stringify(keys.map((k) => [k, pk[k]]))}`;
}
