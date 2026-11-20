import { knownFunctions } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { Field, Schema } from '../model/types';
import type { BlendableSchemaDto, Ctx } from '../sdk/types';

/** The backend's `isArrayFieldType`: ARRAY, bare or with a parameter (`ARRAY<STRING>`). */
export const isArrayType = (type: string | undefined) => /^ARRAY(?:\s*[<(]|$)/i.test(type?.trim() ?? '');

/** One joined data mart the Columns picker offers, with the fields of it a report can take. */
export type JoinedSource = {
  aliasPath: string;
  martId: string;
  /** What the picker and the column headers call it: the join's display prefix, with the alias path added when two joins reach the same mart. */
  label: string;
  depth: number;
  fields: Field[];
  /** A uniqueCount on this alias path works (the backend says `available`): the joined mart has a usable primary key. */
  uniqueCount: boolean;
  /** The relationship (edge) that exposes this source, when the backend says. */
  relationshipId?: string;
};

export interface BlendableLoader {
  /** The joined sources of a mart; read once per mart (a failure is not remembered, so the next ask reads again). */
  get(martId: string): Promise<JoinedSource[]>;
  peek(martId: string): JoinedSource[] | undefined;
  /** Forget one mart's joined sources (and a read in flight), so the next ask reads the backend again. */
  invalidate(martId: string): void;
  /** Called whenever a mart's joined sources were forgotten, so a holder of its own copy reads them again. */
  subscribe(fn: () => void): () => void;
  clear(): void;
}

/** Joined fields of a mart as columns: only included, readable sources; no hidden or calculated field. Depth first, then title. */
export function joinedSources(dto: BlendableSchemaDto): JoinedSource[] {
  const offered = (dto.availableSources ?? []).filter((s) => s.isIncluded && s.isAccessibleForReporting);
  const byPath = new Map<string, JoinedSource>();
  const nameOf = (s: (typeof offered)[number]) => (s.defaultAlias?.trim() || s.title);
  const labelUses = new Map<string, number>();
  offered.forEach((s) => labelUses.set(nameOf(s), (labelUses.get(nameOf(s)) ?? 0) + 1));
  for (const s of offered) {
    const base = nameOf(s);
    byPath.set(s.aliasPath, { aliasPath: s.aliasPath, martId: s.dataMartId, label: (labelUses.get(base) ?? 0) > 1 ? `${base} (${s.aliasPath})` : base, depth: s.depth, fields: [], uniqueCount: s.uniqueCountAvailability === 'available', ...(s.relationshipId ? { relationshipId: s.relationshipId } : {}) });
  }
  for (const b of dto.blendedFields ?? []) {
    const source = byPath.get(b.aliasPath);
    if (!source || b.isHidden || b.isCalculated) continue;
    source.fields.push({
      name: b.name,
      alias: b.alias?.trim() ? b.alias : b.originalFieldName,
      type: b.type,
      // An array-valued source field only filters on blank, whatever type the join gives it (the backend's own check).
      category: isArrayType(b.sourceFieldType) ? 'other' : categorizeFieldType(b.type),
      description: b.description?.trim() ? b.description : null,
      isPrimaryKey: false,
      ...(Array.isArray(b.postJoinAggregations) ? { postJoinAggregations: knownFunctions(b.postJoinAggregations) } : {}),
      joined: { martId: source.martId, label: source.label, aliasPath: source.aliasPath, originalName: b.originalFieldName, ...(b.sourceFieldType ? { sourceType: b.sourceFieldType } : {}), ...(typeof b.aggregateFunction === 'string' && b.aggregateFunction ? { aggregateFunction: b.aggregateFunction } : {}) },
    });
  }
  return [...byPath.values()].filter((s) => s.fields.length > 0).sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label) || a.aliasPath.localeCompare(b.aliasPath));
}

export function createBlendableLoader(ctx: Ctx): BlendableLoader {
  const done = new Map<string, JoinedSource[]>();
  const inflight = new Map<string, Promise<JoinedSource[]>>();
  const listeners = new Set<() => void>();
  return {
    get(martId) {
      const hit = done.get(martId);
      if (hit) return Promise.resolve(hit);
      const running = inflight.get(martId);
      if (running) return running;
      const p = ctx.owox.getJson<BlendableSchemaDto>(`/api/data-marts/${encodeURIComponent(martId)}/blendable-schema`)
        .then((dto) => { const sources = joinedSources(dto); if (inflight.get(martId) === p) done.set(martId, sources); return sources; })
        .finally(() => { if (inflight.get(martId) === p) inflight.delete(martId); });
      inflight.set(martId, p);
      return p;
    },
    peek: (martId) => done.get(martId),
    invalidate(martId) { done.delete(martId); inflight.delete(martId); listeners.forEach((l) => l()); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    clear() { done.clear(); },
  };
}

/** The schema a grid reads and filters over: the mart's own fields, then the fields of the joined marts it has loaded. */
export const withJoined = (schema: Schema, sources: JoinedSource[]): Schema => (sources.length ? [...schema, ...sources.flatMap((s) => s.fields)] : schema);
