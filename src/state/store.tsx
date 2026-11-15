import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { createRowCounter, type RowCounter } from '../api/row-counts';
import { createSchemaLoader, type SchemaLoader } from '../api/schemas';
import type { Ctx } from '../sdk/types';
import type { ColumnFilter } from '../filters/build';
import { recordTabId } from '../records/relationships';

export type Tab =
  | { kind: 'mart'; id: string; martId: string; initialFilters: ColumnFilter[] }
  | { kind: 'record'; id: string; martId: string; pk: Record<string, unknown> };

export type State = { selectedId: string | null; search: string; contextIds: string[]; tabs: Tab[]; activeTabId: string | null; modelVersion: number };

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'search'; q: string }
  | { type: 'toggleContext'; id: string }
  | { type: 'openMart'; martId: string; filters?: ColumnFilter[] }
  | { type: 'openRecord'; martId: string; pk: Record<string, unknown> }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'refreshModel' };

export const initialState: State = { selectedId: null, search: '', contextIds: [], tabs: [], activeTabId: null, modelVersion: 0 };

const martOf = (tabs: Tab[], id: string | null) => tabs.find((t) => t.id === id)?.martId ?? null;

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'select': return { ...state, selectedId: a.id };
    case 'search': return { ...state, search: a.q };
    case 'toggleContext': {
      const has = state.contextIds.includes(a.id);
      return { ...state, contextIds: has ? state.contextIds.filter((c) => c !== a.id) : [...state.contextIds, a.id] };
    }
    case 'openMart': {
      const id = `mart:${a.martId}`;
      const existing = state.tabs.find((t) => t.id === id);
      const tabs = existing
        ? a.filters ? state.tabs.map((t) => (t.id === id ? { ...t, initialFilters: a.filters! } as Tab : t)) : state.tabs
        : [...state.tabs, { kind: 'mart', id, martId: a.martId, initialFilters: a.filters ?? [] } as Tab];
      return { ...state, tabs, activeTabId: id, selectedId: a.martId };
    }
    case 'openRecord': {
      const id = recordTabId(a.martId, a.pk);
      const tabs = state.tabs.some((t) => t.id === id) ? state.tabs : [...state.tabs, { kind: 'record', id, martId: a.martId, pk: a.pk } as Tab];
      return { ...state, tabs, activeTabId: id, selectedId: a.martId };
    }
    case 'activate': return { ...state, activeTabId: a.tabId, selectedId: martOf(state.tabs, a.tabId) };
    case 'close': {
      const i = state.tabs.findIndex((t) => t.id === a.tabId);
      if (i < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== a.tabId);
      if (tabs.length === 0) return { ...state, tabs, activeTabId: null, selectedId: null };
      if (state.activeTabId !== a.tabId) return { ...state, tabs };
      const next = tabs[Math.max(0, i - 1)]!;
      return { ...state, tabs, activeTabId: next.id, selectedId: next.martId };
    }
    case 'refreshModel': return { ...state, modelVersion: state.modelVersion + 1 };
  }
}

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

type Services = { ctx: Ctx; schemas: SchemaLoader; counter: RowCounter };
const ServicesCtx = createContext<Services | null>(null);

export function AppServices({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const value = useMemo(() => ({ ctx, schemas: createSchemaLoader(ctx), counter: createRowCounter(ctx) }), [ctx]);
  return <ServicesCtx.Provider value={value}>{children}</ServicesCtx.Provider>;
}

export function useServices(): Services {
  const v = useContext(ServicesCtx);
  if (!v) throw new Error('useServices outside AppServices');
  return v;
}
