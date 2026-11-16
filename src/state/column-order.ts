import type { JoinedSource } from '../api/blendable';

/**
 * The columns of a grid with every data mart's together: the main mart's own columns first (in their order), then each joined
 * mart's in the order the marts first appear (the order they were added), each group keeping its fields' order.
 * `fallbackOwn` (the main mart's default columns) leads a list that has joined columns and none of the main mart's own.
 */
export function orderColumns(columns: string[], sources: JoinedSource[], fallbackOwn: string[] = []): string[] {
  const owner = new Map<string, string>();
  for (const s of sources) for (const f of s.fields) if (!owner.has(f.name)) owner.set(f.name, s.martId);
  const own: string[] = [];
  const groups = new Map<string, string[]>();
  for (const c of columns) {
    const id = owner.get(c);
    if (!id) own.push(c);
    else if (groups.has(id)) groups.get(id)!.push(c);
    else groups.set(id, [c]);
  }
  // The first data mart is always the main one: a list that has joined columns and none of its own gets the mart's default columns first.
  return [...(own.length === 0 && groups.size > 0 ? fallbackOwn : own), ...[...groups.values()].flat()];
}
