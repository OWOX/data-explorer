import { knownFunctions } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { Field, Schema } from '../model/types';
import type { AvailableSourceDto, BlendableSchemaDto, Ctx, DataMartDetailDto } from '../sdk/types';

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
/** The alias of the parent mart's key field a join goes by (a field alias only, never the raw name), when it is known. */
export type KeyAlias = (source: AvailableSourceDto) => string | undefined;

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
    byPath.set(s.aliasPath, { aliasPath: s.aliasPath, martId: s.dataMartId, label, ...(label !== nameOf(s) ? { name: nameOf(s) } : {}), depth: s.depth, fields: [], uniqueCount: s.uniqueCountAvailability === 'available', mainGrainCollapse: collapseOf(s.mainGrainCollapse), mainGrainMultiplication: s.mainGrainMultiplication ?? 'unknown', ...(s.relationshipId ? { relationshipId: s.relationshipId } : {}) });
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

/**
 * The alias of the key field each colliding join goes by (relationship -> its first join condition -> that field of the parent mart),
 * read only when two joins would otherwise share a label. A failed read leaves the join without one (the ordinal then tells them apart).
 */
async function readKeyAlias(ctx: Ctx, martId: string, dto: BlendableSchemaDto, wanted: AvailableSourceDto[]): Promise<KeyAlias> {
  const aliases = new Map<string, string>();
  try {
    const edges = (await Promise.all((await ctx.owox.storages.list()).map((st) => ctx.owox.models.getEdges(st.id).catch(() => [])))).flat();
    const martOf = new Map((dto.availableSources ?? []).map((a) => [a.aliasPath, a.dataMartId]));
    const details = new Map<string, Promise<DataMartDetailDto | null>>();
    const detail = (id: string) => details.get(id) ?? details.set(id, ctx.owox.getJson<DataMartDetailDto>(`/api/data-marts/${encodeURIComponent(id)}`).catch(() => null)).get(id)!;
    await Promise.all(wanted.map(async (s) => {
      const key = edges.find((e) => e.id === s.relationshipId)?.joinConditions[0]?.sourceFieldName;
      const i = s.aliasPath.lastIndexOf('.');
      const parentId = i < 0 ? martId : martOf.get(s.aliasPath.slice(0, i));
      if (!key || !parentId) return;
      const alias = (await detail(parentId))?.schema?.fields?.find((f) => f.name === key)?.alias?.trim();
      if (alias && alias !== key) aliases.set(s.aliasPath, alias);
    }));
  } catch { /* the ordinal tells them apart */ }
  return (s) => aliases.get(s.aliasPath);
}

/** The joined sources of a mart; the join keys are read from the backend only when two joins would share a label. */
async function sourcesOf(ctx: Ctx, martId: string, dto: BlendableSchemaDto): Promise<JoinedSource[]> {
  const asked: AvailableSourceDto[] = [];
  const first = joinedSources(dto, (s) => { if (s.relationshipId) asked.push(s); return undefined; });
  return asked.length ? joinedSources(dto, await readKeyAlias(ctx, martId, dto, asked)) : first;
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
        .then((dto) => sourcesOf(ctx, martId, dto))
        .then((sources) => { if (inflight.get(martId) === p) done.set(martId, sources); return sources; })
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
