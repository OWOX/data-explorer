import dagre from '@dagrejs/dagre';
import type { Edge } from '../model/types';

export type Positioned = { id: string; x: number; y: number };

export function layoutNodes(ids: string[], edges: Edge[], direction: 'LR' | 'TB', size: { width: number; height: number }): Positioned[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const set = new Set(ids);
  ids.forEach((id) => g.setNode(id, { ...size }));
  edges.filter((e) => set.has(e.source) && set.has(e.target)).forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return ids.map((id) => {
    const n = g.node(id);
    return { id, x: n.x - size.width / 2, y: n.y - size.height / 2 };
  });
}

/** One vertical column, in the given order: the explore-mode layout. */
export function layoutColumn(ids: string[], size: { width: number; height: number }, gap = 24): Positioned[] {
  return ids.map((id, i) => ({ id, x: 0, y: i * (size.height + gap) }));
}

/** Inbound neighbours, then the selected mart, then outbound neighbours, then the rest. */
export function columnOrder(ids: string[], edges: Edge[], selectedId: string | null): string[] {
  if (!selectedId || !ids.includes(selectedId)) return ids;
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const e of edges) {
    if (e.target === selectedId && e.source !== selectedId) inbound.add(e.source);
    if (e.source === selectedId && e.target !== selectedId) outbound.add(e.target);
  }
  const before = ids.filter((id) => inbound.has(id));
  const after = ids.filter((id) => outbound.has(id) && !inbound.has(id));
  const rest = ids.filter((id) => id !== selectedId && !inbound.has(id) && !outbound.has(id));
  return [...before, selectedId, ...after, ...rest];
}

/** Explore mode draws a line only between the selected mart and each neighbour. */
export function exploreEdges(edges: Edge[], ids: string[], selectedId: string | null): Edge[] {
  if (!selectedId) return [];
  const set = new Set(ids);
  return edges.filter((e) => set.has(e.source) && set.has(e.target) && (e.source === selectedId || e.target === selectedId));
}

/** A cubic that leaves and enters on the right and bows out further the longer the span. */
export function sideArc(sx: number, sy: number, tx: number, ty: number): { path: string; labelX: number; labelY: number } {
  const k = 24 + Math.abs(ty - sy) * 0.15;
  return {
    path: `M ${sx},${sy} C ${sx + k},${sy} ${tx + k},${ty} ${tx},${ty}`,
    // Bezier at t = 0.5, which is the outermost point of the bow.
    labelX: (sx + 3 * (sx + k) + 3 * (tx + k) + tx) / 8,
    labelY: (sy + 3 * sy + 3 * ty + ty) / 8,
  };
}
