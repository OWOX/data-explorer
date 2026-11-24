import type { Edge } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { parentPath } from '../../state/join-plan';

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

/** The Output Alias the member set on a join: a non-empty one that is not just the target mart's title (then it was never set). */
export const customOutputAlias = (outputAlias: string | undefined | null, targetTitle: string): string => {
  const shown = outputAlias?.trim() ?? '';
  return shown && shown.toLowerCase() !== targetTitle.trim().toLowerCase() ? shown : '';
};

/**
 * What hovering a line says about its relationship, or null when it has neither a name nor a description (then there is nothing to hover for).
 * The name is the join's Output Alias as typed when there is one, else the custom technical alias said in words.
 */
export function relationshipNote(edge: Pick<Edge, 'alias' | 'description'> | undefined, targetTitle: string, outputAlias?: string | null): string | null {
  const name = customOutputAlias(outputAlias, targetTitle) || (isCustomAlias(edge?.alias, targetTitle) ? aliasWords(edge!.alias!) : '');
  const about = edge?.description?.trim() ?? '';
  if (!name && !about) return null;
  return [name, about].filter(Boolean).join(': ');
}

/**
 * The Output Alias an `edge:` line is named by. It is per path, so: the source of this relationship hanging off the card the line leaves (`fromPath`);
 * else, when that card is outside the report, the band ghost's source if it belongs to this relationship (the line then reads like the ghost on the same pair);
 * else one all the sources of the relationship agree on; else none (the technical alias is said).
 */
export function edgeOutputAlias(edge: Pick<Edge, 'id'>, targetTitle: string, sources: readonly JoinedSource[], fromPath: string | undefined, bandSource: JoinedSource | undefined): string | undefined {
  const named = sources.filter((x) => x.relationshipId === edge.id);
  const here = fromPath === undefined ? undefined : named.find((x) => parentPath(x.aliasPath) === fromPath);
  if (here) return here.outputAlias;
  if (bandSource?.relationshipId === edge.id) return bandSource.outputAlias;
  return new Set(named.map((x) => customOutputAlias(x.outputAlias, targetTitle))).size === 1 ? named[0]?.outputAlias : undefined;
}
