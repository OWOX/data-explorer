// A data mart's Unique Count in the Data grid: the number of its distinct records, counted by its primary key. It is a metric of the mart, not of a column.
import { hasPrimaryKey } from '../records/relationships';
import type { Field, Schema } from './types';

export const UNIQUE_COUNT_LABEL = 'Unique Count';

/** The row key of a mart's unique count (the backend's contract: each dot of the alias path becomes `_`). '' is the main mart. */
export const uniqueKey = (aliasPath: string): string => (aliasPath === '' ? UNIQUE_COUNT_LABEL : `${aliasPath.replaceAll('.', '_')}__unique_count`);

/** The alias paths whose Unique Count works: the main mart when it has a primary key (a hidden or composite one counts), a joined mart when the backend says so. */
export const uniquePathsOf = (schema: Schema): string[] => [...(hasPrimaryKey(schema) ? [''] : []), ...(schema.joinedUniqueCount ?? [])];

/** The paths that stay on: available, and (for a joined mart) with a column of its own on the grid. First occurrence wins, main first. */
export function keepUnique(paths: readonly string[] | undefined, schema: Schema, columns: readonly string[]): string[] {
  if (!paths?.length) return [];
  const offered = new Set(uniquePathsOf(schema));
  const shown = new Set(columns);
  const onGrid = (path: string) => path === '' || schema.some((f) => f.joined?.aliasPath === path && shown.has(f.name));
  const kept = [...new Set(paths)].filter((p) => offered.has(p) && onGrid(p));
  return kept.includes('') ? ['', ...kept.filter((p) => p !== '')] : kept;
}

/** A stand-in field for the metric's column, so a header, a sort and a group read it like any other column. Read-only: no function, no filter. */
export const uniqueField = (path: string, joined?: { martId: string; label: string }): Field => ({
  name: uniqueKey(path), alias: UNIQUE_COUNT_LABEL, type: 'INTEGER', category: 'number', description: null, isPrimaryKey: false, isCalculated: true,
  ...(path ? { joined: { martId: joined?.martId ?? '', label: joined?.label ?? '', aliasPath: path } } : {}),
});
