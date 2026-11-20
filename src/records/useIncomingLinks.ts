import { useState } from 'react';
import type { Edge } from '../model/types';
import { incomingLinks, type IncomingLink } from './relationships';

const sameJoins = (a: Edge['joins'], b: Edge['joins']) => a.length === b.length && a.every((j, i) => j.sourceField === b[i]!.sourceField && j.targetField === b[i]!.targetField);
const sameEdges = (a: Edge[], b: Edge[]) => a.length === b.length && a.every((e, i) => e.id === b[i]!.id && e.source === b[i]!.source && sameJoins(e.joins, b[i]!.joins));

/**
 * The links that point at one mart, kept while what they say is unchanged rather than while the `model.edges` array is.
 * A model reload builds a new model with identical edges; keying on identity would re-read every
 * open record for nothing.
 */
export function useIncomingLinks(martId: string, edges: Edge[]): IncomingLink[] {
  const pointing = edges.filter((e) => e.target === martId);
  const [kept, setKept] = useState(() => ({ martId, pointing, links: incomingLinks(martId, edges) }));
  if (kept.martId === martId && sameEdges(kept.pointing, pointing)) return kept.links;
  const next = { martId, pointing, links: incomingLinks(martId, edges) };
  setKept(next);
  return next.links;
}
