import type { Edge, Mart, Model, Schema } from '../model/types';
import type { Selection } from '../state/store';
import { matchesContexts, matchesSearch } from './search';

export function inboundCounts(edges: Edge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) m.set(e.target, (m.get(e.target) ?? 0) + 1);
  return m;
}

function rank(marts: Map<string, Mart>, inbound: Map<string, number>, selectedId: string | null) {
  return (a: string, b: string) =>
    Number(b === selectedId) - Number(a === selectedId) ||
    (inbound.get(b) ?? 0) - (inbound.get(a) ?? 0) ||
    (marts.get(a)?.title ?? a).localeCompare(marts.get(b)?.title ?? b);
}

export function pickFocus(ids: Iterable<string>, marts: Map<string, Mart>, inbound: Map<string, number>): string | null {
  return [...ids].sort(rank(marts, inbound, null))[0] ?? null;
}

export function neighbours(id: string, edges: Edge[]): string[] {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === id && e.target !== id) out.add(e.target);
    if (e.target === id && e.source !== id) out.add(e.source);
  }
  return [...out];
}

export type VisibleInput = {
  model: Model;
  selection: Selection;
  search: string;
  contextIds: string[];
  schemas: (id: string) => Schema | undefined;
};
export type VisibleResult = {
  ids: string[];
  /** The mart a first load selects: most inbound edges among the marts the member can open. */
  focusId: string | null;
  /** Marts the search matched through a field rather than the title, with that field. */
  fieldHits: Map<string, string>;
};

/** Which marts the Data Marts band shows, by the first rule that applies (spec, "Which marts show"). */
export function computeVisible({ model, selection, search, contextIds, schemas }: VisibleInput): VisibleResult {
  const inbound = inboundCounts(model.edges);
  const fieldHits = new Map<string, string>();
  const accessible = [...model.marts.values()].filter((m) => m.accessible);
  const focusId = pickFocus(accessible.map((m) => m.id), model.marts, inbound);
  const selectedId = selection.martId && model.marts.has(selection.martId) ? selection.martId : null;
  const order = (ids: string[], first = selectedId) => ids.sort(rank(model.marts, inbound, first));

  // 1. Search or context filter: the matches, narrowed to the selected source.
  if (search.trim() || contextIds.length) {
    const source = selection.sourceKey;
    const ids: string[] = [];
    for (const mart of accessible) {
      if (source && mart.sourceKey !== source) continue;
      if (!matchesContexts(mart, contextIds)) continue;
      const r = matchesSearch(mart, search, model.contexts, schemas(mart.id));
      if (!r.hit) continue;
      ids.push(mart.id);
      if (r.field) fieldHits.set(mart.id, r.field);
    }
    return { ids: order(ids), focusId, fieldHits };
  }

  // 2. A mart is selected: it and every mart joined to it, in either direction.
  if (selectedId) return { ids: order([selectedId, ...neighbours(selectedId, model.edges)]), focusId, fieldHits };

  // 3. Only a source is selected: every mart it feeds.
  if (selection.sourceKey) {
    const source = model.sources.find((s) => s.key === selection.sourceKey);
    return { ids: order((source?.martIds ?? []).filter((id) => model.marts.has(id))), focusId, fieldHits };
  }

  // 4. Nothing selected, which is only the moment before a first load selects the focus mart.
  return { ids: focusId ? order([focusId, ...neighbours(focusId, model.edges)], focusId) : [], focusId, fieldHits };
}
