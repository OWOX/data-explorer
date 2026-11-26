// What a click on a data mart card does to the selection: the main mart, the joined marts and the main's grid.
// The joined marts are not stored anywhere: a mart is selected-joined exactly when one of its joined fields is a column of the main grid.
import { sourceOfField, type JoinedSource } from '../api/blendable';
import type { Picks } from '../api/grid-columns';
import { keptSorts, sortsOnColumns } from '../model/sort';
import { keepVisible } from '../model/aggregation';
import { uniqueKey } from '../model/unique-count';
import { dropOrphanHaving } from '../filters/build';
import { orderColumns } from './column-order';
import type { Field } from '../model/types';
import type { GridState, Selection } from './store';

/** The joined data marts a grid shows columns of, in the order they first appear (the order they were added); then the marts kept with no column (`empty`, alias paths). */
export function joinedMartIds(columns: string[], sources: JoinedSource[], empty: readonly string[] = []): string[] {
  const owner = sourceOfField(sources);
  const out: string[] = [];
  for (const c of columns) {
    const id = owner.get(c)?.martId;
    if (id && !out.includes(id)) out.push(id);
  }
  for (const p of empty) {
    const id = sources.find((s) => s.aliasPath === p)?.martId;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The title of a joined path: the source's label without what tells its joins apart, plus that only when the same mart is reached through more
 * than one of `paths` (the alias paths in use, or in use plus the one about to be added).
 */
export function pathTitle(source: { label: string; name?: string; aliasPath: string; martId: string }, paths: string[], sources: JoinedSource[]): string {
  const reaching = new Set(paths.filter((p) => sources.some((s) => s.aliasPath === p && s.martId === source.martId)));
  reaching.add(source.aliasPath);
  return reaching.size > 1 ? source.label : (source.name ?? source.label);
}

/** Every blended field name of a joined mart, over all the alias paths that reach it. */
const namesOf = (sources: JoinedSource[], martId: string) => new Set(sources.filter((s) => s.martId === martId).flatMap((s) => s.fields.map((f) => f.name)));

/** The alias path a path hangs from: '' for a mart the main one joins directly. */
export const parentPath = (aliasPath: string): string => {
  const i = aliasPath.lastIndexOf('.');
  return i < 0 ? '' : aliasPath.slice(0, i);
};

/** The alias paths a grid uses: '' for the main mart, the path of each joined field among the columns, and the paths kept with no column (`empty`) that a source offers. */
export function inUsePaths(columns: string[], sources: JoinedSource[], empty: readonly string[] = []): Set<string> {
  const pathOf = sourceOfField(sources);
  return new Set(['', ...columns.flatMap((c) => pathOf.get(c)?.aliasPath ?? []), ...empty.filter((p) => sources.some((s) => s.aliasPath === p))]);
}

/**
 * The source a mart joins by. Given the paths in use, a path that hangs from one of them, the closest to the main mart
 * (the list is sorted by depth, so the first such path); else, or without them, the shallowest path.
 */
export const sourceOfMart = (sources: JoinedSource[], martId: string, inUse?: Set<string>): JoinedSource | undefined => {
  const paths = sources.filter((s) => s.martId === martId);
  return (inUse && paths.find((s) => inUse.has(parentPath(s.aliasPath)))) || paths[0];
};

/**
 * The source a click on a mart outside the report joins by: the path with the fewest marts. Ties go to the path that reuses
 * the most marts already in the report (every prefix of a path in use), then to the first by title (the list's order).
 */
export const shortestSource = (sources: JoinedSource[], martId: string, inUse: Set<string>): JoinedSource | undefined => {
  const inReport = new Set<string>();
  for (const p of inUse) for (let q = p; q !== ''; q = parentPath(q)) inReport.add(q);
  const reused = (s: JoinedSource) => { let n = 0; for (let q = parentPath(s.aliasPath); q !== ''; q = parentPath(q)) if (inReport.has(q)) n++; return n; };
  let best: JoinedSource | undefined;
  for (const s of sources) {
    if (s.martId !== martId) continue;
    if (!best || s.depth < best.depth || (s.depth === best.depth && reused(s) > reused(best))) best = s;
  }
  return best;
};

const isJoinable = (sources: JoinedSource[], martId: string) => sources.some((s) => s.martId === martId);

/** A key by name or alias: a primary key, `id`, a name ending in `_id` or `Id`, or an alias ending in " ID" (any case). */
export const isIdField = (f: Field): boolean => f.isPrimaryKey || /^id$/i.test(f.name) || /_id$/i.test(f.name) || /[a-z0-9]Id$/.test(f.name) || /\sid$/i.test(f.alias ?? '');

/**
 * What a mart joins the grid with when nothing was remembered: its first text field that is not an ID and its first metric
 * (a number) that is not an ID. With no such text field the first text field; with no metric just the text; with no text
 * field the first two fields that are not IDs.
 */
export function defaultJoinFields(source: JoinedSource): Field[] {
  const text = source.fields.find((f) => f.category === 'string' && !isIdField(f)) ?? source.fields.find((f) => f.category === 'string');
  if (!text) {
    const plain = source.fields.filter((f) => !isIdField(f));
    return (plain.length ? plain : source.fields).slice(0, 2);
  }
  const metric = source.fields.find((f) => f.category === 'number' && !isIdField(f));
  return metric ? [text, metric] : [text];
}

/** A joined field's name in its own mart. */
const ownNameOf = (f: Field): string => f.joined?.originalName ?? f.name.slice(f.name.lastIndexOf('__') + 2);

/** The own field names of one joined mart's columns, in the order shown. */
export function ownNamesIn(columns: string[], sources: JoinedSource[], martId: string): string[] {
  const byName = new Map<string, Field>();
  for (const s of sources) if (s.martId === martId) for (const f of s.fields) if (!byName.has(f.name)) byName.set(f.name, f);
  return [...new Set(columns.flatMap((c) => (byName.has(c) ? [ownNameOf(byName.get(c)!)] : [])))];
}

/** The columns that are not a field of any joined mart: the mart's own. */
const ownColumnsIn = (columns: string[], sources: JoinedSource[]): string[] => {
  const joined = new Set(sources.flatMap((s) => s.fields.map((f) => f.name)));
  return columns.filter((c) => !joined.has(c));
};

/** The fields a joined mart comes back with: what it showed when it last left a grid (`shown`, its own field names) that the source still offers, in that order, else its default fields. */
export function fieldsFor(sources: JoinedSource[], martId: string, shown: string[], inUse?: Set<string>): string[] {
  const source = sourceOfMart(sources, martId, inUse);
  if (!source) return [];
  const byOwn = new Map(source.fields.map((f) => [ownNameOf(f), f.name] as const));
  const mapped = shown.flatMap((n) => (byOwn.has(n) ? [byOwn.get(n)!] : []));
  return mapped.length ? mapped : defaultJoinFields(source).map((f) => f.name);
}

/** The slices without the ones on the dropped fields; `undefined` when none is left, so the grid state carries no empty map. */
const keepSlices = (slices: GridState['slices'], keep: (field: string) => boolean): GridState['slices'] => {
  const kept = Object.fromEntries(Object.entries(slices ?? {}).filter(([k]) => keep(k)));
  return Object.keys(kept).length ? kept : undefined;
};

/** The grid's sorts and aggregation rules cut down to `columns`: no sorts left is `null`, an empty rule list is `undefined`. The Unique Count of a path in `goneUnique` goes, and with it its sort. */
const refitRules = (grid: GridState, columns: string[], goneUnique: ReadonlySet<string> = new Set()) => {
  const uniqueCount = (grid.uniqueCount ?? []).filter((p) => !goneUnique.has(p));
  const kept = grid.sorts && sortsOnColumns(grid.sorts, [...columns, ...uniqueCount.map(uniqueKey)]);
  const agg = keepVisible({ aggregations: grid.aggregations ?? [], dateTrunc: grid.dateTrunc ?? [] }, columns);
  return {
    aggregation: agg,
    uniqueCount: uniqueCount.length ? uniqueCount : undefined,
    sorts: keptSorts(grid.sorts, kept ?? []),
    aggregations: agg.aggregations.length ? agg.aggregations : undefined,
    dateTrunc: agg.dateTrunc.length ? agg.dateTrunc : undefined,
  };
};

/** The grid on new columns, without the filters and slices of the fields `keep` rejects. */
const refit = (grid: GridState, columns: string[], keep: (field: string) => boolean, goneUnique?: ReadonlySet<string>): GridState => {
  const { aggregation, ...rules } = refitRules(grid, columns, goneUnique);
  // The paths that left the grid are not kept empty either.
  const emptyPaths = (grid.emptyPaths ?? []).filter((p) => !goneUnique?.has(p));
  return {
    ...grid,
    columns,
    ...rules,
    emptyPaths: emptyPaths.length ? emptyPaths : undefined,
    filters: dropOrphanHaving(Object.fromEntries(Object.entries(grid.filters).filter(([k]) => keep(k))), aggregation.aggregations),
    slices: keepSlices(grid.slices, keep),
  };
};

/** The grid with everything of one joined mart taken out: its columns, its filters and its sorts. `removed` is the field list to remember. */
export function withoutMart(grid: GridState, sources: JoinedSource[], martId: string, own: string[]): { grid: GridState; removed: string[] } {
  const names = namesOf(sources, martId);
  const removed = grid.columns.filter((c) => names.has(c));
  let columns = grid.columns.filter((c) => !names.has(c));
  // A grid always keeps a column: when only the joined mart's were shown, the mart's own defaults come back.
  if (columns.length === 0) columns = own;
  return { removed, grid: refit(grid, columns, (k) => !names.has(k), new Set(sources.filter((s) => s.martId === martId).map((s) => s.aliasPath))) };
}

/** The grid with every field of these exact alias paths taken out (the same grid when none is in use): columns, filters, sorts, aggregations, buckets. A grid left with no column gets `own`. */
export function withoutPaths(grid: GridState, sources: JoinedSource[], paths: string[], own: string[]): GridState {
  const gone = new Set(sources.filter((s) => paths.includes(s.aliasPath)).flatMap((s) => s.fields.map((f) => f.name)));
  const touched = grid.columns.some((c) => gone.has(c))
    || Object.keys(grid.filters).some((k) => gone.has(k))
    || Object.keys(grid.slices ?? {}).some((k) => gone.has(k))
    || (grid.sorts ?? []).some((k) => gone.has(k.field))
    || (grid.aggregations ?? []).some((a) => gone.has(a.column))
    || (grid.dateTrunc ?? []).some((d) => gone.has(d.column))
    || (grid.uniqueCount ?? []).some((p) => paths.includes(p))
    || (grid.emptyPaths ?? []).some((p) => paths.includes(p));
  if (!touched) return grid;
  let columns = grid.columns.filter((c) => !gone.has(c));
  if (columns.length === 0) columns = own;
  return refit(grid, columns, (k) => !gone.has(k), new Set(paths));
}

export type Plan = {
  selection: Selection;
  grids: Record<string, GridState>;
  /** What to save in `grid-columns`: the grid's columns and the remembered picks. */
  saves: { martId: string; columns: string[]; picks?: Picks }[];
  /** Marts that left the grid, with the own field names each was showing (null: forget what was remembered). */
  remember: { martId: string; fields: string[] | null }[];
  /** Nothing to do: the caller dispatches nothing. */
  noop?: true;
};

export type PlanEnv = {
  selection: Selection;
  /** The source key that stays selected when it feeds the mart, else null. */
  sourceKeyFor: (martId: string) => string | null;
  /** The joined sources of a mart; loaded before the plan is made. */
  sourcesOf: (martId: string) => JoinedSource[];
  /** The grid a mart opens in: this session's, else the saved or the default columns; loaded before the plan is made. */
  gridOf: (martId: string) => GridState;
  /** The mart's own default columns. */
  ownColumns: (martId: string) => string[];
  picksOf: (martId: string) => Picks;
  /** The own field names a mart showed when it last left a grid; null when none. Loaded before the plan is made. */
  lastShownOf: (martId: string) => string[] | null;
  /** Every field name of the mart itself (its schema), for the marts that may become the main one. */
  ownNames: (martId: string) => string[];
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** The path a mart kept with no column takes on the new main: the one `sourceOfMart` picks next to the paths in use and those already empty. */
const carryPath = (nextSources: JoinedSource[], martId: string, columns: string[], empty: readonly string[]): string => sourceOfMart(nextSources, martId, inUsePaths(columns, nextSources, empty))!.aliasPath;

/** The paths that stay empty on a grid: each once, offered by a source, and with no column of the grid's. */
const emptyAfter = (sources: JoinedSource[], columns: string[], paths: readonly string[]): string[] => {
  const used = inUsePaths(columns, sources);
  return [...new Set(paths)].filter((p) => p !== '' && !used.has(p) && sources.some((s) => s.aliasPath === p));
};

/** What the old main mart and its joined marts leave behind when another mart replaces them. */
export function leaveAll(main: string, sources: JoinedSource[], grid: GridState, except?: string): Plan['remember'] {
  const out: Plan['remember'] = [{ martId: main, fields: ownColumnsIn(grid.columns, sources) }];
  // A mart kept with no column showed nothing: an empty entry would wipe what it last showed, so only marts with columns are remembered.
  for (const m of joinedMartIds(grid.columns, sources)) if (m !== except) out.push({ martId: m, fields: ownNamesIn(grid.columns, sources, m) });
  return out;
}

/** The clicked mart becomes the only selected one: joined columns it was left with are taken out, and remembered for its pairs. */
const becomeMain = (env: PlanEnv, id: string, remember: Plan['remember'] = []): Plan => {
  const selection = { sourceKey: env.sourceKeyFor(id), martId: id, record: null };
  const sources = env.sourcesOf(id);
  let grid = env.gridOf(id);
  const joined = joinedMartIds(grid.columns, sources, grid.emptyPaths);
  const picks: Picks = {};
  for (const m of joined) {
    const out = withoutMart(grid, sources, m, env.ownColumns(id));
    grid = out.grid;
    // A mart that had no column has no pick to remember: an empty list would wipe what was chosen before.
    if (out.removed.length) picks[m] = out.removed;
    // Not remembered as left-the-grid: these marts sat in the mart's stale saved grid, not on screen, and `remember` already has
    // what the screen showed (a later entry here would override it).
  }
  // What it showed when it last left a grid, as its own columns (this is the newest memory it has).
  const offered = new Set(env.ownNames(id));
  const last = (env.lastShownOf(id) ?? []).filter((n) => offered.has(n));
  const restored = last.length > 0 && !(last.length === grid.columns.length && last.every((c, i) => c === grid.columns[i]));
  if (last.length > 0) {
    const { sorts, aggregations, dateTrunc, uniqueCount } = refitRules(grid, last);
    grid = { ...grid, columns: last, sorts, aggregations, dateTrunc, uniqueCount };
    // Its memory stays: forgetting it here could not be undone.
  }
  if (joined.length === 0 && !restored) return { selection, grids: {}, saves: [], remember };
  return { selection, grids: { [id]: grid }, saves: [{ martId: id, columns: grid.columns, ...(joined.length ? { picks } : {}) }], remember };
};

/** Joined marts a card click can touch need `sourcesOf` and `gridOf` for the main and for every selected joined mart. */
export function planClick(env: PlanEnv, id: string): Plan {
  const main = env.selection.martId;
  if (!main) return becomeMain(env, id);
  const sources = env.sourcesOf(main);
  const grid = env.gridOf(main);
  const joined = joinedMartIds(grid.columns, sources, grid.emptyPaths);
  const shownOf = env.lastShownOf;

  if (id === main) {
    if (joined.length === 0) return { selection: { sourceKey: env.selection.sourceKey, martId: null, record: null, cleared: true }, grids: {}, saves: [], remember: leaveAll(main, sources, grid) };
    // The next selected joined mart becomes main, with the others it can join.
    const [next, ...rest] = joined as [string, ...string[]];
    const nextSources = env.sourcesOf(next);
    const nextGrid = env.gridOf(next);
    const remember: Plan['remember'] = [{ martId: main, fields: ownColumnsIn(grid.columns, sources) }];
    // A mart with no column on the grid showed nothing: forgetting what it last showed would lose it.
    if (ownNamesIn(grid.columns, sources, next).length > 0) remember.push({ martId: next, fields: null });
    // Its joined fields it was showing become its own columns: that is what it showed last.
    const offered = new Set(env.ownNames(next));
    const shownNow = ownNamesIn(grid.columns, sources, next).filter((n) => offered.has(n));
    let columns = shownNow.length ? shownNow : nextGrid.columns;
    // The empty paths of its own grid count only when that grid is what opens; the screen's columns replace it.
    const own = shownNow.length ? [] : nextGrid.emptyPaths ?? [];
    const have = new Set(joinedMartIds(columns, nextSources));
    const ownEmpty = new Set(joinedMartIds([], nextSources, own));
    // The marts the old main showed no column of stay in the report with none.
    const stayEmpty = new Set(joinedMartIds([], sources, grid.emptyPaths).filter((m) => !joinedMartIds(grid.columns, sources).includes(m)));
    const carried: string[] = [];
    for (const r of rest) {
      if (!isJoinable(nextSources, r)) {
        // Nothing shown is nothing to remember: an empty entry would wipe what the mart last showed.
        if (!stayEmpty.has(r)) remember.push({ martId: r, fields: ownNamesIn(grid.columns, sources, r) });
        continue;
      }
      if (have.has(r)) continue;
      if (stayEmpty.has(r)) { if (!ownEmpty.has(r)) carried.push(carryPath(nextSources, r, columns, [...own, ...carried])); continue; }
      columns = [...columns, ...fieldsFor(nextSources, r, ownNamesIn(grid.columns, sources, r), inUsePaths(columns, nextSources)).filter((n) => !columns.includes(n))];
    }
    columns = orderColumns(columns, nextSources, env.ownColumns(next));
    // A mart the loop gave columns is not kept empty as well; one already on its own grid keeps its empty path.
    const shownMarts = joinedMartIds(columns, nextSources);
    const emptyPaths = emptyAfter(nextSources, columns, [...own.filter((p) => { const m = nextSources.find((x) => x.aliasPath === p)?.martId ?? ''; return have.has(m) || !shownMarts.includes(m); }), ...carried]);
    const changed = columns.length !== nextGrid.columns.length || columns.some((c, i) => c !== nextGrid.columns[i]) || !sameList(emptyPaths, nextGrid.emptyPaths ?? []);
    const sorts = changed && nextGrid.sorts ? sortsOnColumns(nextGrid.sorts, columns) : nextGrid.sorts;
    return {
      selection: { sourceKey: env.sourceKeyFor(next), martId: next, record: null },
      grids: changed ? { [next]: { ...nextGrid, columns, emptyPaths: emptyPaths.length ? emptyPaths : undefined, sorts: keptSorts(nextGrid.sorts, sorts ?? []) } } : {},
      saves: changed ? [{ martId: next, columns }] : [],
      remember,
    };
  }

  if (joined.includes(id)) {
    const { grid: next, removed } = withoutMart(grid, sources, id, env.ownColumns(main));
    // A mart with no column has no fields to remember: an empty entry would wipe what it last showed.
    if (removed.length === 0) return { selection: env.selection, grids: { [main]: next }, saves: [{ martId: main, columns: next.columns }], remember: [] };
    return { selection: env.selection, grids: { [main]: next }, saves: [{ martId: main, columns: next.columns, picks: { [id]: removed } }], remember: [{ martId: id, fields: ownNamesIn(removed, sources, id) }] };
  }

  if (isJoinable(sources, id)) {
    // Through the shortest chain to the main mart; the marts on the way join bare (the join tree shows them).
    const via = shortestSource(sources, id, inUsePaths(grid.columns, sources, grid.emptyPaths))!;
    const next = planAddAt(grid, sources, via.aliasPath, env.ownColumns(main), env.picksOf(main)[id], shownOf(id));
    return { selection: env.selection, grids: { [main]: next }, saves: [{ martId: main, columns: next.columns }], remember: [] };
  }

  // A mart the main one cannot join does not replace it. The member drags it onto the main card for that (planMakeMain).
  return { selection: env.selection, grids: {}, saves: [], remember: [], noop: true };
}

/**
 * A mart dropped onto the main card becomes the main mart. Its own columns come first: what it shows as joined now, else
 * what it showed when it last left a grid, else its grid's own columns, else its defaults. The old main follows as a joined
 * mart with the columns it showed, if the new main can join it, then every joined mart the new main can reach. A mart it
 * cannot reach is dropped and remembered. The new main keeps its own grid's filters and sorts on the new columns. The marts the report kept with no column stay in it with none, when the new main can join them. The old
 * main's filters do not carry over, because each main names the same field differently.
 */
export function planMakeMain(env: PlanEnv, id: string): Plan {
  const main = env.selection.martId;
  if (!main) return becomeMain(env, id);
  if (id === main) return { selection: env.selection, grids: {}, saves: [], remember: [], noop: true };
  const sources = env.sourcesOf(main);
  const grid = env.gridOf(main);
  const nextSources = env.sourcesOf(id);
  const nextGrid = env.gridOf(id);
  const offered = new Set(env.ownNames(id));
  const shownNow = ownNamesIn(grid.columns, sources, id).filter((n) => offered.has(n));
  const last = (env.lastShownOf(id) ?? []).filter((n) => offered.has(n));
  const own = ownColumnsIn(nextGrid.columns, nextSources);
  let columns = shownNow.length ? shownNow : last.length ? last : own.length ? own : env.ownColumns(id);
  const remember: Plan['remember'] = [];
  const add = (martId: string, shown: string[]) => {
    const names = fieldsFor(nextSources, martId, shown, inUsePaths(columns, nextSources));
    columns = [...columns, ...names.filter((n) => !columns.includes(n))];
  };
  const mainShown = ownColumnsIn(grid.columns, sources);
  if (isJoinable(nextSources, main)) add(main, mainShown);
  // Nothing shown is nothing to remember: an empty entry would wipe what the old main last showed.
  else if (mainShown.length > 0) remember.push({ martId: main, fields: mainShown });
  const withColumns = joinedMartIds(grid.columns, sources);
  const carried: string[] = [];
  for (const r of joinedMartIds(grid.columns, sources, grid.emptyPaths)) {
    if (r === id) continue;
    const shown = ownNamesIn(grid.columns, sources, r);
    // A mart kept with no column stays in the report with none, at the path the new main joins it by.
    if (!withColumns.includes(r)) { if (isJoinable(nextSources, r)) carried.push(carryPath(nextSources, r, columns, carried)); continue; }
    if (isJoinable(nextSources, r)) add(r, shown);
    else remember.push({ martId: r, fields: shown });
  }
  columns = orderColumns(columns, nextSources, env.ownColumns(id));
  // Only the marts the report had: the new main's old grid is not on screen.
  const emptyPaths = emptyAfter(nextSources, columns, carried);
  const { aggregation, ...rules } = refitRules(nextGrid, columns);
  const onGrid = inUsePaths(columns, nextSources, emptyPaths);
  const next: GridState = {
    ...nextGrid,
    columns,
    // A filter does not need its column on screen either: it stays on any field of a mart that is on the new grid (the main mart's own, or a joined mart in the report, with a shown column or none), shown or hidden.
    filters: dropOrphanHaving(Object.fromEntries(Object.entries(nextGrid.filters).filter(([k]) => columns.includes(k) || offered.has(k) || onGrid.has(sourceOfField(nextSources).get(k)?.aliasPath ?? '\0'))), aggregation.aggregations),
    // A slice does not need its column on screen: it stays while its field is still a joined field of the new main.
    slices: keepSlices(nextGrid.slices, (k) => nextSources.some((x) => x.fields.some((fl) => fl.name === k))),
    ...rules,
    emptyPaths: emptyPaths.length ? emptyPaths : undefined,
  };
  return { selection: { sourceKey: env.sourceKeyFor(id), martId: id, record: null }, grids: { [id]: next }, saves: [{ martId: id, columns }], remember };
}

/** The grid with the mart of `aliasPath` added through that exact path. `remembered` are blended names chosen before, `shown` own names it showed when it last left a grid. */
export function planAddAt(grid: GridState, sources: JoinedSource[], aliasPath: string, own: string[], remembered?: string[], shown: string[] | null = null): GridState {
  const source = sources.find((s) => s.aliasPath === aliasPath);
  if (!source) return grid;
  const names = new Set(source.fields.map((f) => f.name));
  let picked: string[] = [];
  if (shown) {
    const byOwn = new Map(source.fields.map((f) => [ownNameOf(f), f.name] as const));
    picked = shown.flatMap((n) => (byOwn.has(n) ? [byOwn.get(n)!] : []));
  }
  if (!picked.length) picked = (remembered ?? []).filter((n) => names.has(n));
  if (!picked.length) picked = defaultJoinFields(source).map((f) => f.name);
  const columns = orderColumns([...grid.columns, ...picked.filter((n) => !grid.columns.includes(n))], sources, own);
  // The mart has columns now: it is no longer kept empty.
  const emptyPaths = grid.emptyPaths?.filter((p) => p !== aliasPath);
  return { ...grid, columns, ...(emptyPaths ? { emptyPaths: emptyPaths.length ? emptyPaths : undefined } : {}) };
}

/** The grid with every field of a moved path swapped for the same own field on its new path; a field the new path lacks is dropped. */
export function planRejoin(grid: GridState, sources: JoinedSource[], moves: Map<string, string>, own: string[]): GridState {
  if (moves.size === 0) return grid;
  const byPath = new Map(sources.map((s) => [s.aliasPath, s] as const));
  const swap = new Map<string, string | null>();
  for (const [from, to] of moves) {
    const target = byPath.get(to);
    const byOwn = new Map((target?.fields ?? []).map((f) => [ownNameOf(f), f.name] as const));
    for (const f of byPath.get(from)?.fields ?? []) swap.set(f.name, byOwn.get(ownNameOf(f)) ?? null);
  }
  const map = (n: string) => (swap.has(n) ? swap.get(n)! : n);
  let columns = [...new Set(grid.columns.flatMap((c) => { const m = map(c); return m ? [m] : []; }))];
  if (columns.length === 0) columns = own;
  const filters = Object.fromEntries(Object.entries(grid.filters).flatMap(([k, f]) => { const m = map(k); return m ? [[m, { ...f, field: m }]] : []; }));
  const slices = Object.fromEntries(Object.entries(grid.slices ?? {}).flatMap(([k, f]) => { const m = map(k); return m ? [[m, { ...f, field: m }]] : []; }));
  // A moved path's Unique Count moves with it (and its sort); the grid drops it later if the new path cannot count.
  const uniqueCount = grid.uniqueCount?.map((p) => moves.get(p) ?? p);
  const emptyPaths = grid.emptyPaths && [...new Set(grid.emptyPaths.map((p) => moves.get(p) ?? p))];
  const uniqueSorts = new Map(grid.uniqueCount?.flatMap((p) => (moves.has(p) ? [[uniqueKey(p), uniqueKey(moves.get(p)!)] as const] : [])));
  const sorts = grid.sorts && grid.sorts.flatMap((s) => { const m = uniqueSorts.get(s.field) ?? map(s.field); return m ? [{ ...s, field: m }] : []; });
  const aggregations = grid.aggregations?.flatMap((a) => { const m = map(a.column); return m ? [{ ...a, column: m }] : []; });
  const dateTrunc = grid.dateTrunc?.flatMap((d) => { const m = map(d.column); return m ? [{ ...d, column: m }] : []; });
  return {
    ...grid,
    columns,
    filters,
    slices: Object.keys(slices).length ? slices : undefined,
    sorts: keptSorts(grid.sorts, sorts ?? []),
    aggregations: aggregations?.length ? aggregations : undefined,
    dateTrunc: dateTrunc?.length ? dateTrunc : undefined,
    uniqueCount: uniqueCount?.length ? [...new Set(uniqueCount)] : undefined,
    ...(emptyPaths ? { emptyPaths: emptyPaths.length ? emptyPaths : undefined } : {}),
  };
}
