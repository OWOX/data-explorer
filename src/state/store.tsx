import type { AggregationRule, DateTruncRule } from '../model/aggregation';
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { createBlendableLoader, type BlendableLoader } from '../api/blendable';
import { createExporter, type Exporter } from '../api/exports';
import { createColumnStore, type ColumnStore } from '../api/grid-columns';
import { createPreferences, type Preferences } from '../api/preferences';
import { createChartSettings, type ChartSettingsStore } from '../api/chart-settings';
import { createRowCounter, type RowCounter } from '../api/row-counts';
import { createSchemaLoader, type SchemaLoader } from '../api/schemas';
import { PAGE_SIZE } from '../config';
import type { ColumnFilter } from '../filters/build';
import type { SortKey } from '../model/sort';
import type { Model } from '../model/types';
import type { ClickTarget } from '../records/relationships';
import type { Ctx } from '../sdk/types';

export type Selection = {
  sourceKey: string | null;
  martId: string | null;
  record: { martId: string; pk: Record<string, unknown> } | null;
  /** Filters a followed link asks the Data band to open with. */
  filters?: ColumnFilter[];
  /** The member took the last selected data mart away on purpose: nothing is selected, and the first load's pick must not come back. */
  cleared?: boolean;
};

/** A selection Undo or Redo returns to, with the grids the step also changed (null: the mart had none). */
export type Entry = Selection & { grids?: Record<string, GridState | null>; /** Order the entry was recorded in (from `State.seq`); it keeps it across Undo and Redo. Unlike a position, it survives the history being trimmed. */ seq: number };

/** What the Data band's grid keeps per mart for the session. */
export type GridState = { columns: string[]; filters: Record<string, ColumnFilter>; /** Pre-join filters on joined fields, keyed by field name, one per field. Absent or empty when there are none. */ slices?: Record<string, ColumnFilter>; /** null: the member set none, so the grid opens in the default order (newest date first); a list, even an empty one, is their own. */ sorts: SortKey[] | null; limit: number; /** Functions per column, in the order chosen; any of these or a bucket groups the rows. */ aggregations?: AggregationRule[]; /** One date bucket per date column. */ dateTrunc?: DateTruncRule[]; /** The alias paths whose data mart's Unique Count is a column ('' is the main mart). Absent or empty: none. It groups the rows like a function. */ uniqueCount?: string[]; /** Absent is the table. Part of the grid state so Undo and the view link carry it; saved in the member's grid-columns store with the filters, slices, sort and limit. */ view?: 'charts' };

export type State = {
  selection: Selection;
  /** Selections Undo returns to, oldest first. */
  history: Entry[];
  /** Selections Redo re-applies, the one undone last at the end; any new navigation empties it. */
  future: Entry[];
  search: string;
  /** The data marts a smart search found, best first; empty when the Data Marts band is not showing a search result. */
  found: string[];
  /** The contexts selected as badges in the Data Marts band; none is no filter. */
  contextIds: string[];
  /** The storages ticked in the Data Marts filter; null is all of them. */
  storageIds: string[] | null;
  grids: Record<string, GridState>;
  /** The seq the next history entry gets. */
  seq: number;
  /** Per mart whose saved view is still being read: the `seq` the next entry had when the grid began holding its saves. Entries from that seq on were made on defaults. */
  holds: Record<string, number>;
  modelVersion: number;
};

/** The source that feeds a mart, or null: lets the reducer keep a selected source only when it still applies. */
export type SourceOf = (martId: string) => string | null;

