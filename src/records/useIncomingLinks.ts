import { useMemo } from 'react';
import type { Edge } from '../model/types';
import { incomingLinks } from './relationships';

/**
 * The links that point at one mart, memoised on what they say rather than on the `model.edges` array.
 * A model reload builds a new model with identical edges; keying on identity would re-read every
 * open record for nothing.
 */
export function useIncomingLinks(martId: string, edges: Edge[]) {
  const key = JSON.stringify(edges.filter((e) => e.target === martId).map((e) => [e.id, e.source, e.joins.map((j) => [j.sourceField, j.targetField])]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => incomingLinks(martId, edges), [martId, key]);
}
