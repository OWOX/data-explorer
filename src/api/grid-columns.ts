import type { Ctx } from '../sdk/types';

export const GRID_COLUMNS_COLLECTION = 'grid-columns';
export const SAVE_DEBOUNCE_MS = 500;
/** The joined fields last chosen for each joined data mart, per main data mart: `{ customers: ['customers__city'] }`. An empty list means "none, use the default next time". */
export type Picks = Record<string, string[]>;
type ColumnsDoc = { columns: string[]; at: string; picks?: Picks };

export interface ColumnStore {
  /** The member's saved column names for a mart, or null when there are none or the read failed. */
  load(martId: string): Promise<string[] | null>;
  /** The joined fields last chosen per joined data mart for this main data mart (read once; empty when none or the read failed). */
  loadPicks(martId: string): Promise<Picks>;
  /** What `loadPicks` read, with this session's changes; empty until it has been read. */
  picks(martId: string): Picks;
  /** Saves after a short pause; the last call for a mart wins. `picks` merges into the remembered joined picks. Never throws. */
  save(martId: string, columns: string[], picks?: Picks): void;
}

const validPicks = (raw: unknown): Picks => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([k, v]) => (Array.isArray(v) ? [[k, v.filter((x): x is string => typeof x === 'string')]] : [])));
};

export function createColumnStore(ctx: Ctx): ColumnStore {
  const col = ctx.collections<ColumnsDoc>(GRID_COLUMNS_COLLECTION);
  const cache = new Map<string, string[] | null>();
  const picked = new Map<string, Picks>();
  const patches = new Map<string, Picks>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const reads = new Map<string, Promise<string[] | null>>();

  async function read(martId: string): Promise<string[] | null> {
    try {
      const found = await col.get(martId);
      const doc = found?.document;
      const columns = Array.isArray(doc?.columns) ? doc.columns.filter((c) => typeof c === 'string') : null;
      // A save that landed while the read was out is newer than what it read.
      if (!cache.has(martId)) cache.set(martId, columns);
      if (!picked.has(martId)) picked.set(martId, validPicks(doc?.picks));
      return cache.get(martId)!;
    } catch {
      return null;
    } finally {
      reads.delete(martId);
    }
  }

  function load(martId: string): Promise<string[] | null> {
    if (cache.has(martId) && picked.has(martId)) return Promise.resolve(cache.get(martId)!);
    // Concurrent loads (StrictMode mounts twice) share one read.
    let pending = reads.get(martId);
    if (!pending) { pending = read(martId); reads.set(martId, pending); }
    return pending;
  }

  const picksOf = (martId: string): Picks => ({ ...picked.get(martId), ...patches.get(martId) });

  return {
    load(martId) {
      // A list saved in this session is served from memory (the picks, if wanted, are read when they are).
      if (cache.has(martId)) return Promise.resolve(cache.get(martId)!);
      return load(martId);
    },
    async loadPicks(martId) {
      if (!picked.has(martId)) await load(martId);
      return picksOf(martId);
    },
    picks: picksOf,
    save(martId, columns, picks) {
      cache.set(martId, columns);
      if (picks) patches.set(martId, { ...patches.get(martId), ...picks });
      clearTimeout(timers.get(martId));
      timers.set(martId, setTimeout(() => {
        timers.delete(martId);
        Promise.resolve()
          .then(async () => {
            // Saved picks that were never read are read first, so a plain column save does not erase them.
            if (!picked.has(martId)) await load(martId);
            const merged = picksOf(martId);
            picked.set(martId, merged);
            patches.delete(martId);
            await col.put(martId, { columns: cache.get(martId) ?? columns, at: new Date().toISOString(), ...(Object.keys(merged).length ? { picks: merged } : {}) });
          })
          .catch((e) => console.warn('Saving the column selection failed', e));
      }, SAVE_DEBOUNCE_MS));
    },
  };
}