export type Action =
  | { type: 'init'; focusId: string; sourceKey?: string | null }
  | { type: 'selectSource'; key: string | null }
  | { type: 'selectMart'; id: string; sourceOf: SourceOf }
  | { type: 'openRecord'; martId: string; pk: Record<string, unknown>; sourceOf: SourceOf }
  | { type: 'follow'; target: ClickTarget; sourceOf: SourceOf }
  | { type: 'undo'; known: (selection: Selection) => boolean }
  | { type: 'redo'; known: (selection: Selection) => boolean }
  /** Swap the selection without a history entry: a refresh took the selected mart or source away. */
  | { type: 'replace'; selection: Selection }
  | { type: 'search'; q: string }
  /** A smart search found these marts: the band shows them (best first) and keeps the query. The selection change that goes with it is a `setMarts` or `selectMart`, which is what Undo covers. */
  | { type: 'smartFound'; query: string; ids: string[] }
  | { type: 'toggleContext'; id: string }
  /** Narrow the Data Marts band to these storages (null: all). Not a selection change, so no history entry. */
  | { type: 'setStorages'; ids: string[] | null }
  /** The main data mart, the joined ones (their columns in the main grid) and the grids they leave behind change in one step Undo covers. */
  | { type: 'setMarts'; selection: Selection; grids: Record<string, GridState>; always?: true }
  /** Stores a grid with no history entry, but only while the mart is still the main one and its grid is still `expect`. A late answer never overwrites what the member did meanwhile. */
  | { type: 'fillGrid'; martId: string; expect: GridState; grid: GridState }
  | { type: 'saveGrid'; martId: string; grid: GridState }
  /** The member changed the grid (a filter, a sort, an aggregation, a column shown or hidden, Reset): stored like `saveGrid`, and one step Undo covers. */
  | { type: 'editGrid'; martId: string; grid: GridState }
  /** The saved view arrived late and replaced parts of the grid: the newest Undo entry's "before" takes them too, so Undo returns to the saved view, not the defaults. */
  | { type: 'holdGrid'; martId: string }
  /** The hold ends with nothing to rebase: the grid went away, or the saved view turned out to be none. */
  | { type: 'releaseGrid'; martId: string }
  | { type: 'rebaseGrid'; martId: string; parts: Partial<GridState> }
  /** A view link opens: everything it carries is set at once. No history entry, so Undo has nothing to undo. */
  | { type: 'applyView'; selection: Selection; grid: GridState | null; search: string; found?: string[]; contextIds: string[]; storageIds: string[] | null }
  | { type: 'refreshModel' };

export const HISTORY_LIMIT = 20;

const emptySelection: Selection = { sourceKey: null, martId: null, record: null };
export const initialState: State = { selection: emptySelection, history: [], future: [], search: '', found: [], contextIds: [], storageIds: null, grids: {}, seq: 0, holds: {}, modelVersion: 0 };

/** The source stays selected only when it feeds the mart being selected. */
const sourceFor = (current: Selection, martId: string, sourceOf: SourceOf): string | null =>
  (current.sourceKey && sourceOf(martId) === current.sourceKey ? current.sourceKey : null);

/** Undo takes from `history` and fills `future`; redo is the same with the two swapped. Entries naming a mart or source a refresh removed are skipped. */
function step(state: State, from: 'history' | 'future', known: (s: Selection) => boolean): State {
  const to = from === 'history' ? 'future' : 'history';
  const stack = [...state[from]];
  while (stack.length) {
    const { grids: put, seq, ...entry } = stack.pop()!;
    if (known(entry)) {
      const now = put ? valuesOf(state.grids, Object.keys(put)) : undefined;
      const current = state.selection;
      return { ...state, selection: entry, grids: put ? applyGrids(state.grids, put) : state.grids, [from]: stack, [to]: [...state[to], { ...current, ...(now ? { grids: now } : {}), seq }].slice(-HISTORY_LIMIT) };
    }
  }
  return stack.length === state[from].length ? state : { ...state, [from]: stack };
}

/** Every change to the selection goes through here: it is what Back steps over. */
function move(state: State, next: Selection): State {
  if (deepEqual(next, state.selection)) return state;
  return { ...state, selection: next, seq: state.seq + 1, history: [...state.history, { ...state.selection, seq: state.seq }].slice(-HISTORY_LIMIT), future: [] };
}

