import { PAGE_SIZE } from '../config';
import { dropOrphanHaving, type ColumnFilter } from '../filters/build';
import { keepVisible, sanitizeAggregation } from '../model/aggregation';
import { keptSorts } from '../model/sort';
import { keepEmpty } from '../model/empty-paths';
import type { Model, Schema } from '../model/types';
import { keepUnique, uniqueKey } from '../model/unique-count';
import { count } from '../ui/format';
import type { GridState, Selection } from './store';
import type { DecodedView } from './view-link';

export type AppliedView = {
  selection: Selection;
  grid: GridState | null;
  search: string;
  found: string[];
  contextIds: string[];
  storageIds: string[] | null;
  folded: DecodedView['folded'];
};

export type Skipped = { mart: boolean; source: boolean; columns: number; filters: number; sorts: number; aggregations: number; contexts: number; storages: number; /** The link names marts a search found and none of them is available. */ found: boolean };

/** What pruning a grid to a schema left out, counted. */
export type Dropped = Pick<Skipped, 'columns' | 'filters' | 'sorts' | 'aggregations'> & { /** Unique Counts left out: the mart offers no such metric now, or has no column on the grid. Callers count them with the aggregations, or on their own. */ uniqueCount: number };

export const clampLimit = (n: number) => Math.min(PAGE_SIZE * 10, Math.max(PAGE_SIZE, Math.round(n / PAGE_SIZE) * PAGE_SIZE));

/** Prunes the grid to the fields on offer; with no column left it opens with its defaults. */
export function pruneGrid(grid: GridState, schema: Schema): { grid: GridState | null; dropped: Dropped } {
  const dropped: Dropped = { columns: 0, filters: 0, sorts: 0, aggregations: 0, uniqueCount: 0 };
  const offered = new Set(schema.map((f) => f.name));
  const columns = grid.columns.filter((c) => offered.has(c));
  dropped.columns += grid.columns.length - columns.length;
  const filters: Record<string, ColumnFilter> = {};
  for (const [k, f] of Object.entries(grid.filters)) {
    if (offered.has(f.field)) filters[k] = f; else dropped.filters++;
  }
  // A slice needs a joined field on offer; one on a main-mart field (the backend refuses it) is skipped too. Slices are counted with the filters.
  const slices: Record<string, ColumnFilter> = {};
  for (const [k, f] of Object.entries(grid.slices ?? {})) {
    if (schema.some((x) => x.name === f.field && x.joined)) slices[k] = f; else dropped.filters++;
  }
  // A Unique Count whose metric is not offered (no usable key, a joined mart that is gone or not on the grid) is left out and counted.
  const uniqueCount = keepUnique(grid.uniqueCount, schema, columns);
  dropped.uniqueCount += (grid.uniqueCount?.length ?? 0) - uniqueCount.length;
  // An empty path the mart no longer joins by, or that now has a column, is left out and counted with the columns.
  const emptyPaths = keepEmpty(grid.emptyPaths, schema, columns);
  dropped.columns += (grid.emptyPaths?.length ?? 0) - emptyPaths.length;
  // The metric's column can be sorted by its row key.
  const metricKeys = new Set(uniqueCount.map(uniqueKey));
  let sorts = grid.sorts;
  if (sorts) {
    const kept = sorts.filter((s) => offered.has(s.field) || metricKeys.has(s.field));
    dropped.sorts += sorts.length - kept.length;
    // An empty list means the member chose no sort, so a list emptied by pruning goes back to the default order.
    sorts = keptSorts(sorts, kept);
  }
  // Rules on a column that is gone are left out; every column dropped means no grid (filters and sorts were still counted above).
  // Then what the backend would refuse: a function the field does not allow, a calculated field, a bucket on a column that cannot take one.
  const agg = sanitizeAggregation(keepVisible({ aggregations: grid.aggregations ?? [], dateTrunc: grid.dateTrunc ?? [] }, columns), schema);
  dropped.aggregations += (grid.aggregations?.length ?? 0) + (grid.dateTrunc?.length ?? 0) - agg.aggregations.length - agg.dateTrunc.length;
  if (!columns.length) return { grid: null, dropped };
  // A HAVING filter whose aggregation did not survive is left out and counted with the filters.
  const havingKept = dropOrphanHaving(filters, agg.aggregations);
  dropped.filters += Object.keys(filters).length - Object.keys(havingKept).length;
  const out: GridState = { ...grid, columns, filters: havingKept, sorts };
  delete out.slices;
  if (Object.keys(slices).length) out.slices = slices;
  delete out.aggregations;
  delete out.dateTrunc;
  if (agg.aggregations.length) out.aggregations = agg.aggregations;
  if (agg.dateTrunc.length) out.dateTrunc = agg.dateTrunc;
  delete out.uniqueCount;
  if (uniqueCount.length) out.uniqueCount = uniqueCount;
  delete out.emptyPaths;
  if (emptyPaths.length) out.emptyPaths = emptyPaths;
  return { grid: out, dropped };
}

