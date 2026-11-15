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
function SideArcEdge({ id, sourceX, sourceY, targetX, targetY, label }: EdgeProps) {
  const { path, labelX, labelY } = sideArc(sourceX, sourceY, targetX, targetY);
  return <BaseEdge id={id} path={path} style={EDGE_STYLE} label={label} labelX={labelX} labelY={labelY} labelStyle={LABEL_STYLE} labelBgStyle={LABEL_BG} labelBgPadding={[3, 2]} />;
}

const nodeTypes = { mart: MartCard };
const edgeTypes = { sideArc: SideArcEdge };

type Props = { ids: string[]; edges: Edge[]; cards: Map<string, CardData>; direction: 'LR' | 'TB'; selectedId?: string | null; onSelect: (id: string) => void; onClear: () => void };

const joinLabel = (e: Edge) => e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ');

function Flow({ ids, edges, cards, direction, selectedId = null, onSelect, onClear }: Props) {
  const { fitView, fitBounds } = useReactFlow();
  const initialized = useNodesInitialized();
  const positions = useMemo(
    () => (direction === 'TB' ? layoutColumn(columnOrder(ids, edges, selectedId), CARD_SIZE) : layoutNodes(ids, edges, direction, CARD_SIZE)),
    [ids, edges, direction, selectedId],
  );
  const nodes: Node[] = positions.map((p) => ({ id: p.id, type: 'mart', position: { x: p.x, y: p.y }, data: { ...cards.get(p.id)!, direction } as never, draggable: false }));
  const set = new Set(ids);
  const tb = direction === 'TB';
  const flowEdges: FlowEdge[] = tb
    ? exploreEdges(edges, ids, selectedId).map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: 'out', targetHandle: 'in', type: 'sideArc', label: joinLabel(e) }))
    : edges
        .filter((e) => set.has(e.source) && set.has(e.target))
        .map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'default', style: EDGE_STYLE, label: joinLabel(e), labelStyle: LABEL_STYLE, labelBgStyle: LABEL_BG, labelBgPadding: [3, 2] as [number, number] }));

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
      {direction === 'LR' && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}

export function Canvas(props: Props) {
  return <ReactFlowProvider><Flow {...props} /></ReactFlowProvider>;
}
