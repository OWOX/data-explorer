import type { Mart } from '../model/types';

/** Any selected context matches; none selected matches every mart. */
export function matchesContexts(mart: Mart, contextIds: string[]): boolean {
  return contextIds.length === 0 || mart.contextIds.some((c) => contextIds.includes(c));
}

/** The search matches the data mart's title and nothing else. */
export function matchesSearch(mart: Mart, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || mart.title.toLowerCase().includes(q);
}
