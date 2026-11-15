import type { ColumnFilter } from '../filters/build';
import type { Edge, Schema } from '../model/types';
import type { Row } from '../sdk/types';

export function primaryKeys(schema: Schema): string[] {
  return schema.filter((f) => f.isPrimaryKey).map((f) => f.name);
}

export type RelColumn = { field: string; edgeId: string; relatedMartId: string; relatedField: string; composite: boolean; joins: { sourceField: string; targetField: string }[] };

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

export type ClickTarget =
  | { kind: 'record'; martId: string; pk: Record<string, unknown> }
  | { kind: 'mart'; martId: string; filters: ColumnFilter[] };

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export function clickTarget(rel: RelColumn, row: Row, relatedSchema: Schema): ClickTarget | null {
  if (rel.joins.some((j) => blank(row[j.sourceField]))) return null;
  const pks = primaryKeys(relatedSchema);
  if (!rel.composite && pks.length === 1 && pks[0] === rel.relatedField) {
    return { kind: 'record', martId: rel.relatedMartId, pk: { [rel.relatedField]: row[rel.field] } };
  }
  const isDate = (name: string) => relatedSchema.find((f) => f.name === name)?.type.trim().toUpperCase() === 'DATE';
  return {
    kind: 'mart',
    martId: rel.relatedMartId,
    filters: rel.joins.map((j) => ({ field: j.targetField, op: isDate(j.targetField) ? 'on' : 'eq', value: row[j.sourceField] as string | number })),
  };
}

export function recordTabId(martId: string, pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return `record:${martId}:${JSON.stringify(keys.map((k) => [k, pk[k]]))}`;
}
