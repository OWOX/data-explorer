import { useMemo } from 'react';
import type { Edge } from '../model/types';
import { incomingLinks, relationshipColumns } from './relationships';

/**
 * The relationships of one mart, memoised on what they say rather than on the `model.edges` array.
 * A header Refresh builds a new model with identical edges; keying on identity would re-read every
 * open record and re-run its title lookups for nothing.
 */
export function useMartRelationships(martId: string, edges: Edge[]) {
  const key = JSON.stringify(edges.filter((e) => e.source === martId || e.target === martId).map((e) => [e.id, e.source, e.target, e.joins.map((j) => [j.sourceField, j.targetField])]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ rels: relationshipColumns(martId, edges), incoming: incomingLinks(martId, edges) }), [martId, key]);
}
