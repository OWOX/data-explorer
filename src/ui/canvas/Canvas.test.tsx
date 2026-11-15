import { render } from '@testing-library/react';
import { Position } from '@xyflow/react';
import type { Edge } from '../../model/types';
import { buildFlowEdges, SideArcEdge } from './Canvas';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }, { sourceField: 'sku', targetField: 'sku' }] },
];

test('explore arcs have no stacked label; the join is the edge aria-label and data', () => {
  const flow = buildFlowEdges(edges, ['orders', 'customers', 'items'], 'orders', true);
  expect(flow.length).toBeGreaterThan(0);
  for (const e of flow) {
    expect(e.label).toBeUndefined();
    expect(e.type).toBe('sideArc');
  }
  expect(flow.find((e) => e.id === 'e2')).toMatchObject({ ariaLabel: 'order_id → id, sku → sku', data: { join: 'order_id → id, sku → sku' } });
});

test('levels mode keeps the labels on the edges', () => {
  const flow = buildFlowEdges(edges, ['orders', 'customers'], null, false);
  expect(flow).toHaveLength(1);
  expect(flow[0]!.label).toBe('customer_id → id');
});

test('a side arc renders its join as a hover title and no text label', () => {
  const { container } = render(
    <svg>
      <SideArcEdge id="e1" source="a" target="b" sourceX={10} sourceY={10} targetX={10} targetY={200} sourcePosition={Position.Right} targetPosition={Position.Right} data={{ join: 'customer_id → id' }} {...({} as object)} />
    </svg>,
  );
  expect(container.querySelector('title')?.textContent).toBe('customer_id → id');
  expect(container.querySelector('.react-flow__edge-text')).toBeNull();
  expect(container.querySelector('path')).not.toBeNull();
});
