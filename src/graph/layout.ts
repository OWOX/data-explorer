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
