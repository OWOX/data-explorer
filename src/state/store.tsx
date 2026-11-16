import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { createBlendableLoader, type BlendableLoader } from '../api/blendable';
import { createExporter, type Exporter } from '../api/exports';
import { createColumnStore, type ColumnStore } from '../api/grid-columns';
import { createPreferences, type Preferences } from '../api/preferences';
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
};

/** What the Data band's grid keeps per mart for the session. */
export type GridState = { columns: string[]; filters: Record<string, ColumnFilter>; /** null: the member set none, so the grid opens in the default order (newest date first); a list, even an empty one, is their own. */ sorts: SortKey[] | null; limit: number };

export type State = {
  selection: Selection;
  /** Selections Undo returns to, oldest first. */
  history: Selection[];
  /** Selections Redo re-applies, the one undone last at the end; any new navigation empties it. */
  future: Selection[];
  search: string;
  /** The contexts selected as badges in the Data Marts band; none is no filter. */
  contextIds: string[];
  /** The storages ticked in the Data Marts filter; null is all of them. */
  storageIds: string[] | null;
  grids: Record<string, GridState>;
  modelVersion: number;
};

/** The source that feeds a mart, or null: lets the reducer keep a selected source only when it still applies. */
export type SourceOf = (martId: string) => string | null;

export type Action =
  | { type: 'init'; focusId: string }
  | { type: 'selectSource'; key: string | null }
  | { type: 'selectMart'; id: string; sourceOf: SourceOf }
  | { type: 'openRecord'; martId: string; pk: Record<string, unknown>; sourceOf?: SourceOf }
  | { type: 'follow'; target: ClickTarget; sourceOf: SourceOf }
  | { type: 'undo'; known?: (selection: Selection) => boolean }
  | { type: 'redo'; known?: (selection: Selection) => boolean }
  /** Swap the selection without a history entry: a refresh took the selected mart or source away. */
  | { type: 'replace'; selection: Selection }
  | { type: 'search'; q: string }
  | { type: 'toggleContext'; id: string }
  /** Narrow the Data Marts band to these storages (null: all). Not a selection change, so no history entry. */
  | { type: 'setStorages'; ids: string[] | null }
  | { type: 'saveGrid'; martId: string; grid: GridState }
  | { type: 'refreshModel' };

export const HISTORY_LIMIT = 20;

const emptySelection: Selection = { sourceKey: null, martId: null, record: null };
export const initialState: State = { selection: emptySelection, history: [], future: [], search: '', contextIds: [], storageIds: null, grids: {}, modelVersion: 0 };

/** The source stays selected only when it feeds the mart being selected. */
const sourceFor = (current: Selection, martId: string, sourceOf?: SourceOf): string | null => {
  if (!current.sourceKey) return null;
  if (sourceOf) return sourceOf(martId) === current.sourceKey ? current.sourceKey : null;
  return martId === current.martId ? current.sourceKey : null;
};

/** Every change to the selection goes through here: it is what Back steps over. */
function move(state: State, next: Selection): State {
  if (JSON.stringify(next) === JSON.stringify(state.selection)) return state;
  return { ...state, selection: next, history: [...state.history, state.selection].slice(-HISTORY_LIMIT), future: [] };
}

export function reducer(state: State, a: Action): State {
  const cur = state.selection;
  switch (a.type) {
    case 'init': return cur.martId ? state : { ...state, selection: { ...cur, martId: a.focusId } };
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
      return { ...next, grids: { ...next.grids, [target.martId]: { columns: saved?.columns ?? [], filters, sorts: saved?.sorts ?? null, limit: PAGE_SIZE } } };
    }
    case 'undo': {
      // Entries naming a mart or source a refresh removed are skipped.
      const history = [...state.history];
      while (history.length) {
        const previous = history.pop()!;
        if (!a.known || a.known(previous)) return { ...state, selection: previous, history, future: [...state.future, cur].slice(-HISTORY_LIMIT) };
      }
      return history.length === state.history.length ? state : { ...state, history };
    }
    case 'redo': {
      const future = [...state.future];
      while (future.length) {
        const next = future.pop()!;
        if (!a.known || a.known(next)) return { ...state, selection: next, future, history: [...state.history, cur].slice(-HISTORY_LIMIT) };
      }
      return future.length === state.future.length ? state : { ...state, future };
    }
    case 'replace': return { ...state, selection: a.selection };
    // Searching narrows the Data Marts band; what is selected stays selected.
    case 'search': return { ...state, search: a.q };
    case 'toggleContext': {
      const has = state.contextIds.includes(a.id);
      return { ...state, contextIds: has ? state.contextIds.filter((c) => c !== a.id) : [...state.contextIds, a.id] };
    }
    case 'setStorages': return { ...state, storageIds: a.ids };
    case 'saveGrid': return { ...state, grids: { ...state.grids, [a.martId]: a.grid } };
    case 'refreshModel': return { ...state, modelVersion: state.modelVersion + 1 };
  }
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

type Services = { ctx: Ctx; schemas: SchemaLoader; blendable: BlendableLoader; counter: RowCounter; columnStore: ColumnStore; exporter: Exporter; preferences: Preferences };
const ServicesCtx = createContext<Services | null>(null);

export function AppServices({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const value = useMemo(() => ({ ctx, schemas: createSchemaLoader(ctx), blendable: createBlendableLoader(ctx), counter: createRowCounter(ctx), columnStore: createColumnStore(ctx), exporter: createExporter(ctx), preferences: createPreferences(ctx) }), [ctx]);
  return <ServicesCtx.Provider value={value}>{children}</ServicesCtx.Provider>;
}

export function useServices(): Services {
  const v = useContext(ServicesCtx);
  if (!v) throw new Error('useServices outside AppServices');
  return v;
}