const applyGrids = (grids: Record<string, GridState>, put: Record<string, GridState | null>) => {
  const next = { ...grids };
  for (const [id, g] of Object.entries(put)) { if (g) next[id] = g; else delete next[id]; }
  return next;
};
const valuesOf = (grids: Record<string, GridState>, keys: string[]): Record<string, GridState | null> => Object.fromEntries(keys.map((k) => [k, grids[k] ?? null]));

export function reducer(state: State, a: Action): State {
  const cur = state.selection;
  switch (a.type) {
    case 'init': return cur.martId ? state : { ...state, selection: { ...cur, martId: a.focusId, ...(a.sourceKey !== undefined ? { sourceKey: a.sourceKey } : {}) } };
    case 'selectSource': return move(state, { sourceKey: a.key === cur.sourceKey ? null : a.key, martId: null, record: null });
    case 'selectMart': return move(state, { sourceKey: sourceFor(cur, a.id, a.sourceOf), martId: a.id, record: null });
    case 'openRecord': return move(state, {
      sourceKey: sourceFor(cur, a.martId, a.sourceOf),
      martId: a.martId,
      record: { martId: a.martId, pk: a.pk },
      ...(a.martId === cur.martId && cur.filters ? { filters: cur.filters } : {}),
    });
    case 'follow': {
      const { target } = a;
      const sourceKey = sourceFor(cur, target.martId, a.sourceOf);
      if (target.kind === 'record') return move(state, { sourceKey, martId: target.martId, record: { martId: target.martId, pk: target.pk } });
      // The followed filters are a one-shot seed for the mart's saved grid, so edits made on top of them
      // are what Back finds again. `selection.filters` only tells a mounted grid to re-seed.
      const next = move(state, { sourceKey, martId: target.martId, record: null, filters: target.filters });
      const saved = state.grids[target.martId];
      const filters = Object.fromEntries(target.filters.map((f) => [f.field, f]));
      return { ...next, grids: { ...next.grids, [target.martId]: { columns: saved?.columns ?? [], filters, sorts: saved?.sorts ?? null, limit: PAGE_SIZE, ...(saved?.aggregations ? { aggregations: saved.aggregations } : {}), ...(saved?.dateTrunc ? { dateTrunc: saved.dateTrunc } : {}), ...(saved?.uniqueCount ? { uniqueCount: saved.uniqueCount } : {}) } } };
    }
    case 'undo': return step(state, 'history', a.known);
    case 'redo': return step(state, 'future', a.known);
    case 'replace': return { ...state, selection: a.selection };
    // Searching narrows the Data Marts band; what is selected stays selected.
    case 'search': return { ...state, search: a.q, found: [] };
    case 'smartFound': return { ...state, search: a.query, found: a.ids };
    case 'toggleContext': {
      const has = state.contextIds.includes(a.id);
      return { ...state, contextIds: has ? state.contextIds.filter((c) => c !== a.id) : [...state.contextIds, a.id] };
    }
    case 'setStorages': return { ...state, storageIds: a.ids };
    case 'setMarts': {
      const before = valuesOf(state.grids, Object.keys(a.grids));
      if (!a.always && deepEqual(a.selection, cur) && deepEqual(before, a.grids)) return state;
      return { ...state, selection: a.selection, grids: { ...state.grids, ...a.grids }, seq: state.seq + 1, history: [...state.history, { ...cur, grids: before, seq: state.seq }].slice(-HISTORY_LIMIT), future: [] };
    }
    case 'fillGrid': {
      // Only an Undo leaves future entries (every later step clears them), so a non-empty future means the pick was undone while the AI worked.
      if (state.future.length > 0) return state;
      if (cur.martId !== a.martId || !deepEqual(state.grids[a.martId] ?? null, a.expect)) return state;
      return { ...state, grids: { ...state.grids, [a.martId]: a.grid } };
    }
    case 'editGrid': {
      const before = state.grids[a.martId] ?? null;
      if (deepEqual(before, a.grid)) return state;
      return { ...state, grids: { ...state.grids, [a.martId]: a.grid }, seq: state.seq + 1, history: [...state.history, { ...cur, grids: { [a.martId]: before }, seq: state.seq }].slice(-HISTORY_LIMIT), future: [] };
    }
    case 'holdGrid': return { ...state, holds: { ...state.holds, [a.martId]: state.seq } };
    case 'releaseGrid': {
      if (!(a.martId in state.holds)) return state;
      const holds = { ...state.holds };
      delete holds[a.martId];
      return { ...state, holds };
    }
    case 'rebaseGrid': {
      // Every edit made while the saved view was unread was recorded on the defaults, whatever it changed: each one's "before" takes the late view's parts,
      // so no Undo or Redo returns to defaults that the next save would write over the saved view. Entries are told apart by `seq`, not position: history is trimmed, and an
      // Undo below the hold or a Redo can reorder what is where. With no hold on record only the newest entry counts.
      const from = state.holds[a.martId] ?? state.history.at(-1)?.seq ?? state.seq;
      const patch = (e: Entry): Entry => {
        if (e.seq < from) return e;
        const before = e.grids?.[a.martId];
        if (!before) return e;
        const next: GridState = { ...before, ...a.parts };
        for (const k of Object.keys(next) as (keyof GridState)[]) if (next[k] === undefined) delete next[k];
        return { ...e, grids: { ...e.grids, [a.martId]: next } };
      };
      const holds = { ...state.holds };
      delete holds[a.martId];
      return { ...state, holds, history: state.history.map(patch), future: state.future.map(patch) };
    }
    case 'saveGrid': return { ...state, grids: { ...state.grids, [a.martId]: a.grid } };
    case 'applyView': return {
      ...state,
      selection: a.selection,
      search: a.search,
      found: a.found ?? [],
      contextIds: a.contextIds,
      storageIds: a.storageIds,
      grids: a.grid && a.selection.martId ? { ...state.grids, [a.selection.martId]: a.grid } : state.grids,
    };
    case 'refreshModel': return { ...state, modelVersion: state.modelVersion + 1 };
  }
}

