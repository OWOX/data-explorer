import type { Ctx } from '../sdk/types';

export const GRID_COLUMNS_COLLECTION = 'grid-columns';
export const SAVE_DEBOUNCE_MS = 500;
type ColumnsDoc = { columns: string[]; at: string };

export interface ColumnStore {
  /** The member's saved column names for a mart, or null when there are none or the read failed. */
  load(martId: string): Promise<string[] | null>;
  /** Saves after a short pause; the last call for a mart wins. Never throws. */
  save(martId: string, columns: string[]): void;
}

export function createColumnStore(ctx: Ctx): ColumnStore {
  const col = ctx.collections<ColumnsDoc>(GRID_COLUMNS_COLLECTION);
  const cache = new Map<string, string[] | null>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const reads = new Map<string, Promise<string[] | null>>();

  async function read(martId: string): Promise<string[] | null> {
    try {
      const found = await col.get(martId);
      const doc = found?.document;
      const columns = Array.isArray(doc?.columns) ? doc.columns.filter((c) => typeof c === 'string') : null;
      // A save that landed while the read was out is newer than what it read.
      if (!cache.has(martId)) cache.set(martId, columns);
      return cache.get(martId)!;
    } catch {
      return null;
    } finally {
      reads.delete(martId);
    }
  }

  return {
    load(martId) {
      if (cache.has(martId)) return Promise.resolve(cache.get(martId)!);
      // Concurrent loads (StrictMode mounts twice) share one read.
      let pending = reads.get(martId);
      if (!pending) { pending = read(martId); reads.set(martId, pending); }
      return pending;
    },
    save(martId, columns) {
      cache.set(martId, columns);
      clearTimeout(timers.get(martId));
      timers.set(martId, setTimeout(() => {
        timers.delete(martId);
        Promise.resolve()
          .then(() => col.put(martId, { columns, at: new Date().toISOString() }))
          .catch((e) => console.warn('Saving the column selection failed', e));
      }, SAVE_DEBOUNCE_MS));
    },
  };
}
