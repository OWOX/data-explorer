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

  return {
    async load(martId) {
      if (cache.has(martId)) return cache.get(martId)!;
      try {
        const found = await col.get(martId);
        const columns = Array.isArray(found?.document.columns) ? found.document.columns.filter((c) => typeof c === 'string') : null;
        // A save that landed while the read was out is newer than what it read.
        if (!cache.has(martId)) cache.set(martId, columns);
        return cache.get(martId)!;
      } catch {
        return null;
      }
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