/** Checks a decoded view against what this member can see. Never throws; what can't be shown is counted in `skipped`. */
export async function resolveView(
  view: DecodedView,
  model: Model,
  readGrid: (martId: string) => Promise<Schema | null>,
): Promise<{ apply: AppliedView; skipped: Skipped }> {
  // Entries the codec dropped are counted under columns, whatever they were.
  const skipped: Skipped = { mart: false, source: false, columns: view.dropped, filters: 0, sorts: 0, aggregations: view.droppedAggregations, contexts: 0, storages: 0, found: false };

  const mart = view.martId ? model.marts.get(view.martId) : undefined;
  const martId = mart?.accessible ? mart.id : null;
  if (view.martId && !martId) skipped.mart = true;

  let sourceKey = view.sourceKey;
  if (sourceKey && (!model.sources.some((s) => s.key === sourceKey) || (martId && mart!.sourceKey !== sourceKey))) {
    skipped.source = true;
    sourceKey = null;
  }

  const record = martId && view.record ? { martId, pk: view.record } : null;
  const selection: Selection = { sourceKey, martId, record };

  const contextIds = view.contextIds.filter((id) => model.contexts.some((c) => c.id === id));
  skipped.contexts = view.contextIds.length - contextIds.length;

  let storageIds: string[] | null = null;
  if (view.storageIds) {
    storageIds = view.storageIds.filter((id) => model.storages.some((s) => s.id === id));
    skipped.storages = view.storageIds.length - storageIds.length;
    if (!storageIds.length) storageIds = null;
  }

  let grid: GridState | null = null;
  if (martId && view.grid) {
    const g = { ...view.grid, limit: clampLimit(view.grid.limit) };
    const schema = await readGrid(martId).catch(() => null);
    if (schema) {
      const pruned = pruneGrid(g, schema);
      grid = pruned.grid;
      skipped.columns += pruned.dropped.columns;
      skipped.filters += pruned.dropped.filters;
      skipped.sorts += pruned.dropped.sorts;
      skipped.aggregations += pruned.dropped.aggregations + pruned.dropped.uniqueCount;
    } else grid = g;
  }

  // A link that names found marts shows `search` only as the box's text: with none of them available to this member it would
  // be a title filter by a question, so the search is left out and the notice says a part of the link was.
  const found = (view.found ?? []).filter((id) => model.marts.get(id)?.accessible);
  const lostFound = (view.found?.length ?? 0) > 0 && found.length === 0;
  if (lostFound) skipped.found = true;

  return { apply: { selection, grid, search: lostFound ? '' : view.search, found, contextIds, storageIds, folded: view.folded }, skipped };
}

/** The one-line notice for a skipped view, or null when nothing was. */
export function skippedMessage(s: Skipped): string | null {
  const items = [
    s.mart && 'the data mart',
    s.found && 'the data marts the search found',
    s.source && 'the source',
    s.columns > 0 && count(s.columns, 'column'),
    s.filters > 0 && count(s.filters, 'filter'),
    s.sorts > 0 && count(s.sorts, 'sort'),
    s.aggregations > 0 && count(s.aggregations, 'aggregation'),
    s.contexts > 0 && count(s.contexts, 'context'),
    s.storages > 0 && count(s.storages, 'storage'),
  ].filter(Boolean);
  return items.length ? `Some parts of this link aren't available to you: ${items.join(', ')}.` : null;
}
