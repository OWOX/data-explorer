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
  /** What the picker and the column headers call it: the join's display prefix, with the parent marts' titles added when two joins reach the same mart. */
  label: string;
  /** The titles of the marts this one is reached through ("Contact › Organization"); absent for a mart the main one joins directly. */
  via?: string;
  depth: number;
  fields: Field[];
  /** A uniqueCount on this alias path works (the backend says `available`): the joined mart has a usable primary key. */
  uniqueCount: boolean;
  /** The relationship (edge) that exposes this source, when the backend says. */
  relationshipId?: string;
  /** Whether joins down to this source leave the main mart's rows whole: 'none' when every hop is keyed by its target's primary key (a lookup), else 'collapses' (also when the backend does not say). */
  mainGrainCollapse?: MainGrainCollapse;
  /** One-to-many: 'none' when every hop is keyed by its parent's primary key, else 'multiplies' or 'unknown' (also when the backend does not say). */
  mainGrainMultiplication?: 'none' | 'multiplies' | 'unknown';
};

export type MainGrainCollapse = 'none' | 'collapses';
const collapseOf = (v: unknown): MainGrainCollapse => (v === 'none' ? 'none' : 'collapses');

const owners = new WeakMap<JoinedSource[], Map<string, JoinedSource>>();
/** The source a field name belongs to (the first, when two sources carry the same name), built once per sources array. */
export function sourceOfField(sources: JoinedSource[]): Map<string, JoinedSource> {
  let map = owners.get(sources);
  if (!map) {
    map = new Map();
    for (const s of sources) for (const f of s.fields) if (!map.has(f.name)) map.set(f.name, s);
    owners.set(sources, map);
  }
  return map;
}

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
  // The titles of the marts along a path, parents only ("Contact › Organization"); a hop whose title is unknown is left out, never shown as its alias.
  const titleAt = new Map((dto.availableSources ?? []).map((s) => [s.aliasPath, nameOf(s)]));
  const humanPath = (path: string) => {
    const parts = path.split('.');
    return parts.slice(0, -1).map((_, i) => titleAt.get(parts.slice(0, i + 1).join('.'))).filter((t): t is string => !!t).join(' › ');
  };
  for (const s of offered) {
    const base = nameOf(s);
    const via = humanPath(s.aliasPath);
    byPath.set(s.aliasPath, { aliasPath: s.aliasPath, martId: s.dataMartId, label: via && (labelUses.get(base) ?? 0) > 1 ? `${base} (${via})` : base, ...(via ? { via } : {}), depth: s.depth, fields: [], uniqueCount: s.uniqueCountAvailability === 'available', mainGrainCollapse: collapseOf(s.mainGrainCollapse), mainGrainMultiplication: s.mainGrainMultiplication ?? 'unknown', ...(s.relationshipId ? { relationshipId: s.relationshipId } : {}) });
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
    clear() { done.clear(); inflight.clear(); },
  };
}

/** The schema a grid reads and filters over: the mart's own fields, then the fields of the joined marts it has loaded. */
export const withJoined = (schema: Schema, sources: JoinedSource[]): Schema => {
  if (!sources.length) return schema;
  const all: Schema = [...schema, ...sources.flatMap((s) => s.fields)];
  // The main mart's declared key travels with its fields, so a key hidden for reporting is still known to the charts.
  if (schema.primaryKey) all.primaryKey = schema.primaryKey;
  return all;
};
