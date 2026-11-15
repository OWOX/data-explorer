import type { Ctx } from '../sdk/types';

export const PREFERENCES_COLLECTION = 'preferences';
const DOC_ID = 'bands';
type BandsDoc = { folded: Record<string, boolean> };

export interface Preferences {
  /** The member's saved fold choice per band id; empty when there is none or the read failed. */
  loadFolded(): Promise<Record<string, boolean>>;
  /** Saves the fold choices. One write per call; a failure is logged and changes nothing on screen. */
  saveFolded(folded: Record<string, boolean>): void;
}

export function createPreferences(ctx: Ctx): Preferences {
  const col = ctx.collections<BandsDoc>(PREFERENCES_COLLECTION);
  return {
    async loadFolded() {
      try {
        const folded = (await col.get(DOC_ID))?.document?.folded;
        if (!folded || typeof folded !== 'object') return {};
        return Object.fromEntries(Object.entries(folded).filter(([, v]) => typeof v === 'boolean'));
      } catch (e) {
        console.warn('Reading the band preferences failed', e);
        return {};
      }
    },
    saveFolded(folded) {
      Promise.resolve()
        .then(() => col.put(DOC_ID, { folded }))
        .catch((e) => console.warn('Saving the band preferences failed', e));
    },
  };
}
