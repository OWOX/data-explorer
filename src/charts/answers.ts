import type { JoinedSource } from '../api/blendable';
import type { TraverseOptions } from '../sdk/types';

// Key-sorted, so two option objects that differ only in property order compare equal. Arrays keep their order.
export const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));

const aggKey = (a: { column: string; function: string }): string => `${a.column}\u0000${a.function}`;
const same = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));

/** What the subset rule needs to know about the joins: which alias path a column is read through, and whether dropping that join leaves the main mart's grain whole. */
export type JoinGrain = { pathOf(column: string): string | undefined; keepsGrain(path: string): boolean };

/** The join grain of a grid's sources: a join is safe to drop when it neither collapses nor multiplies the main rows ('none' on both; a backend that does not say counts as unsafe). */
export function joinGrainOf(sources: JoinedSource[]): JoinGrain {
  const owner = new Map<string, string>();
  const safe = new Map<string, boolean>();
  for (const s of sources) {
    safe.set(s.aliasPath, s.mainGrainCollapse === 'none' && s.mainGrainMultiplication === 'none');
    for (const f of s.fields) if (!owner.has(f.name)) owner.set(f.name, s.aliasPath);
  }
  return { pathOf: (c) => owner.get(c), keepsGrain: (p) => safe.get(p) === true };
}

/** A query split into the parts the subset rule compares; computed once per read and per ask. */
export type QueryParts = { rest: string; keys: Set<string>; aggs: Set<string>; unique: Set<string>; columns: string[]; grouped: boolean };

export function partsOf(o: TraverseOptions): QueryParts {
  const aggs = o.aggregation ?? [];
  const aggregated = new Set(aggs.map((a) => a.column));
  const rest: Partial<TraverseOptions> = { ...o };
  delete rest.column;
  delete rest.aggregation;
  delete rest.uniqueCount;
  return {
    rest: stable(rest),
    keys: new Set((o.column ?? []).filter((c) => !aggregated.has(c))),
    aggs: new Set(aggs.map(aggKey)),
    unique: new Set(o.uniqueCount ?? []),
    columns: o.column ?? [],
    grouped: aggs.length > 0 || (o.uniqueCount?.length ?? 0) > 0 || (o.dateTrunc?.length ?? 0) > 0,
  };
}

/** The joined alias paths a query reads through: its columns' paths and its unique-count paths, the main mart's own ('') left out. */
function joinPaths(p: QueryParts, joins: JoinGrain): Set<string> {
  const out = new Set<string>();
  for (const c of p.columns) { const path = joins.pathOf(c); if (path) out.add(path); }
  for (const path of p.unique) if (path) out.add(path);
  return out;
}

/**
 * True when the rows of a read `read` also answer a query `asked` (same mart and version are the caller's to check).
 * Everything except `column`, `aggregation` and `uniqueCount` must be equal, both must group or both must not, the group keys must be equal,
 * and what `asked` aggregates and counts must be a subset of what `read` did. The rows may carry extra keys: cards read by key.
 * A join the read had and the query dropped must keep the main mart's grain (`joins.keepsGrain`), else the main mart's totals differ.
 */
export function answers(read: QueryParts, asked: QueryParts, joins: JoinGrain): boolean {
  if (read.rest !== asked.rest || read.grouped !== asked.grouped) return false;
  if (!same(read.keys, asked.keys) || !within(asked.aggs, read.aggs) || !within(asked.unique, read.unique)) return false;
  // A query that keeps 'customers.countries' still joins through 'customers', though no column or count sits on it.
  const kept = new Set<string>();
  for (const path of joinPaths(asked, joins)) { const parts = path.split('.'); for (let i = 1; i <= parts.length; i++) kept.add(parts.slice(0, i).join('.')); }
  for (const path of joinPaths(read, joins)) if (!kept.has(path) && !joins.keepsGrain(path)) return false;
  return true;
}

const NO_JOINS: JoinGrain = { pathOf: () => undefined, keepsGrain: () => true };
/** `answers` on two option objects; with no `joins` every column is the main mart's. */
export const answersQuery = (read: TraverseOptions, asked: TraverseOptions, joins: JoinGrain = NO_JOINS): boolean => answers(partsOf(read), partsOf(asked), joins);
