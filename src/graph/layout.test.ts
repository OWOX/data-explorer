import { columnOrder, layoutColumn, layoutNodes } from './layout';

const edges = [{ id: '1', source: 'a', target: 'b', joins: [] }];

test('LR puts the target to the right; TB puts it below', () => {
  const lr = layoutNodes(['a', 'b'], edges, 'LR', { width: 260, height: 120 });
  const tb = layoutNodes(['a', 'b'], edges, 'TB', { width: 260, height: 120 });
  const at = (p: typeof lr, id: string) => p.find((n) => n.id === id)!;
  expect(at(lr, 'b').x).toBeGreaterThan(at(lr, 'a').x);
  expect(at(tb, 'b').y).toBeGreaterThan(at(tb, 'a').y);
});

test('edges to hidden nodes are ignored', () => {
  expect(layoutNodes(['a'], edges, 'LR', { width: 260, height: 120 })).toHaveLength(1);
});

test('layoutColumn stacks every card in one column', () => {
  const p = layoutColumn(['a', 'b', 'c'], { width: 260, height: 120 }, 20);
  expect(new Set(p.map((n) => n.x)).size).toBe(1);
  expect(p.map((n) => n.y)).toEqual([0, 140, 280]);
});

test('columnOrder: inbound, selected, outbound, rest', () => {
  const es = [
    { id: '1', source: 'in', target: 'sel', joins: [] },
    { id: '2', source: 'sel', target: 'out', joins: [] },
    { id: '3', source: 'x', target: 'out', joins: [] },
  ];
  expect(columnOrder(['sel', 'out', 'in', 'x'], es, 'sel')).toEqual(['in', 'sel', 'out', 'x']);
  expect(columnOrder(['b', 'a'], es, null)).toEqual(['b', 'a']);
});
