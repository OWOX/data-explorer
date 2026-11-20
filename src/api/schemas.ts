import { knownFunctions } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { Schema } from '../model/types';
import type { Ctx, DataMartDetailDto } from '../sdk/types';

export interface SchemaLoader {
  get(id: string): Promise<Schema>;
  peek(id: string): Schema | undefined;
  /** Forget one mart's schema (and a read in flight), so the next ask reads the backend again. */
  invalidate(id: string): void;
  clear(): void;
}

export function createSchemaLoader(ctx: Ctx): SchemaLoader {
  const done = new Map<string, Schema>();
  const inflight = new Map<string, Promise<Schema>>();

  function get(id: string): Promise<Schema> {
    const hit = done.get(id);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(id);
    if (running) return running;
    const p = ctx.owox
      .getJson<DataMartDetailDto>(`/api/data-marts/${encodeURIComponent(id)}`)
      .then((d) => {
        const schema: Schema = (d.schema?.fields ?? [])
          // A calculated field has no warehouse column, so its status is not meaningful: keep it.
          // A field hidden for reporting is not offered anywhere: the backend rejects it in a column, filter, sort or report.
          .filter((f) => !f.isHiddenForReporting && (f.calculated !== undefined || f.status !== 'DISCONNECTED'))
          .map((f) => ({
            name: f.name,
            alias: f.alias ?? null,
            type: f.type,
            // A repeated field is an array, whatever its element type: only blank filters apply.
            category: f.mode === 'REPEATED' ? 'other' : categorizeFieldType(f.type),
            description: f.description ?? null,
            isPrimaryKey: f.isPrimaryKey === true,
            ...(f.calculated !== undefined ? { isCalculated: true } : {}),
            ...(Array.isArray(f.allowedAggregations) ? { allowedAggregations: knownFunctions(f.allowedAggregations) } : {}),
          }));
        if (inflight.get(id) === p) done.set(id, schema);
        return schema;
      })
      .finally(() => { if (inflight.get(id) === p) inflight.delete(id); });
    inflight.set(id, p);
    return p;
  }

  return {
    get,
    peek: (id) => done.get(id),
    invalidate(id) { done.delete(id); inflight.delete(id); },
    clear() { done.clear(); inflight.clear(); },
  };
}
