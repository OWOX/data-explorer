import type { Ctx } from '../sdk/types';

export const PREFERENCES_COLLECTION = 'preferences';
const DOC_ID = 'bands';
const SEARCH_DOC_ID = 'search';
type SearchDoc = { aiHintDismissed?: boolean };
const VIEW_DOC_ID = 'marts-view';
type ViewDoc = { view?: unknown };
const MAIN_MART_DOC_ID = 'main-mart';
type MainMartDoc = { martId?: unknown; sourceKey?: unknown };
export type MainMart = { martId: string; sourceKey: string | null };
type BandsDoc = { folded: Record<string, boolean> };

export interface Preferences {
  /** The member's saved fold choice per band id; empty when there is none or the read failed. */
  loadFolded(): Promise<Record<string, boolean>>;
  /** Saves the fold choices. One write per call; a failure is logged and changes nothing on screen. */
  saveFolded(folded: Record<string, boolean>): void;
  /** Whether the member dismissed the hint that suggests plugging AI in; false when unknown or the read failed. */
  loadAiHintDismissed(): Promise<boolean>;
  /** Remembers the dismissal. One write; a failure is logged and changes nothing on screen. */
  dismissAiHint(): void;
  /** The member's saved Data Marts view; grid when there is none, it is unknown or the read failed. */
  loadMartsView(): Promise<'grid' | 'canvas'>;
  /** Saves the Data Marts view. One write; a failure is logged and changes nothing on screen. */
  saveMartsView(view: 'grid' | 'canvas'): void;
  /** The main data mart the member had last, with the source selected beside it; null when there is none, undefined when the read failed (what is stored is unknown). */
  loadMainMart(): Promise<MainMart | null | undefined>;
  /** Remembers the main data mart. One write; a failure is logged and changes nothing on screen. */
  saveMainMart(sel: MainMart): void;
}

export function createPreferences(ctx: Ctx): Preferences {
  // One document in the preferences collection: a read that never throws and a write that is logged when it fails.
  const doc = <T,>(id: string, what: string) => {
    const col = ctx.collections<T>(PREFERENCES_COLLECTION);
    return {
      async read(): Promise<T | undefined> {
        return (await this.tryRead()).document;
      },
      /** Like `read`, but says whether the read failed, so "nothing stored" and "could not tell" differ. */
      async tryRead(): Promise<{ document: T | undefined; failed: boolean }> {
        try {
          return { document: (await col.get(id))?.document, failed: false };
        } catch (e) {
          console.warn(`Reading the ${what} failed`, e);
          return { document: undefined, failed: true };
        }
      },
      write(d: T) {
        Promise.resolve()
          .then(() => col.put(id, d))
          .catch((e) => console.warn(`Saving the ${what} failed`, e));
      },
    };
  };
  const bands = doc<BandsDoc>(DOC_ID, 'band preferences');
  const search = doc<SearchDoc>(SEARCH_DOC_ID, 'search preferences');
  const view = doc<ViewDoc>(VIEW_DOC_ID, 'Data Marts view');
  const mainMart = doc<MainMartDoc>(MAIN_MART_DOC_ID, 'main data mart');
  return {
    async loadFolded() {
      const folded = (await bands.read())?.folded;
      if (!folded || typeof folded !== 'object') return {};
      return Object.fromEntries(Object.entries(folded).filter(([, v]) => typeof v === 'boolean'));
    },
    saveFolded: (folded) => bands.write({ folded }),
    loadAiHintDismissed: async () => (await search.read())?.aiHintDismissed === true,
    dismissAiHint: () => search.write({ aiHintDismissed: true }),
    loadMartsView: async () => ((await view.read())?.view === 'canvas' ? 'canvas' : 'grid'),
    saveMartsView: (v) => view.write({ view: v }),
    async loadMainMart() {
      const { document: d, failed } = await mainMart.tryRead();
      if (failed) return undefined;
      if (!d || typeof d.martId !== 'string' || !d.martId) return null;
      return { martId: d.martId, sourceKey: typeof d.sourceKey === 'string' && d.sourceKey ? d.sourceKey : null };
    },
    saveMainMart: ({ martId, sourceKey }) => mainMart.write({ martId, sourceKey }),
  };
}
