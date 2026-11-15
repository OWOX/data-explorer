import { BaseEdge, Controls, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Edge as FlowEdge, type EdgeProps, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef } from 'react';
import { columnOrder, exploreEdges, layoutColumn, layoutNodes, sideArc } from '../../graph/layout';
import type { Edge } from '../../model/types';
import { CARD_SIZE, MartCard, type CardData } from './MartCard';

/** Room right of the cards that the explore-mode arcs bow into. */
export const ARC_ROOM = 130;

const EDGE_STYLE = { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 };
const LABEL_STYLE = { fontSize: 10, fill: 'var(--muted-foreground)' };
const LABEL_BG = { fill: 'var(--background)' };

/** Explore mode: leaves and enters on the right, bowing out so nested arcs never cross a card. */
export function SideArcEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const { path } = sideArc(sourceX, sourceY, targetX, targetY);
  // With 8 or more neighbours the arcs' labels stack on top of each other, so the join is a hover hint instead.
  return <g><title>{String(data?.join ?? '')}</title><BaseEdge id={id} path={path} style={EDGE_STYLE} /></g>;
}

const nodeTypes = { mart: MartCard };
const edgeTypes = { sideArc: SideArcEdge };

type Props = { ids: string[]; edges: Edge[]; cards: Map<string, CardData>; direction: 'LR' | 'TB'; selectedId?: string | null; onSelect: (id: string) => void; onClear: () => void };

export function buildFlowEdges(edges: Edge[], ids: string[], selectedId: string | null, tb: boolean): FlowEdge[] {
  const set = new Set(ids);
  return tb
    ? exploreEdges(edges, ids, selectedId).map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: 'out', targetHandle: 'in', type: 'sideArc', ariaLabel: joinLabel(e), data: { join: joinLabel(e) } }))
    : edges
        .filter((e) => set.has(e.source) && set.has(e.target))
        .map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'default', style: EDGE_STYLE, label: joinLabel(e), labelStyle: LABEL_STYLE, labelBgStyle: LABEL_BG, labelBgPadding: [3, 2] as [number, number] }));
}

const joinLabel = (e: Edge) => e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ');

function Flow({ ids, edges, cards, direction, selectedId = null, onSelect, onClear }: Props) {
  const { fitView, fitBounds } = useReactFlow();
  const initialized = useNodesInitialized();
  const positions = useMemo(
    () => (direction === 'TB' ? layoutColumn(columnOrder(ids, edges, selectedId), CARD_SIZE) : layoutNodes(ids, edges, direction, CARD_SIZE)),
    [ids, edges, direction, selectedId],
  );
  const nodes: Node[] = positions.map((p) => ({ id: p.id, type: 'mart', position: { x: p.x, y: p.y }, data: { ...cards.get(p.id)!, direction } as never, draggable: false }));
  const tb = direction === 'TB';
  const flowEdges = buildFlowEdges(edges, ids, selectedId, tb);

  // Refit only when the visible set (or the layout it sits in) changes, never on identity churn.
  const fitKey = `${direction}:${ids.join('|')}${tb ? `:${selectedId ?? ''}` : ''}`;
  const fitted = useRef('');
  const live = useRef({ positions, selectedId, tb });
  useEffect(() => { live.current = { positions, selectedId, tb }; });
  useEffect(() => {
    if (!initialized || fitted.current === fitKey) return;
    const t = setTimeout(() => {
      fitted.current = fitKey;
      const { positions: pos, selectedId: sel, tb: column } = live.current;
      const focus = column && sel ? pos.find((p) => p.id === sel) : undefined;
      if (focus) void fitBounds({ x: focus.x, y: focus.y, width: CARD_SIZE.width + ARC_ROOM, height: CARD_SIZE.height }, { padding: 0.05, duration: 200 });
      else void fitView({ padding: 0.15, duration: 200, maxZoom: 1 });
    }, 0);
    return () => clearTimeout(t);
  }, [initialized, fitKey, fitView, fitBounds]);

  return (
    <ReactFlow nodes={nodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={onClear} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
      {direction === 'LR' && <Controls showInteractive={false} position="bottom-right" />}
    </ReactFlow>
  );
}

export function Canvas(props: Props) {
  return <ReactFlowProvider><Flow {...props} /></ReactFlowProvider>;
}
