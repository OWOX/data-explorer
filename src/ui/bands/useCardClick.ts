import { useCallback, useEffect, useRef } from 'react';
import { withJoined, type JoinedSource } from '../../api/blendable';
import type { Picks } from '../../api/grid-columns';
import { PAGE_SIZE } from '../../config';
import { joinedMartIds, planAddAt, planClick, planMakeMain, planRejoin, shownOfMart, withoutPaths } from '../../state/join-plan';
import { reducer, sourceOfModel, useServices, useStore, type Action, type GridState, type State } from '../../state/store';
import type { Model } from '../../model/types';
import { pruneGrid } from '../../state/view-link-resolve';
import { defaultColumns } from '../../model/columns';
import { useLatest } from '../useLatest';

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
  /** Add the mart through this alias path (a canvas ghost). A deep path joins through the marts it passes, which get no columns of their own. */
  addAt?: string;
  /** Move marts to new alias paths (a canvas drop). */
  moves?: Map<string, string>;
  /** Take the marts joined at these alias paths out of the main mart's grid (a canvas card's ×). */
  removePaths?: string[];
};

const NOTHING_TO_DRAW_MS = 50;
const DRAW_MS = 2000;

export function useCardClick(model: Model): (id: string, options?: ClickOptions) => Promise<void> {
  const [state, dispatch] = useStore();
  const { blendable, columnStore, schemas } = useServices();
  const latest = useLatest<State>(state);
  // Whoever waits for the store to show what was just dispatched; the clicks run one at a time, each planned on what the one before left.
  // `from` is the state on screen when the wait began: only a render of another state ends it. Any other re-render of the bands must not,
  // not even one whose effects run late, after the dispatch.
  const waiters = useRef<{ from: State; done: () => void }[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const ready = waiters.current.filter((w) => w.from !== latest.current);
    if (ready.length === 0) return;
    waiters.current = waiters.current.filter((w) => w.from === latest.current);
    for (const w of ready) w.done();
  });
  // A step that changes nothing never renders: the pause is the fallback. One that changes the state gets longer, for a slow machine to draw it.
  const rendered = useCallback((fallback: number) => new Promise<void>((resolve) => {
    const waiter = { from: latest.current, done: () => { clearTimeout(t); resolve(); } };
    const t = setTimeout(() => { waiters.current = waiters.current.filter((w) => w !== waiter); resolve(); }, fallback);
    waiters.current.push(waiter);
  }), [latest]);

  /** Dispatches and says how long to wait for the render: the reducer returns the same state for a step that changes nothing, and that one never renders. */
  const step = useCallback((action: Action) => {
    const changes = reducer(latest.current, action) !== latest.current;
    dispatch(action);
    return changes ? DRAW_MS : NOTHING_TO_DRAW_MS;
  }, [dispatch, latest]);

  const run = useCallback(async (id: string, options?: ClickOptions) => {
    const main = latest.current.selection.martId;
    // With no readable main mart there is nothing to join to, so a click on another mart makes it the main one; a click on the main card still deselects it.
    const makeMain = options?.mode === 'makeMain' || (!!main && id !== main && model.marts.get(main)?.accessible === false);
    const sources = new Map<string, JoinedSource[]>();
    const grids = new Map<string, GridState>();
    const picks = new Map<string, Picks>();
    const load = async (martId: string) => {
      const own = await schemas.get(martId).catch(() => []);
      // A failed read leaves joined fields unknown, not gone: nothing saved for them is pruned.
      let failed = false;
      const joined = await blendable.get(martId).catch(() => { failed = true; return [] as JoinedSource[]; });
      sources.set(martId, joined);
      const have = latest.current.grids[martId];
      const agg = await columnStore.loadAggregation(martId);
      const aggFields = agg.aggregations.length || agg.dateTrunc.length ? { ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}) } : {};
      if (have && have.columns.length > 0) grids.set(martId, have);
      else {
        const saved = (await columnStore.load(martId)) ?? [];
        const offered = new Set([...own, ...joined.flatMap((s) => s.fields)].map((f) => f.name));
        const kept = failed ? saved : saved.filter((c) => offered.has(c));
        const columns = kept.length ? kept : defaultColumns(own);
        // The mart opens with the view the member last left it with, pruned to the fields it offers now (a session grid, held above, wins).
        const view = await columnStore.loadView(martId);
        const opened: GridState = { filters: {}, sorts: null, limit: PAGE_SIZE, ...aggFields, ...view, ...have, columns };
        grids.set(martId, view && !failed ? pruneGrid(opened, withJoined(own, joined)).grid ?? opened : opened);
      }
      picks.set(martId, await columnStore.loadPicks(martId));
      await columnStore.loadLastShown(martId);
    };
    if (main) {
      await load(main);
      if (id === main) {
        const next = joinedMartIds(grids.get(main)!.columns, sources.get(main)!, grids.get(main)!.emptyPaths)[0];
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
      const member = !!main && (id === main || (!!g && joinedMartIds(g.columns, sources.get(main) ?? [], g.emptyPaths).includes(id)));
      if (!member) return;
    }
    const sourceOf = sourceOfModel(model);
    const fresh = (martId: string) => { const g = now.grids[martId]; return g && g.columns.length > 0 ? g : grids.get(martId); };
    if (options?.removePaths) {
      if (!main) return;
      const sourcesNow = sources.get(main) ?? [];
      const g = fresh(main) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE };
      const own = defaultColumns(schemas.peek(main) ?? []);
      const next = withoutPaths(g, sourcesNow, options.removePaths, own);
      if (next === g) { await rendered(NOTHING_TO_DRAW_MS); return; }
      // Each removed mart is remembered with the own fields it showed, as a click that takes one out does.
      const martIds = new Set(sourcesNow.filter((s) => options.removePaths!.includes(s.aliasPath)).map((s) => s.martId));
      const wait = step({ type: 'setMarts', selection: now.selection, grids: { [main]: next } });
      columnStore.save(main, next.columns);
      for (const martId of martIds) {
        // Only what the removed paths showed: the same mart may stay joined at another path.
        const fields = shownOfMart(g.columns, g.uniqueCount, sourcesNow.filter((s) => options.removePaths!.includes(s.aliasPath)), martId);
        if (fields.length > 0) columnStore.saveLastShown(martId, fields);
      }
      await rendered(wait);
      return;
    }
    if ((options?.addAt !== undefined || options?.moves) && main) {
      const sourcesNow = sources.get(main) ?? [];
      const g = fresh(main) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE };
      const own = defaultColumns(schemas.peek(main) ?? []);
      let next = g;
      if (options.addAt !== undefined) {
        // Only the clicked mart gets columns: the marts on the way stay joined through its alias path.
        const martId = sourcesNow.find((s) => s.aliasPath === options.addAt)?.martId;
        if (martId !== undefined) next = planAddAt(next, sourcesNow, options.addAt, picks.get(main)?.[martId], columnStore.lastShown(martId), schemas.peek(main) ?? []);
      } else next = planRejoin(g, sourcesNow, options.moves!, own);
      if (next === g) { await rendered(NOTHING_TO_DRAW_MS); return; }
      const wait = step({ type: 'setMarts', selection: now.selection, grids: { [main]: next } });
      columnStore.save(main, next.columns);
      await rendered(wait);
      return;
    }
    const plan = (makeMain ? planMakeMain : planClick)({
      selection: now.selection,
      sourceKeyFor: (martId) => (now.selection.sourceKey && sourceOf(martId) === now.selection.sourceKey ? now.selection.sourceKey : null),
      sourcesOf: (martId) => sources.get(martId) ?? [],
      gridOf: (martId) => fresh(martId) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE },
      ownColumns: (martId) => defaultColumns(schemas.peek(martId) ?? []),
      picksOf: (martId) => picks.get(martId) ?? {},
      lastShownOf: (martId) => columnStore.lastShown(martId),
      ownNames: (martId) => (schemas.peek(martId) ?? []).map((f) => f.name),
      ownFields: (martId) => schemas.peek(martId) ?? [],
    }, id);
    if (plan.noop) { await rendered(NOTHING_TO_DRAW_MS); return; }
    const wait = Object.keys(plan.grids).length === 0 && plan.selection.martId && !plan.selection.cleared
      ? step({ type: 'selectMart', id: plan.selection.martId, sourceOf })
      : step({ type: 'setMarts', selection: plan.selection, grids: plan.grids });
    for (const save of plan.saves) columnStore.save(save.martId, save.columns, save.picks);
    for (const r of plan.remember) columnStore.saveLastShown(r.martId, r.fields);
    await rendered(wait);
  }, [blendable, columnStore, schemas, step, model, latest, rendered]);

  return useCallback((id: string, options?: ClickOptions) => {
    const next = chain.current.then(() => run(id, options), () => run(id, options));
    chain.current = next.catch(() => undefined);
    return next;
  }, [run]);
}
