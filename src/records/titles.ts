import { IN_LIST_MAX } from '../config';
import { readRows } from '../api/rows';
import type { Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import type { RelColumn } from './relationships';
import { pickTitleField } from './title-field';

export async function lookupTitles(ctx: Ctx, rel: RelColumn, values: unknown[], relatedSchema: Schema, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const titleField = pickTitleField(relatedSchema);
  if (rel.composite || !titleField || titleField === rel.relatedField) return out;
  const target = relatedSchema.find((f) => f.name === rel.relatedField);
  const isNum = target?.category === 'number';
  const distinct = [...new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => (isNum ? Number(v) : String(v))))];
  for (let i = 0; i < distinct.length; i += IN_LIST_MAX) {
    const batch = distinct.slice(i, i + IN_LIST_MAX);
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
