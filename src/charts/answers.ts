import type { TraverseOptions } from '../sdk/types';

// Key-sorted, so two option objects that differ only in property order compare equal. Arrays keep their order.
export const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));

const aggKey = (a: { column: string; function: string }): string => `${a.column}\u0000${a.function}`;
const same = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));

/** What a query reads, split into the parts the subset rule compares. */
function parts(o: TraverseOptions) {
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
  };
}

/**
 * True when the rows of a read with options `read` also answer a query `asked` (same mart and version are the caller's to check).
 * Everything except `column`, `aggregation` and `uniqueCount` must be equal, the group keys must be equal, and what `asked`
 * aggregates and counts must be a subset of what `read` did. The rows may carry extra keys: cards read by key.
 */
export function answersQuery(read: TraverseOptions, asked: TraverseOptions): boolean {
  const r = parts(read);
  const q = parts(asked);
  return r.rest === q.rest && same(r.keys, q.keys) && within(q.aggs, r.aggs) && within(q.unique, r.unique);
}
