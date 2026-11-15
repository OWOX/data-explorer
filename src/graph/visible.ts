import { VISIBLE_BUDGET } from '../config';
import type { Edge, Mart, Model, Schema } from '../model/types';
import { matchesContexts, matchesSearch } from './search';

export function inboundCounts(edges: Edge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) m.set(e.target, (m.get(e.target) ?? 0) + 1);
  return m;
}

function rank(marts: Map<string, Mart>, inbound: Map<string, number>) {
  return (a: string, b: string) =>
    (inbound.get(b) ?? 0) - (inbound.get(a) ?? 0) ||
    (marts.get(a)?.title ?? a).localeCompare(marts.get(b)?.title ?? b);
}

export function pickFocus(ids: Iterable<string>, marts: Map<string, Mart>, inbound: Map<string, number>): string | null {
  return [...ids].sort(rank(marts, inbound))[0] ?? null;
}

export function neighbours(id: string, edges: Edge[]): string[] {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === id && e.target !== id) out.add(e.target);
    if (e.target === id && e.source !== id) out.add(e.source);
  }
  return [...out];
}

export function expandLevels(focus: string, edges: Edge[], budget: number): string[] {
  const seen = new Set([focus]);
  let frontier = [focus];
  let level = 0;
  while (frontier.length) {
    const next = new Set<string>();
    for (const id of frontier) for (const n of neighbours(id, edges)) if (!seen.has(n)) next.add(n);
    if (next.size === 0) break;
    level++;
    if (level > 1 && seen.size + next.size > budget) break;
    next.forEach((n) => seen.add(n));
    frontier = [...next];
  }
  return [...seen];
}

export type VisibleInput = { model: Model; selectedId: string | null; search: string; contextIds: string[]; schemas: (id: string) => Schema | undefined };
export type VisibleResult = { ids: string[]; focusId: string | null; hiddenMatches: number; fieldHits: Map<string, string>; mode: 'levels' | 'selected' | 'filtered' | 'empty' };

export function computeVisible({ model, selectedId, search, contextIds, schemas }: VisibleInput): VisibleResult {
  const inbound = inboundCounts(model.edges);
  const fieldHits = new Map<string, string>();

  if (selectedId && model.marts.has(selectedId)) {
    return { ids: [selectedId, ...neighbours(selectedId, model.edges)], focusId: selectedId, hiddenMatches: 0, fieldHits, mode: 'selected' };
  }

  if (search.trim() || contextIds.length) {
    const matches: string[] = [];
    for (const mart of model.marts.values()) {
      if (!matchesContexts(mart, contextIds)) continue;
      const r = matchesSearch(mart, search, model.contexts, schemas(mart.id));
      if (!r.hit) continue;
      matches.push(mart.id);
      if (r.field) fieldHits.set(mart.id, r.field);
    }
    matches.sort(rank(model.marts, inbound));
    if (matches.length === 0) return { ids: [], focusId: null, hiddenMatches: 0, fieldHits, mode: 'empty' };
    const ids = matches.slice(0, VISIBLE_BUDGET);
    return { ids, focusId: ids[0]!, hiddenMatches: matches.length - ids.length, fieldHits, mode: 'filtered' };
  }

  const focusId = pickFocus(model.marts.keys(), model.marts, inbound);
  if (!focusId) return { ids: [], focusId: null, hiddenMatches: 0, fieldHits, mode: 'empty' };
  const expanded = expandLevels(focusId, model.edges, VISIBLE_BUDGET);
  // Fill the screen up to the budget with other connected marts; isolated marts never appear.
  const shown = new Set(expanded);
  const connected = new Set<string>();
  for (const e of model.edges) {
    if (e.source === e.target) continue;
    if (model.marts.has(e.source)) connected.add(e.source);
    if (model.marts.has(e.target)) connected.add(e.target);
  }
  const rest = [...connected].filter((id) => !shown.has(id)).sort(rank(model.marts, inbound));
  const room = Math.max(0, VISIBLE_BUDGET - expanded.length);
  const ids = [...expanded, ...rest.slice(0, room)];
  return { ids, focusId, hiddenMatches: rest.length - Math.min(room, rest.length), fieldHits, mode: 'levels' };
}
