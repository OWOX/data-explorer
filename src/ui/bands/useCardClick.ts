import { useCallback, useEffect, useRef } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { Picks } from '../../api/grid-columns';
import { PAGE_SIZE } from '../../config';
import { joinedMartIds, planClick, planMakeMain } from '../../state/join-plan';
import { sourceOfModel, useServices, useStore, type GridState, type State } from '../../state/store';
import type { Model } from '../../model/types';
import { defaultColumns } from '../explorer/useMartRows';

/**
 * What a click on a data mart card does: add it to the main mart's grid, take it out, promote it, or make it the main mart.
 * What the plan needs (the joined marts of the main one and of the next main, their grids, the remembered picks) is read first;
 * the whole change is then one store step, so Undo takes it back as one.
 */
export type ClickOptions = {
  /** The click only takes a mart out: it does nothing when the mart is no longer the main or a joined one when it runs (a double click on a remove button). */
  only?: 'deselect';
  /** The mart becomes the main one (a drop on the main card, or its make-main button). */
  mode?: 'makeMain';
};

export function useCardClick(model: Model): (id: string, options?: ClickOptions) => Promise<void> {
  const [state, dispatch] = useStore();
  const { blendable, columnStore, schemas } = useServices();
  const latest = useRef<State>(state);
  // Whoever waits for the store to show what was just dispatched; the clicks run one at a time, each planned on what the one before left.
  const waiters = useRef<(() => void)[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    latest.current = state;
    const now = waiters.current.splice(0);
    for (const w of now) w();
  });
  const rendered = () => new Promise<void>((resolve) => {
    // A step that changed nothing never renders: the pause is the fallback.
    const t = setTimeout(resolve, 50);
    waiters.current.push(() => { clearTimeout(t); resolve(); });
  });

  const run = useCallback(async (id: string, options?: ClickOptions) => {
    const main = latest.current.selection.martId;
    const makeMain = options?.mode === 'makeMain';
    const sources = new Map<string, JoinedSource[]>();
    const grids = new Map<string, GridState>();
    const picks = new Map<string, Picks>();
    const load = async (martId: string) => {
      const own = await schemas.get(martId).catch(() => []);
      const joined = await blendable.get(martId).catch(() => [] as JoinedSource[]);
      sources.set(martId, joined);
      const have = latest.current.grids[martId];
      const agg = await columnStore.loadAggregation(martId);
      const aggFields = agg.aggregations.length || agg.dateTrunc.length ? { ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}) } : {};
      if (have && have.columns.length > 0) grids.set(martId, have);
      else {
        const saved = (await columnStore.load(martId)) ?? [];
        const offered = new Set([...own, ...joined.flatMap((s) => s.fields)].map((f) => f.name));
        const kept = saved.filter((c) => offered.has(c));
        grids.set(martId, { filters: {}, sorts: null, limit: PAGE_SIZE, ...aggFields, ...have, columns: kept.length ? kept : defaultColumns(own) });
      }
      picks.set(martId, await columnStore.loadPicks(martId));
      await columnStore.loadLastShown(martId);
    };
    if (main) {
      await load(main);
      if (id === main) {
        const next = joinedMartIds(grids.get(main)!.columns, sources.get(main)!)[0];
        if (next) await load(next);
      }
    }
    // The plan reads the clicked mart's grid only when it may become the main mart.
    if (id !== main && (makeMain || !main)) await load(id);
    // The mart being added or made main brings what it showed when it last left a grid.
    if (id !== main) await columnStore.loadLastShown(id);
    const now = latest.current;
    // The member moved on while this was being read.
    if (now.selection.martId !== main) return;
    if (options?.only === 'deselect') {
      const g = main ? (now.grids[main]?.columns.length ? now.grids[main] : grids.get(main)) : undefined;
      const member = !!main && (id === main || (!!g && joinedMartIds(g.columns, sources.get(main) ?? []).includes(id)));
      if (!member) return;
    }
    const sourceOf = sourceOfModel(model);
    const fresh = (martId: string) => { const g = now.grids[martId]; return g && g.columns.length > 0 ? g : grids.get(martId); };
    const plan = (makeMain ? planMakeMain : planClick)({
      selection: now.selection,
      sourceKeyFor: (martId) => (now.selection.sourceKey && sourceOf(martId) === now.selection.sourceKey ? now.selection.sourceKey : null),
      sourcesOf: (martId) => sources.get(martId) ?? [],
      gridOf: (martId) => fresh(martId) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE },
      ownColumns: (martId) => defaultColumns(schemas.peek(martId) ?? []),
      picksOf: (martId) => picks.get(martId) ?? {},
      lastShownOf: (martId) => columnStore.lastShown(martId),
      ownNames: (martId) => (schemas.peek(martId) ?? []).map((f) => f.name),
    }, id);
    if (plan.noop) { await rendered(); return; }
    if (Object.keys(plan.grids).length === 0 && plan.selection.martId && !plan.selection.cleared) dispatch({ type: 'selectMart', id: plan.selection.martId, sourceOf });
    else dispatch({ type: 'setMarts', selection: plan.selection, grids: plan.grids });
    for (const save of plan.saves) columnStore.save(save.martId, save.columns, save.picks);
    for (const r of plan.remember) columnStore.saveLastShown(r.martId, r.fields);
    await rendered();
  }, [blendable, columnStore, schemas, dispatch, model]);

  return useCallback((id: string, options?: ClickOptions) => {
    const next = chain.current.then(() => run(id, options), () => run(id, options));
    chain.current = next.catch(() => undefined);
    return next;
  }, [run]);
}
