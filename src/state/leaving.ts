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
      const columns = grid && grid.columns.length > 0 ? grid.columns : await columnStore.load(main);
      if (!columns || columns.length === 0) return;
      const sources = await blendable.get(main);
      const left = leaveAll(main, sources, { columns, filters: {}, sorts: null, limit: PAGE_SIZE });
      for (const r of left) columnStore.saveLastShown(r.martId, r.fields);
    })().catch(() => undefined);
  }, [main, grid, blendable, columnStore]);
}
