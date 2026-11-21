import { stubCtx } from './test-ctx';
import { createChartSettings } from './chart-settings';
import type { Ctx } from '../sdk/types';

const load = (charts: unknown[]) => createChartSettings({ ...stubCtx(), collections: () => ({ get: async () => ({ document: { version: 2, charts } }), put: async () => {} }) } as unknown as Ctx).load('M');

test('a sankey keeps its columns as strings, deduped, from 2 to 5', async () => {
  const s = await load([
    { id: 'a', kind: 'sankey', dimensions: ['x', 'y', 'x', 3, 'z', 'w', 'v', 'u'] },
    { id: 'b', kind: 'sankey', dimensions: ['x'] },
    { id: 'c', kind: 'sankey', dimensions: 'x' },
    { id: 'd', kind: 'sankey', dimensions: ['x', 'y'] },
  ]);
  expect(s.charts).toEqual([
    { id: 'a', kind: 'sankey', dimensions: ['x', 'y', 'z', 'w', 'v'] },
    { id: 'b', kind: 'sankey' },
    { id: 'c', kind: 'sankey' },
    { id: 'd', kind: 'sankey', dimensions: ['x', 'y'] },
  ]);
});
