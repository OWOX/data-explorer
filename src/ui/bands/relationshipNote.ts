import type { Edge } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { parentPath } from '../../state/join-plan';

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
 * The Output Alias of the join at `path` under the card at `parentPath`: the main mart's own setting when it gives one,
 * else, under a joined mart, that mart's own setting for the rest of the path (`own`).
 */
export function joinAlias(outputAlias: string | undefined | null, targetTitle: string, parentMartId: string, parentPath: string, path: string, own: (martId: string, path: string) => string | undefined): string | undefined {
  const main = customOutputAlias(outputAlias, targetTitle);
  if (main || parentPath === '' || !path.startsWith(`${parentPath}.`)) return main || undefined;
  return own(parentMartId, path.slice(parentPath.length + 1));
}

/** What a relationship line says: its Output Alias, and its description behind "More". */
export type RelationshipNote = {
  /** The join's Output Alias: the one the member set, else the target mart's title (the alias a join has until one is set). */
  name: string;
  about?: string;
  /** The member named the join or described it: the line has a dot to hover. */
  marked: boolean;
};

/** What hovering a line says about its relationship. The technical alias is never said: the Output Alias is the join's name. */
export function relationshipNote(edge: Pick<Edge, 'description'> | undefined, targetTitle: string, outputAlias?: string | null): RelationshipNote {
  const custom = customOutputAlias(outputAlias, targetTitle);
  const about = edge?.description?.trim() ?? '';
  return { name: custom || targetTitle, ...(about ? { about } : {}), marked: !!custom || !!about };
}

/** A line's tooltip fields on a wire: the name always, the note and the description when the member gave them. */
export const noteFields = (n: RelationshipNote) => ({ title: n.name, ...(n.marked ? { note: n.name } : {}), ...(n.about ? { about: n.about } : {}) });

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
