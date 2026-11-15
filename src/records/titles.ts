import { IN_LIST_MAX, IN_LIST_MAX_CHARS } from '../config';
import { readRows } from '../api/rows';
import type { Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import type { RelColumn } from './relationships';
import { pickTitleField } from './title-field';

function batches<T extends string | number>(values: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 2; // the brackets
  for (const v of values) {
    const len = JSON.stringify(v).length + 1; // value plus comma
    if (cur.length > 0 && (cur.length >= IN_LIST_MAX || chars + len > IN_LIST_MAX_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 2;
    }
    cur.push(v);
    chars += len;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export async function lookupTitles(ctx: Ctx, rel: RelColumn, values: unknown[], relatedSchema: Schema, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const titleField = pickTitleField(relatedSchema);
  if (rel.direction === 'incoming' || rel.composite || !titleField || titleField === rel.relatedField) return out;
  const target = relatedSchema.find((f) => f.name === rel.relatedField);
  const isNum = target?.category === 'number';
  const distinct = [...new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => (isNum ? Number(v) : String(v))))];
  for (const batch of batches(distinct)) {
    const rows = await readRows(ctx, rel.relatedMartId, {
      column: [rel.relatedField, titleField],
      filter: [{ column: rel.relatedField, operator: 'in', value: batch as string[] | number[] }],
      limit: batch.length,
    }, { signal });
    for (const r of rows) {
      const t = r[titleField];
      if (t !== null && t !== undefined && String(t).trim() !== '') out.set(String(r[rel.relatedField]), String(t));
    }
  }
  return out;
}
