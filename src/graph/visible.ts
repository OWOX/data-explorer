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
  const before = rank(marts, inbound, null);
  let best: string | null = null;
  for (const id of ids) if (best === null || before(id, best) < 0) best = id;
  return best;
}

const adjacency = new WeakMap<Edge[], Map<string, string[]>>();
/** Each mart's neighbours over the edges, in edge order and without itself; built once per edges array. */
export function adjacencyOf(edges: Edge[]): Map<string, string[]> {
  let map = adjacency.get(edges);
  if (!map) {
    const sets = new Map<string, Set<string>>();
    const add = (from: string, to: string) => { const set = sets.get(from); if (set) set.add(to); else sets.set(from, new Set([to])); };
    for (const e of edges) {
      if (e.source === e.target) continue;
      add(e.source, e.target);
      add(e.target, e.source);
    }
    map = new Map([...sets].map(([id, set]) => [id, [...set]]));
    adjacency.set(edges, map);
  }
  return map;
}

export function neighbours(id: string, edges: Edge[]): string[] {
  return adjacencyOf(edges).get(id) ?? [];
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
  /** The marts a smart search found, best first: with any, the band shows these (and the always-shown ones) instead of matching titles. */
  found?: string[];
  /** The marts the main mart can join, at any depth (its blendable sources); null while they load. */
  joinable?: string[] | null;
};
export type VisibleResult = {
  ids: string[];
  /** The mart a first load selects: most inbound edges among the marts the member can open. */
  focusId: string | null;
  /** With a main mart set and its joins read: the marts it can join. The band dims the rest. Null otherwise. */
  joinable: Set<string> | null;
};

/** Which marts the Data Marts band shows, by the first rule that applies (spec, "Which marts show"). */
export function computeVisible({ model, selection, search, contextIds, storageIds = null, joined = [], filtered = [], found = [], joinable = null }: VisibleInput): VisibleResult {
  const inbound = inboundCounts(model.edges);
  // A mart in an unticked storage is out of every rule below, the selected one included.
  const inStorage = (id: string) => storageIds === null || storageIds.includes(model.marts.get(id)?.storageId ?? '');
  const accessible = [...model.marts.values()].filter((m) => m.accessible && inStorage(m.id));
  const focusId = pickFocus(accessible.map((m) => m.id), model.marts, inbound);
  const selectedId = selection.martId && model.marts.has(selection.martId) ? selection.martId : null;
  const joinableSet = selectedId && joinable ? new Set(joinable) : null;
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
  // The main mart is one of them (unless its storage is unticked, which takes it out of every rule).
  const always = [...new Set([...(selectedId && inStorage(selectedId) ? [selectedId] : []), ...joined, ...filtered])].filter((id) => model.marts.has(id));
  const withJoined = (ids: string[]) => (selectedId ? [...new Set([...ids, ...always])] : ids);

  // 0. A smart search found marts: the main mart and the joined marts first, then the hits, best first, then the marts whose title matches the query, then the marts that are always shown.
  if (found.length > 0) {
    const hits = found.filter((id) => model.marts.get(id)?.accessible && inStorage(id));
    const titled = accessible.filter((m) => matchesSearch(m, search) && matchesContexts(m, contextIds)).map((m) => m.id);
    // The main mart first, then its joined marts, then the hits.
    const head = always.filter((id) => id === selectedId || joined.includes(id));
    return { ids: [...new Set([...head, ...hits, ...titled, ...always])], focusId, joinable: joinableSet };
  }

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
    return { ids: arrange(withJoined(ids), selectedId), focusId, joinable: joinableSet };
  }

  // 2. A mart is selected: it and every mart it can join, at any depth. While those are read, its neighbours and the
  // joined marts' neighbours stand in, so the band is not empty.
  if (selectedId) {
    const selected = [selectedId, ...joined.filter((id) => model.marts.has(id))];
    const reach = joinableSet
      ? [...joinableSet].filter((id) => model.marts.get(id)?.accessible)
      : selected.flatMap((id) => neighbours(id, model.edges));
    return { ids: arrange(withJoined([...new Set([...selected, ...reach])].filter(inStorage)), selectedId), focusId, joinable: joinableSet };
  }

  // 3. Only a source is selected: every mart it feeds.
  if (selection.sourceKey) {
    const source = model.sources.find((s) => s.key === selection.sourceKey);
    return { ids: order((source?.martIds ?? []).filter((id) => model.marts.has(id) && inStorage(id))), focusId, joinable: joinableSet };
  }

  // 4. Nothing selected, which is only the moment before a first load selects the focus mart.
  return { ids: focusId ? order([focusId, ...neighbours(focusId, model.edges)].filter(inStorage), focusId) : [], focusId, joinable: joinableSet };
}
