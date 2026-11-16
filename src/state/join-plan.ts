// What a click on a data mart card does to the selection: the main mart, the joined marts and the main's grid.
// The joined marts are not stored anywhere: a mart is selected-joined exactly when one of its joined fields is a column of the main grid.
import type { JoinedSource } from '../api/blendable';
import type { Picks } from '../api/grid-columns';
import { sortsOnColumns } from '../model/sort';
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

/** The first text field of the source, else its first field. */
export const firstTextField = (source: JoinedSource): Field | undefined => source.fields.find((f) => f.category === 'string') ?? source.fields[0];

/** The fields a joined mart comes back with: what was last chosen for the pair (those the source still offers), else the first text field. */
export function fieldsFor(sources: JoinedSource[], martId: string, remembered: string[] | undefined): string[] {
  const offered = namesOf(sources, martId);
  const kept = (remembered ?? []).filter((n) => offered.has(n));
  if (kept.length) return kept;
  const source = sourceOfMart(sources, martId);
  const first = source && firstTextField(source);
  return first ? [first.name] : [];
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
};

const becomeMain = (env: PlanEnv, id: string): Plan => ({ selection: { sourceKey: env.sourceKeyFor(id), martId: id, record: null }, grids: {}, saves: [] });

/** Joined marts a card click can touch need `sourcesOf` and `gridOf` for the main and for every selected joined mart. */
export function planClick(env: PlanEnv, id: string): Plan {
  const main = env.selection.martId;
  if (!main) return becomeMain(env, id);
  const sources = env.sourcesOf(main);
  const grid = env.gridOf(main);
  const joined = joinedMartIds(grid.columns, sources);

  if (id === main) {
    if (joined.length === 0) return { selection: { sourceKey: env.selection.sourceKey, martId: null, record: null, cleared: true }, grids: {}, saves: [] };
    // The next selected joined mart becomes main, with the others it can join.
    const [next, ...rest] = joined as [string, ...string[]];
    const nextSources = env.sourcesOf(next);
    const nextGrid = env.gridOf(next);
    const nextPicks = env.picksOf(next);
    let columns = nextGrid.columns;
    const have = new Set(joinedMartIds(columns, nextSources));
    for (const r of rest) {
      if (!isJoinable(nextSources, r) || have.has(r)) continue;
      columns = [...columns, ...fieldsFor(nextSources, r, nextPicks[r]).filter((n) => !columns.includes(n))];
    }
    const changed = columns.length !== nextGrid.columns.length;
    return {
      selection: { sourceKey: env.sourceKeyFor(next), martId: next, record: null },
      grids: changed ? { [next]: { ...nextGrid, columns } } : {},
      saves: changed ? [{ martId: next, columns }] : [],
    };
  }

  if (joined.includes(id)) {
    const { grid: next, removed } = withoutMart(grid, sources, id, env.ownColumns(main));
    return { selection: env.selection, grids: { [main]: next }, saves: [{ martId: main, columns: next.columns, picks: { [id]: removed } }] };
  }

  if (isJoinable(sources, id)) {
    const columns = [...grid.columns, ...fieldsFor(sources, id, env.picksOf(main)[id]).filter((n) => !grid.columns.includes(n))];
    return { selection: env.selection, grids: { [main]: { ...grid, columns } }, saves: [{ martId: main, columns }] };
  }

  return becomeMain(env, id);
}
