import { perCtx } from '../sdk/per-ctx';
import type { Ctx, Row } from '../sdk/types';

/** How many opened rows a ctx keeps. The oldest is dropped first. */
export const SEEN_LIMIT = 32;

/** `columns`: the fields of the mart the grid's read carried, so a field outside it was not read. `stamp`: the model version the row was read under. */
export type SeenRow = { row: Row; columns: string[]; stamp: number };

// The row a grid click handed to the Row band, per ctx. Insertion order is the age.
const seenOf = perCtx(() => new Map<string, SeenRow>());

/** A mart and a key as the click dispatched it: the Row band looks it up with the same object. */
const keyOf = (martId: string, pk: Record<string, unknown>) => JSON.stringify([martId, pk]);

export function rememberRow(ctx: Ctx, martId: string, pk: Record<string, unknown>, seen: SeenRow) {
  const map = seenOf(ctx);
  const key = keyOf(martId, pk);
  map.delete(key);
  map.set(key, seen);
  if (map.size > SEEN_LIMIT) map.delete(map.keys().next().value!);
}

/** The row opened for this record, if it was read under this model version. */
export function seenRow(ctx: Ctx, martId: string, pk: Record<string, unknown>, stamp: number): SeenRow | undefined {
  const hit = seenOf(ctx).get(keyOf(martId, pk));
  return hit && hit.stamp === stamp ? hit : undefined;
}

/** The grid's Refresh drops what it loaded, so rows it handed over before are not answers any more. */
export function forgetSeenRows(ctx: Ctx, martId: string) {
  const seen = seenOf(ctx);
  for (const k of seen.keys()) if ((JSON.parse(k) as [string])[0] === martId) seen.delete(k);
}
