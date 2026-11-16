// What a click on a data mart card does to the selection: the main mart, the joined marts and the main's grid.
// The joined marts are not stored anywhere: a mart is selected-joined exactly when one of its joined fields is a column of the main grid.
import type { JoinedSource } from '../api/blendable';
import type { Picks } from '../api/grid-columns';
import { sortsOnColumns } from '../model/sort';
import { orderColumns } from './column-order';
import type { Field } from '../model/types';
import type { GridState, Selection } from './store';

/** The joined data marts a grid shows columns of, in the order they first appear (the order they were added). */
export function joinedMartIds(columns: string[], sources: JoinedSource[]): string[] {
  const owner = new Map<string, string>();
  for (const s of sources) for (const f of s.fields) if (!owner.has(f.name)) owner.set(f.name, s.martId);
  const out: string[] = [];
  for (const c of columns) {
    const id = owner.get(c);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Every blended field name of a joined mart, over all the alias paths that reach it. */
const namesOf = (sources: JoinedSource[], martId: string) => new Set(sources.filter((s) => s.martId === martId).flatMap((s) => s.fields.map((f) => f.name)));

/** A mart reachable by several alias paths uses the shallowest source, then the first (the list is already in that order). */
export const sourceOfMart = (sources: JoinedSource[], martId: string): JoinedSource | undefined => sources.find((s) => s.martId === martId);

export const isJoinable = (sources: JoinedSource[], martId: string) => sources.some((s) => s.martId === martId);

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
export const ownNameOf = (f: Field): string => f.joined?.originalName ?? f.name.slice(f.name.lastIndexOf('__') + 2);

/** The own field names of one joined mart's columns, in the order shown. */
export function ownNamesIn(columns: string[], sources: JoinedSource[], martId: string): string[] {
  const byName = new Map<string, Field>();
  for (const s of sources) if (s.martId === martId) for (const f of s.fields) if (!byName.has(f.name)) byName.set(f.name, f);
  return [...new Set(columns.flatMap((c) => (byName.has(c) ? [ownNameOf(byName.get(c)!)] : [])))];
}

/** The columns that are not a field of any joined mart: the mart's own. */
export const ownColumnsIn = (columns: string[], sources: JoinedSource[]): string[] => {
  const joined = new Set(sources.flatMap((s) => s.fields.map((f) => f.name)));
  return columns.filter((c) => !joined.has(c));
};

/**
 * The fields a joined mart comes back with. What it showed when it last left a grid (`shown`, its own field names) wins:
 * those the source offers, in that order, else the default. With nothing remembered, what was last chosen for the pair
 * (those the source still offers), else its first non-ID text field and first non-ID metric.
 */
export function fieldsFor(sources: JoinedSource[], martId: string, remembered: string[] | undefined, shown: string[] | null = null): string[] {
  const source = sourceOfMart(sources, martId);
  if (shown && source) {
    const byOwn = new Map(source.fields.map((f) => [ownNameOf(f), f.name] as const));
    const mapped = shown.flatMap((n) => (byOwn.has(n) ? [byOwn.get(n)!] : []));
    if (mapped.length) return mapped;
    return defaultJoinFields(source).map((f) => f.name);
  }
  const offered = namesOf(sources, martId);
  const kept = (remembered ?? []).filter((n) => offered.has(n));
  if (kept.length) return kept;
  return source ? defaultJoinFields(source).map((f) => f.name) : [];
}

/** The grid with everything of one joined mart taken out: its columns, its filters and its sorts. `removed` is the field list to remember. */
export function withoutMart(grid: GridState, sources: JoinedSource[], martId: string, own: string[]): { grid: GridState; removed: string[] } {
  const names = namesOf(sources, martId);
  const removed = grid.columns.filter((c) => names.has(c));
  let columns = grid.columns.filter((c) => !names.has(c));
  // A grid always keeps a column: when only the joined mart's were shown, the mart's own defaults come back.
  if (columns.length === 0) columns = own;
  const kept = grid.sorts && sortsOnColumns(grid.sorts, columns);
  return {
    removed,
    grid: {
      ...grid,
      columns,
      filters: Object.fromEntries(Object.entries(grid.filters).filter(([k]) => !names.has(k))),
      sorts: grid.sorts && grid.sorts.length > 0 && kept!.length === 0 ? null : kept,
    },
  };
}

export type Plan = {
  selection: Selection;
  grids: Record<string, GridState>;
  /** What to save in `grid-columns`: the grid's columns and the remembered picks. */
  saves: { martId: string; columns: string[]; picks?: Picks }[];
  /** Marts that left the grid, with the own field names each was showing (null: forget what was remembered). */
  remember: { martId: string; fields: string[] | null }[];
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
  lastShownOf?: (martId: string) => string[] | null;
  /** Every field name of the mart itself (its schema), for the marts that may become the main one. */
  ownNames?: (martId: string) => string[];
};

const noShown = () => null;

/** What the old main mart and its joined marts leave behind when another mart replaces them. */
function leaveAll(main: string, sources: JoinedSource[], grid: GridState, except?: string): Plan['remember'] {
  const out: Plan['remember'] = [{ martId: main, fields: ownColumnsIn(grid.columns, sources) }];
  for (const m of joinedMartIds(grid.columns, sources)) if (m !== except) out.push({ martId: m, fields: ownNamesIn(grid.columns, sources, m) });
  return out;
}

/** The clicked mart becomes the only selected one: joined columns it was left with are taken out, and remembered for its pairs. */
const becomeMain = (env: PlanEnv, id: string, remember: Plan['remember'] = []): Plan => {
  const selection = { sourceKey: env.sourceKeyFor(id), martId: id, record: null };
  const sources = env.sourcesOf(id);
  let grid = env.gridOf(id);
  const joined = joinedMartIds(grid.columns, sources);
  const picks: Picks = {};
  for (const m of joined) {
    const out = withoutMart(grid, sources, m, env.ownColumns(id));
    grid = out.grid;
    picks[m] = out.removed;
    remember.push({ martId: m, fields: ownNamesIn(out.removed, sources, m) });
  }
  // What it showed when it last left a grid, as its own columns (this is the newest memory it has).
  const offered = new Set(env.ownNames?.(id) ?? []);
  const last = (env.lastShownOf ?? noShown)(id)?.filter((n) => offered.has(n)) ?? [];
  const restored = last.length > 0 && !(last.length === grid.columns.length && last.every((c, i) => c === grid.columns[i]));
  if (last.length > 0) {
    const kept = grid.sorts && sortsOnColumns(grid.sorts, last);
    grid = { ...grid, columns: last, sorts: grid.sorts && grid.sorts.length > 0 && kept!.length === 0 ? null : kept };
    remember.push({ martId: id, fields: null });
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
  const joined = joinedMartIds(grid.columns, sources);
  const shownOf = env.lastShownOf ?? noShown;

  if (id === main) {
    if (joined.length === 0) return { selection: { sourceKey: env.selection.sourceKey, martId: null, record: null, cleared: true }, grids: {}, saves: [], remember: leaveAll(main, sources, grid) };
    // The next selected joined mart becomes main, with the others it can join.
    const [next, ...rest] = joined as [string, ...string[]];
    const nextSources = env.sourcesOf(next);
    const nextGrid = env.gridOf(next);
    const nextPicks = env.picksOf(next);
    const remember: Plan['remember'] = [{ martId: main, fields: ownColumnsIn(grid.columns, sources) }, { martId: next, fields: null }];
    // Its joined fields it was showing become its own columns: that is what it showed last.
    const offered = new Set(env.ownNames?.(next) ?? []);
    const shownNow = ownNamesIn(grid.columns, sources, next).filter((n) => offered.has(n));
    let columns = shownNow.length ? shownNow : nextGrid.columns;
    const have = new Set(joinedMartIds(columns, nextSources));
    for (const r of rest) {
      if (!isJoinable(nextSources, r)) { remember.push({ martId: r, fields: ownNamesIn(grid.columns, sources, r) }); continue; }
      if (have.has(r)) continue;
      columns = [...columns, ...fieldsFor(nextSources, r, nextPicks[r], ownNamesIn(grid.columns, sources, r)).filter((n) => !columns.includes(n))];
    }
    columns = orderColumns(columns, nextSources);
    const changed = columns.length !== nextGrid.columns.length || columns.some((c, i) => c !== nextGrid.columns[i]);
    const sorts = changed && nextGrid.sorts ? sortsOnColumns(nextGrid.sorts, columns) : nextGrid.sorts;
    return {
      selection: { sourceKey: env.sourceKeyFor(next), martId: next, record: null },
      grids: changed ? { [next]: { ...nextGrid, columns, sorts: nextGrid.sorts && nextGrid.sorts.length > 0 && sorts!.length === 0 ? null : sorts } } : {},
      saves: changed ? [{ martId: next, columns }] : [],
      remember,
    };
  }

  if (joined.includes(id)) {
    const { grid: next, removed } = withoutMart(grid, sources, id, env.ownColumns(main));
    return { selection: env.selection, grids: { [main]: next }, saves: [{ martId: main, columns: next.columns, picks: { [id]: removed } }], remember: [{ martId: id, fields: ownNamesIn(removed, sources, id) }] };
  }

  if (isJoinable(sources, id)) {
    const columns = orderColumns([...grid.columns, ...fieldsFor(sources, id, env.picksOf(main)[id], shownOf(id)).filter((n) => !grid.columns.includes(n))], sources);
    return { selection: env.selection, grids: { [main]: { ...grid, columns } }, saves: [{ martId: main, columns }], remember: [] };
  }

  return becomeMain(env, id, leaveAll(main, sources, grid));
}