/** Structural equality for plain JSON values: key order does not matter, and a key holding undefined is the same as a missing one. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export const sourceOfModel = (model: Model): SourceOf => (id) => model.marts.get(id)?.sourceKey ?? null;

const StoreCtx = createContext<[State, Dispatch<Action>] | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useReducer(reducer, initialState);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): [State, Dispatch<Action>] {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

type Services = { /** The whole budget of a search's AI questions in ms; the default when absent (tests shorten or lengthen it). */ aiTimeoutMs?: number; ctx: Ctx; schemas: SchemaLoader; blendable: BlendableLoader; counter: RowCounter; columnStore: ColumnStore; exporter: Exporter; preferences: Preferences; chartSettings: ChartSettingsStore };
const ServicesCtx = createContext<Services | null>(null);

export function AppServices({ ctx, aiTimeoutMs, children }: { ctx: Ctx; aiTimeoutMs?: number; children: ReactNode }) {
  const value = useMemo(() => ({ aiTimeoutMs, ctx, schemas: createSchemaLoader(ctx), blendable: createBlendableLoader(ctx), counter: createRowCounter(ctx), columnStore: createColumnStore(ctx), exporter: createExporter(ctx), preferences: createPreferences(ctx), chartSettings: createChartSettings(ctx) }), [ctx, aiTimeoutMs]);
  return <ServicesCtx.Provider value={value}>{children}</ServicesCtx.Provider>;
}

export function useServices(): Services {
  const v = useContext(ServicesCtx);
  if (!v) throw new Error('useServices outside AppServices');
  return v;
}
