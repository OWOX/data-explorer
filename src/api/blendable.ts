import { knownFunctions } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { Edge, Field, Schema } from '../model/types';
import type { AvailableSourceDto, BlendableSchemaDto, Ctx } from '../sdk/types';

/** The backend's `isArrayFieldType`: ARRAY, bare or with a parameter (`ARRAY<STRING>`). */
export const isArrayType = (type: string | undefined) => /^ARRAY(?:\s*[<(]|$)/i.test(type?.trim() ?? '');

/** One joined data mart the Columns picker offers, with the fields of it a report can take. */
export type JoinedSource = {
  aliasPath: string;
  martId: string;
  /** What the picker and the column headers call it: the join's display prefix, with a business-readable tiebreaker added when two joins reach the same mart: the titles of the marts above it, the alias of the key it joins by, else an ordinal. */
  label: string;
  /** What the mart is called without anything that tells two joins to it apart; absent when that is the label. */
  name?: string;
  /** The join's Output Alias as the member typed it (trimmed); absent when the backend sends none. It equals the mart's title when never set. */
  outputAlias?: string;
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
  /** The model's edges and the loaded schemas, so two joins to one mart can be told apart by their key; the joins already read are labelled again and subscribers told. */
  useKeys(ctx: KeyContext): void;
}

/** The alias of the parent mart's key field a join goes by (a field alias only, never the raw name), when it is known. */
export type KeyAlias = (source: AvailableSourceDto) => string | undefined;

/** Joined fields of a mart as columns: only included, readable sources; no hidden or calculated field. Depth first, then the mart's own title (never the label, which a key alias or ordinal changes), so relabelling never reorders. */
export function joinedSources(dto: BlendableSchemaDto, keyAlias?: KeyAlias): JoinedSource[] {
  const offered = (dto.availableSources ?? []).filter((s) => s.isIncluded && s.isAccessibleForReporting);
  const byPath = new Map<string, JoinedSource>();
  const nameOf = (s: AvailableSourceDto) => (s.defaultAlias?.trim() || s.title);
  const labelUses = new Map<string, number>();
  offered.forEach((s) => labelUses.set(nameOf(s), (labelUses.get(nameOf(s)) ?? 0) + 1));
  // The titles of the marts along a path, parents only ("Contact › Organization"); a hop whose title is unknown is left out, never shown as its alias.
  const titleAt = new Map((dto.availableSources ?? []).map((s) => [s.aliasPath, nameOf(s)]));
  const humanPath = (path: string) => {
    const parts = path.split('.');
    return parts.slice(0, -1).map((_, i) => titleAt.get(parts.slice(0, i + 1).join('.'))).filter((t): t is string => !!t).join(' › ');
  };
  const withParts = (base: string, ...parts: (string | undefined)[]) => { const p = parts.filter(Boolean); return p.length ? `${base} (${p.join(', ')})` : base; };
  const labels = new Map<string, string>();
  const vias = new Map<string, string>();
  for (const s of offered) {
    const base = nameOf(s);
    const via = (labelUses.get(base) ?? 0) > 1 ? humanPath(s.aliasPath) : '';
    vias.set(s.aliasPath, via);
    labels.set(s.aliasPath, withParts(base, via));
  }
  // Labels that still collide (two joins at one depth, two parents with one title) are told apart by the alias of the key they join by, else by an ordinal in the order listed.
  const groups = new Map<string, typeof offered>();
  for (const s of offered) groups.set(labels.get(s.aliasPath)!, [...(groups.get(labels.get(s.aliasPath)!) ?? []), s]);
  for (const [label, group] of groups) {
    if (group.length < 2) continue;
    const keyed = group.map((s) => withParts(nameOf(s), vias.get(s.aliasPath), (() => { const k = keyAlias?.(s)?.trim(); return k ? `by ${k}` : undefined; })()));
    if (new Set(keyed).size === group.length && keyed.every((l) => l !== label)) group.forEach((s, i) => labels.set(s.aliasPath, keyed[i]!));
    else group.forEach((s, i) => { if (i > 0) labels.set(s.aliasPath, `${label} ${i + 1}`); });
  }
  for (const s of offered) {
    const label = labels.get(s.aliasPath)!;
    byPath.set(s.aliasPath, { aliasPath: s.aliasPath, martId: s.dataMartId, label, ...(label !== nameOf(s) ? { name: nameOf(s) } : {}), ...(s.defaultAlias?.trim() ? { outputAlias: s.defaultAlias.trim() } : {}), depth: s.depth, fields: [], uniqueCount: s.uniqueCountAvailability === 'available', mainGrainCollapse: collapseOf(s.mainGrainCollapse), mainGrainMultiplication: s.mainGrainMultiplication ?? 'unknown', ...(s.relationshipId ? { relationshipId: s.relationshipId } : {}) });
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
  return [...byPath.values()].filter((s) => s.fields.length > 0).sort((a, b) => a.depth - b.depth || (a.name ?? a.label).localeCompare(b.name ?? b.label) || a.aliasPath.localeCompare(b.aliasPath));
}

/** What the loader knows without a read: the model's edges and the schemas already loaded. */
export type KeyContext = { edges: Edge[]; schemaOf: (martId: string) => Schema | undefined };

/**
 * The alias of the key a join goes by: the join's relationship -> its first join condition -> that field of the parent mart,
 * from the parent's loaded schema (the main mart) or from the parent path's own blended fields. Only a set alias that differs from the raw name counts.
 */
export function keyAliasOf(martId: string, dto: BlendableSchemaDto, ctx: KeyContext): KeyAlias {
  return (s) => {
    const key = ctx.edges.find((e) => e.id === s.relationshipId)?.joins[0]?.sourceField;
    if (!key) return undefined;
    const i = s.aliasPath.lastIndexOf('.');
    const alias = i < 0
      ? ctx.schemaOf(martId)?.find((f) => f.name === key)?.alias
      : dto.blendedFields?.find((b) => b.aliasPath === s.aliasPath.slice(0, i) && b.originalFieldName === key)?.alias;
    const shown = alias?.trim();
    return shown && shown !== key ? shown : undefined;
  };
}

export function createBlendableLoader(ctx: Ctx): BlendableLoader {
  const done = new Map<string, JoinedSource[]>();
  const dtos = new Map<string, BlendableSchemaDto>();
  let keys: KeyContext | null = null;
  const label = (martId: string, dto: BlendableSchemaDto) => joinedSources(dto, keys ? keyAliasOf(martId, dto, keys) : undefined);
  const inflight = new Map<string, Promise<JoinedSource[]>>();
  const listeners = new Set<() => void>();
  return {
    get(martId) {
      const hit = done.get(martId);
      if (hit) return Promise.resolve(hit);
      const running = inflight.get(martId);
      if (running) return running;
      const p = ctx.owox.getJson<BlendableSchemaDto>(`/api/data-marts/${encodeURIComponent(martId)}/blendable-schema`)
        .then((dto) => { const sources = label(martId, dto); if (inflight.get(martId) === p) { done.set(martId, sources); dtos.set(martId, dto); } return sources; })
        .finally(() => { if (inflight.get(martId) === p) inflight.delete(martId); });
      inflight.set(martId, p);
      return p;
    },
    peek: (martId) => done.get(martId),
    invalidate(martId) { done.delete(martId); dtos.delete(martId); inflight.delete(martId); listeners.forEach((l) => l()); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    // Told like an invalidation: a read the clear dropped, or a mart read before it, is asked for again by whoever shows it.
    clear() { done.clear(); dtos.clear(); inflight.clear(); listeners.forEach((l) => l()); },
    useKeys(next) {
      keys = next;
      let changed = false;
      for (const [martId, dto] of dtos) {
        const now = label(martId, dto);
        if (now.map((x) => x.label).join('\n') !== done.get(martId)?.map((x) => x.label).join('\n')) { done.set(martId, now); changed = true; }
      }
      if (changed) listeners.forEach((l) => l());
    },
  };
}

/** The schema a grid reads and filters over: the mart's own fields, then the fields of the joined marts it has loaded. */
export const withJoined = (schema: Schema, sources: JoinedSource[]): Schema => {
  if (!sources.length) return schema;
  const all: Schema = [...schema, ...sources.flatMap((s) => s.fields)];
  // The main mart's declared key travels with its fields, so a key hidden for reporting is still known to the charts.
  if (schema.primaryKey) all.primaryKey = schema.primaryKey;
  // Which joined marts can count their records, so a saved view or a link is checked against it without the joined sources.
  all.joinedUniqueCount = sources.filter((s) => s.uniqueCount).map((s) => s.aliasPath);
  return all;
};
