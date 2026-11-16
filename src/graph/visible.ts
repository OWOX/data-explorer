import type { Edge, Mart, Model } from '../model/types';
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
  /** The contexts selected as badges; none selected is no filter, and a mart needs any one of them. */
  contextIds: string[];
  /** The storages ticked in the filter; null is all of them. */
  storageIds?: string[] | null;
  /** The joined data marts selected with the main one, in the order they were added: each is shown whatever else applies. */
  joined?: string[];
  /** Marts that carry a filter of the grid without being a selected joined mart: shown too, after the joined ones. */
  filtered?: string[];
};
export type VisibleResult = {
  ids: string[];
  /** The mart a first load selects: most inbound edges among the marts the member can open. */
  focusId: string | null;
};

/** Which marts the Data Marts band shows, by the first rule that applies (spec, "Which marts show"). */
export function computeVisible({ model, selection, search, contextIds, storageIds = null, joined = [], filtered = [] }: VisibleInput): VisibleResult {
  const inbound = inboundCounts(model.edges);
  // A mart in an unticked storage is out of every rule below, the selected one included.
  const inStorage = (id: string) => storageIds === null || storageIds.includes(model.marts.get(id)?.storageId ?? '');
  const accessible = [...model.marts.values()].filter((m) => m.accessible && inStorage(m.id));
  const focusId = pickFocus(accessible.map((m) => m.id), model.marts, inbound);
  const selectedId = selection.martId && model.marts.has(selection.martId) ? selection.martId : null;
  const rankOf = (first: string | null) => rank(model.marts, inbound, first);
  const order = (ids: string[], first = selectedId) => ids.sort(rankOf(first));
  // Main first, then the selected joined marts, then everything else breadth first from them over the edges, so cards that are
  // linked sit near each other and the lines cross less; what no edge reaches follows by rank.
  const arrange = (ids: string[], first: string | null): string[] => {
    const set = new Set(ids);
    const joinedHere = first && selectedId === first ? always.filter((id) => set.has(id) && id !== first) : [];
    const out = [...(first && set.has(first) ? [first] : []), ...joinedHere];
    const placed = new Set(out);
    const queue = [...out];
    const byRank = rankOf(first);
    while (queue.length) {
      const next = neighbours(queue.shift()!, model.edges).filter((n) => set.has(n) && !placed.has(n)).sort(byRank);
      for (const n of next) { placed.add(n); out.push(n); queue.push(n); }
    }
    return [...out, ...ids.filter((id) => !placed.has(id)).sort(byRank)];
  };
  // A mart with a column on the grid or a filter applied is always shown: no search, context or storage filter takes it away.
  const always = [...new Set([...joined, ...filtered])].filter((id) => model.marts.has(id));
  const withJoined = (ids: string[]) => (selectedId ? [...new Set([...ids, ...always])] : ids);

  // 1. A search, or a selected context badge: the matches, narrowed to the selected source.
  if (search.trim() || contextIds.length > 0) {
    const source = selection.sourceKey;
    const ids: string[] = [];
    for (const mart of accessible) {
      if (source && mart.sourceKey !== source) continue;
      if (!matchesContexts(mart, contextIds)) continue;
      if (!matchesSearch(mart, search)) continue;
      ids.push(mart.id);
    }
    return { ids: arrange(withJoined(ids), selectedId), focusId };
  }

  // 2. A mart is selected: it and every mart joined to it, in either direction; with joined marts selected, every mart connected to any of them too.
  if (selectedId) {
    const selected = [selectedId, ...joined.filter((id) => model.marts.has(id))];
    return { ids: arrange(withJoined([...new Set([...selected, ...selected.flatMap((id) => neighbours(id, model.edges))])].filter(inStorage)), selectedId), focusId };
  }

  // 3. Only a source is selected: every mart it feeds.
  if (selection.sourceKey) {
    const source = model.sources.find((s) => s.key === selection.sourceKey);
    return { ids: order((source?.martIds ?? []).filter((id) => model.marts.has(id) && inStorage(id))), focusId };
  }

  // 4. Nothing selected, which is only the moment before a first load selects the focus mart.
  return { ids: focusId ? order([focusId, ...neighbours(focusId, model.edges)].filter(inStorage), focusId) : [], focusId };
}
