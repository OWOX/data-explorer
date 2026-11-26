// A joined data mart kept in the report with no column: its alias path is in `GridState.emptyPaths`.
import type { Schema } from './types';

/** The paths that stay empty: some schema field is joined by the path, and no column of the grid is. First occurrence wins; '' (the main mart) never stays. */
export function keepEmpty(paths: readonly string[] | undefined, schema: Schema, columns: readonly string[]): string[] {
  if (!paths?.length) return [];
  const shown = new Set(columns);
  const offered = (path: string) => path !== '' && schema.some((f) => f.joined?.aliasPath === path);
  const onGrid = (path: string) => schema.some((f) => f.joined?.aliasPath === path && shown.has(f.name));
  return [...new Set(paths)].filter((p) => offered(p) && !onGrid(p));
}
