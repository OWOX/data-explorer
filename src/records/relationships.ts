import type { ColumnFilter } from '../filters/build';
import { isDateTimeField } from '../filters/catalogue';
import type { Edge, Field, Schema } from '../model/types';
import { isDayType } from '../model/field-category';
import type { Row } from '../sdk/types';

/** A field of the mart a data mart read may name: an offered one, or one hidden for reporting that the read still takes. */
export function readableField(schema: Schema, name: string): Field | undefined {
  return schema.find((f) => f.name === name && !f.joined) ?? schema.hiddenFields?.find((f) => f.name === name);
}

/**
 * The key fields a row is read and opened by: the declared key, hidden parts included, when a read can name every part.
 * A part it cannot name (inside a RECORD, or hidden and calculated) leaves no key: a partial key would open another row.
 */
export function primaryKeys(schema: Schema): string[] {
  const key = schema.primaryKey;
  if (key) return key.every((k) => readableField(schema, k)) ? [...key] : [];
  return schema.filter((f) => f.isPrimaryKey).map((f) => f.name);
}

/** Whether every part of the key is a group column of a grouped grid (shown, no function, no date bucket): each group is then one record, opened by the key values in its row. */
export function keyIsGrouped(keys: readonly string[], shown: readonly string[], agg: { aggregations: readonly { column: string }[]; dateTrunc: readonly { column: string }[] }): boolean {
  return keys.length > 0 && keys.every((k) => shown.includes(k) && !agg.aggregations.some((r) => r.column === k) && !agg.dateTrunc.some((r) => r.column === k));
}

/** Whether the main mart has a primary key at all, a hidden one included: Unique Count counts by it, a column or sort cannot name it. */
export function hasPrimaryKey(schema: Schema): boolean {
  // The loader's declared key decides when it is there: a key with a disconnected component is no key, whatever flags the other fields carry.
  return schema.primaryKey ? schema.primaryKey.length > 0 : schema.some((f) => f.isPrimaryKey && !f.joined);
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
  if (field && isDayType(field.type)) return { field: name, op: 'on', value: v };
  return { field: name, op: 'eq', value: v };
}

/** Filters on `targetSchema` for every join: `join.targetField = row[join.sourceField]`. Null when a value is blank. */
export function joinFilters(joins: { sourceField: string; targetField: string }[], row: Row, targetSchema: Schema): ColumnFilter[] | null {
  if (joins.some((j) => blank(row[j.sourceField]))) return null;
  return joins.map((j) => equalsFilter(targetSchema.find((f) => f.name === j.targetField), j.targetField, row[j.sourceField]));
}

export function recordTabId(martId: string, pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return `record:${martId}:${JSON.stringify(keys.map((k) => [k, pk[k]]))}`;
}
