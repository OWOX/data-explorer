import { useCallback } from 'react';
import { PAGE_SIZE } from '../config';
import { leaveAll } from './join-plan';
import { useServices, useStore } from './store';

/**
 * For a move that is not a card click (a source picked, a record opened, a link followed): the marts that leave the grid save
 * the fields they were showing, as a card click does. Call it before the move is dispatched. Reads only the member's own
 * grid-columns document (and the joins, which are already loaded for the grid); nothing is saved when nothing is known.
 */
export function useRememberLeaving(): (nextMartId: string | null) => void {
  const [state] = useStore();
  const { blendable, columnStore } = useServices();
  const main = state.selection.martId;
  const grid = main ? state.grids[main] : undefined;
  return useCallback((nextMartId) => {
    if (!main || main === nextMartId) return;
    void (async () => {
      const shown = grid && grid.columns.length > 0 ? grid : undefined;
      const columns = shown ? shown.columns : await columnStore.load(main);
      if (!columns || columns.length === 0) return;
      // Not in the store yet: the saved view holds the Unique Counts and the marts kept with no column.
      const view = shown ? undefined : await columnStore.loadView(main).catch(() => null);
      const uniqueCount = shown ? shown.uniqueCount : view?.uniqueCount;
      const emptyPaths = shown ? shown.emptyPaths : view?.emptyPaths;
      const sources = await blendable.get(main);
      const left = leaveAll(main, sources, { columns, filters: {}, sorts: null, limit: PAGE_SIZE, uniqueCount, emptyPaths });
      for (const r of left) columnStore.saveLastShown(r.martId, r.fields);
    })().catch(() => undefined);
  }, [main, grid, blendable, columnStore]);
}
