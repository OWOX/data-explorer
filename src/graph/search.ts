import type { Mart } from '../model/types';

/** The search matches the data mart's title and nothing else. */
export function matchesSearch(mart: Mart, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || mart.title.toLowerCase().includes(q);
}
