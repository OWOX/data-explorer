import { knownFunctions } from '../model/aggregation';
import { SCHEMA_CONCURRENCY } from '../config';
import { categorizeFieldType } from '../model/field-category';
import type { Schema } from '../model/types';
import type { Ctx, DataMartDetailDto } from '../sdk/types';
import { runPool } from './pool';

export interface SchemaLoader {
  get(id: string): Promise<Schema>;
  peek(id: string): Schema | undefined;
  prefetch(ids: string[], priority?: string[]): Promise<void>;
  subscribe(fn: () => void): () => void;
  clear(): void;
}

export function createSchemaLoader(ctx: Ctx): SchemaLoader {
  const done = new Map<string, Schema>();
  const inflight = new Map<string, Promise<Schema>>();
  const listeners = new Set<() => void>();

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
        done.set(id, schema);
        listeners.forEach((l) => l());
        return schema;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  return {
    get,
    peek: (id) => done.get(id),
    async prefetch(ids, priority = []) {
      const first = priority.filter((id) => ids.includes(id));
      const ordered = [...first, ...ids.filter((id) => !first.includes(id))];
      await runPool(ordered, SCHEMA_CONCURRENCY, get);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    clear() { done.clear(); },
  };
}
