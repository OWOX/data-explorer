import { renderHook } from '@testing-library/react';
import type { Edge } from '../model/types';
import { useIncomingLinks } from './useIncomingLinks';

const edge = (id: string, source: string, target: string, field = 'id'): Edge => ({ id, source, target, joins: [{ sourceField: `${source}_id`, targetField: field }] });

test('the same links come back while the edges that point at the mart say the same, however the array is rebuilt', () => {
  const { result, rerender } = renderHook(({ edges }) => useIncomingLinks('orders', edges), { initialProps: { edges: [edge('e1', 'items', 'orders'), edge('e2', 'a', 'b')] } });
  const first = result.current;
  expect(first.map((l) => l.edgeId)).toEqual(['e1']);
  rerender({ edges: [edge('e1', 'items', 'orders'), edge('e2', 'a', 'c')] });
  expect(result.current).toBe(first);
  rerender({ edges: [edge('e1', 'items', 'orders', 'other')] });
  expect(result.current).not.toBe(first);
  expect(result.current[0]!.joins[0]!.targetField).toBe('other');
});
