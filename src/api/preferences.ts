import type { Ctx } from '../sdk/types';

export const PREFERENCES_COLLECTION = 'preferences';
const DOC_ID = 'bands';
const SEARCH_DOC_ID = 'search';
type SearchDoc = { aiHintDismissed?: boolean };
const VIEW_DOC_ID = 'marts-view';
type ViewDoc = { view?: unknown };
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
    async loadAiHintDismissed() {
      try {
        return (await ctx.collections<SearchDoc>(PREFERENCES_COLLECTION).get(SEARCH_DOC_ID))?.document?.aiHintDismissed === true;
      } catch (e) {
        console.warn('Reading the search preferences failed', e);
        return false;
      }
    },
    dismissAiHint() {
      Promise.resolve()
        .then(() => ctx.collections<SearchDoc>(PREFERENCES_COLLECTION).put(SEARCH_DOC_ID, { aiHintDismissed: true }))
        .catch((e) => console.warn('Saving the search preferences failed', e));
    },
    async loadMartsView() {
      try {
        const v = (await ctx.collections<ViewDoc>(PREFERENCES_COLLECTION).get(VIEW_DOC_ID))?.document?.view;
        return v === 'canvas' ? 'canvas' : 'grid';
      } catch (e) {
        console.warn('Reading the Data Marts view failed', e);
        return 'grid';
      }
    },
    saveMartsView(view) {
      Promise.resolve()
        .then(() => ctx.collections<ViewDoc>(PREFERENCES_COLLECTION).put(VIEW_DOC_ID, { view }))
        .catch((e) => console.warn('Saving the Data Marts view failed', e));
    },
  };
}
