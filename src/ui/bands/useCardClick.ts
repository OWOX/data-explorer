import { useCallback, useEffect, useRef } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { Picks } from '../../api/grid-columns';
import { PAGE_SIZE } from '../../config';
import { joinedMartIds, planClick } from '../../state/join-plan';
import { sourceOfModel, useServices, useStore, type GridState, type State } from '../../state/store';
import type { Model } from '../../model/types';
import { defaultColumns } from '../explorer/useMartRows';

/**
 * What a click on a data mart card does: add it to the main mart's grid, take it out, promote it, or make it the main mart.
 * What the plan needs (the joined marts of the main one and of the next main, their grids, the remembered picks) is read first;
 * the whole change is then one store step, so Undo takes it back as one.
 */
export function useCardClick(model: Model): (id: string) => Promise<void> {
  const [state, dispatch] = useStore();
  const { blendable, columnStore, schemas } = useServices();
  const latest = useRef<State>(state);
  useEffect(() => { latest.current = state; });

  return useCallback(async (id: string) => {
    const main = latest.current.selection.martId;
    const sources = new Map<string, JoinedSource[]>();
    const grids = new Map<string, GridState>();
    const picks = new Map<string, Picks>();
    const load = async (martId: string) => {
      const own = await schemas.get(martId).catch(() => []);
      const joined = await blendable.get(martId).catch(() => [] as JoinedSource[]);
      sources.set(martId, joined);
      const have = latest.current.grids[martId];
      if (have && have.columns.length > 0) grids.set(martId, have);
      else {
        const saved = (await columnStore.load(martId)) ?? [];
        const offered = new Set([...own, ...joined.flatMap((s) => s.fields)].map((f) => f.name));
        const kept = saved.filter((c) => offered.has(c));
        grids.set(martId, { filters: {}, sorts: null, limit: PAGE_SIZE, ...have, columns: kept.length ? kept : defaultColumns(own) });
      }
      picks.set(martId, await columnStore.loadPicks(martId));
    };
    if (main) {
      await load(main);
      if (id === main) {
        const next = joinedMartIds(grids.get(main)!.columns, sources.get(main)!)[0];
        if (next) await load(next);
      }
    }
    const now = latest.current;
    // The member moved on while this was being read.
    if (now.selection.martId !== main) return;
    const sourceOf = sourceOfModel(model);
    const fresh = (martId: string) => { const g = now.grids[martId]; return g && g.columns.length > 0 ? g : grids.get(martId); };
    const plan = planClick({
      selection: now.selection,
      sourceKeyFor: (martId) => (now.selection.sourceKey && sourceOf(martId) === now.selection.sourceKey ? now.selection.sourceKey : null),
      sourcesOf: (martId) => sources.get(martId) ?? [],
      gridOf: (martId) => fresh(martId) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE },
      ownColumns: (martId) => defaultColumns(schemas.peek(martId) ?? []),
      picksOf: (martId) => picks.get(martId) ?? {},
    }, id);
    if (Object.keys(plan.grids).length === 0 && plan.selection.martId && !plan.selection.cleared) dispatch({ type: 'selectMart', id: plan.selection.martId, sourceOf });
    else dispatch({ type: 'setMarts', selection: plan.selection, grids: plan.grids });
    for (const save of plan.saves) columnStore.save(save.martId, save.columns, save.picks);
  }, [blendable, columnStore, schemas, dispatch, model]);
}
