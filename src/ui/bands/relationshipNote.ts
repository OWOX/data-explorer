import type { Edge } from '../../model/types';

/** Words that stay upper-case when an alias is said in words. */
const ACRONYMS = new Set(['id', 'mql', 'sql', 'sal', 'url', 'utm', 'crm', 'ltv', 'cac', 'roi', 'api', 'ip', 'sku', 'uk', 'us', 'eu']);

/** An alias said in words: "last_session_before_mql" -> "Last session before MQL". */
export function aliasWords(alias: string): string {
  const words = alias.split(/[_\s-]+/).filter(Boolean).map((w) => w.toLowerCase());
  return words.map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

/** A title as an alias looks: lower-case words joined with underscores. The default alias of a relationship is its target mart's title this way. */
const slugOf = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** A name the member gave the relationship: an alias that is not just the target mart's title as an alias. */
export const isCustomAlias = (alias: string | undefined, targetTitle: string): boolean => !!alias?.trim() && slugOf(alias) !== slugOf(targetTitle);

/**
 * The relationship a line stands for: the one the joined source names (`relationshipId`) when it is among the edges from `parent` to `target`,
 * else the one whose alias ends the alias path, else the only one there is. Null when several fit and nothing tells them apart.
 */
export function edgeOf(edges: readonly Edge[], parent: string, target: string, path: string, relationshipId?: string): Edge | undefined {
  const between = edges.filter((e) => e.source === parent && e.target === target);
  const named = relationshipId ? between.find((e) => e.id === relationshipId) : undefined;
  const last = path.slice(path.lastIndexOf('.') + 1);
  return named ?? between.find((e) => e.alias !== undefined && e.alias === last) ?? (between.length === 1 ? between[0] : undefined);
}

/** What hovering a line says about its relationship, or null when it has neither a custom name nor a description (then there is nothing to hover for). */
export function relationshipNote(edge: Pick<Edge, 'alias' | 'description'> | undefined, targetTitle: string): string | null {
  const name = isCustomAlias(edge?.alias, targetTitle) ? aliasWords(edge!.alias!) : '';
  const about = edge?.description?.trim() ?? '';
  if (!name && !about) return null;
  return [name, about].filter(Boolean).join(': ');
}
