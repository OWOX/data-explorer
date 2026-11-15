import { layoutNodes } from './layout';

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
