import type { Model } from '../model/types';

export type StorageOption = { id: string; title: string; type: string; count: number };

/** The storages the filter offers: those holding at least one mart, with how many. */
export function storageOptions(model: Model): StorageOption[] {
  const counts = new Map<string, number>();
  for (const m of model.marts.values()) counts.set(m.storageId, (counts.get(m.storageId) ?? 0) + 1);
  return model.storages.flatMap((s) => (counts.has(s.id) ? [{ ...s, count: counts.get(s.id)! }] : []));
}

/**
 * The storages the Data Marts band is narrowed to, or null for no narrowing. The filter is only
 * offered with two or more storages, and a ticked storage a refresh removed drops out here silently.
 */
export function tickedStorages(model: Model, storageIds: string[] | null): string[] | null {
  const offered = storageOptions(model).map((s) => s.id);
  if (offered.length < 2 || storageIds === null) return null;
  const still = storageIds.filter((id) => offered.includes(id));
  // Every ticked storage vanished: that is no choice the reader made, so fall back to all. An empty
  // set the reader chose (None) stays empty.
  return still.length === 0 && storageIds.length > 0 ? null : still;
}
