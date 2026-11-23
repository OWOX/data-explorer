import { sourceOfField, type JoinedSource } from '../api/blendable';

/**
 * The columns of a grid with every data mart's together: the main mart's own columns first (in their order), then each joined
 * path's (one group per alias path, so a mart joined under two parents is two groups) in the order the paths first appear (the order they were added), each group keeping its fields' order.
 * `fallbackOwn` (the main mart's default columns) leads a list that has joined columns and none of the main mart's own.
 */
export function orderColumns(columns: string[], sources: JoinedSource[], fallbackOwn: string[] = []): string[] {
  const owner = sourceOfField(sources);
  const own: string[] = [];
  const groups = new Map<string, string[]>();
  for (const c of columns) {
    const id = owner.get(c)?.aliasPath;
    if (id === undefined) own.push(c);
    else if (groups.has(id)) groups.get(id)!.push(c);
    else groups.set(id, [c]);
  }
  // The first data mart is always the main one: a list that has joined columns and none of its own gets the mart's default columns first.
  return [...(own.length === 0 && groups.size > 0 ? fallbackOwn : own), ...[...groups.values()].flat()];
}

/** The group a column belongs to: its alias path, or '' for the main mart's own columns (so a mart joined under two parents is two groups). */
export function groupMap(sources: JoinedSource[]): (name: string) => string {
  const owner = sourceOfField(sources);
  return (name) => owner.get(name)?.aliasPath ?? '';
}

/**
 * Moves `name` to just before `before` (`null`: to the end of its data mart's group). A column never leaves its group, so a `before` from
 * another mart is refused. A refused or no-op move returns the same array, so callers can tell nothing changed by identity.
 */
export function moveColumn(columns: string[], name: string, before: string | null, sources: JoinedSource[]): string[] {
  const at = columns.indexOf(name);
  if (at < 0 || before === name) return columns;
  const group = groupMap(sources);
  if (before !== null && (!columns.includes(before) || group(before) !== group(name))) return columns;
  const rest = columns.filter((c) => c !== name);
  let to = at;
  if (before !== null) to = rest.indexOf(before);
  else {
    const last = rest.reduce((end, c, i) => (group(c) === group(name) ? i : end), -1);
    if (last >= 0) to = last + 1;
  }
  const next = [...rest.slice(0, to), name, ...rest.slice(to)];
  return next.every((c, i) => c === columns[i]) ? columns : next;
}

/** One step left (-1) or right (1) among the columns of the same data mart; the same array at the group's edge. */
export function moveColumnBy(columns: string[], name: string, dir: -1 | 1, sources: JoinedSource[]): string[] {
  const group = groupMap(sources);
  const mine = columns.filter((c) => group(c) === group(name));
  const i = mine.indexOf(name);
  if (i < 0) return columns;
  if (dir < 0) return i === 0 ? columns : moveColumn(columns, name, mine[i - 1]!, sources);
  return i === mine.length - 1 ? columns : moveColumn(columns, name, mine[i + 2] ?? null, sources);
}

/**
 * The main mart's own columns that stay (`keep`), in the order they have on the grid, with each newly kept one placed right after the
 * nearest field before it in the schema that is shown, or first when none is. So a grid that was never reordered stays in schema order.
 * Ticking a field in the Fields list and picking Aggregate, Sort or Format on a hidden field both place the column this way.
 */
export function ownInSchemaOrder(visible: string[], schema: string[], keep: Set<string>): string[] {
  const mine = new Set(schema);
  const shown = new Set(visible);
  const own = visible.filter((c) => mine.has(c) && keep.has(c));
  for (const n of schema.filter((x) => keep.has(x) && !shown.has(x))) {
    let at = 0;
    for (let j = schema.indexOf(n) - 1; j >= 0; j--) {
      const k = own.indexOf(schema[j]!);
      if (k >= 0) { at = k + 1; break; }
    }
    own.splice(at, 0, n);
  }
  return own;
}
