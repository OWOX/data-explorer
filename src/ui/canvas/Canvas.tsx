import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge as FlowEdge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';
import { layoutNodes } from '../../graph/layout';
import type { Edge } from '../../model/types';
import { CARD_SIZE, MartCard, type CardData } from './MartCard';

const nodeTypes = { mart: MartCard };

type Props = { ids: string[]; edges: Edge[]; cards: Map<string, CardData>; direction: 'LR' | 'TB'; onSelect: (id: string) => void; onClear: () => void };

function Flow({ ids, edges, cards, direction, onSelect, onClear }: Props) {
  const { fitView } = useReactFlow();
  const positions = useMemo(() => layoutNodes(ids, edges, direction, CARD_SIZE), [ids, edges, direction]);
  const nodes: Node[] = positions.map((p) => ({ id: p.id, type: 'mart', position: { x: p.x, y: p.y }, data: { ...cards.get(p.id)!, direction } as never, draggable: false }));
  const set = new Set(ids);
  const flowEdges: FlowEdge[] = edges
    .filter((e) => set.has(e.source) && set.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'smoothstep', label: e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', '), labelStyle: { fontSize: 10 } }));

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 0);
    return () => clearTimeout(t);
  }, [positions, fitView]);

  return (
    <ReactFlow nodes={nodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={onClear} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
      <Background gap={16} />
      {direction === 'LR' && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}

export function Canvas(props: Props) {
  return <ReactFlowProvider><Flow {...props} /></ReactFlowProvider>;
}
