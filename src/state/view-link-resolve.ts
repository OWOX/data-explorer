import { PAGE_SIZE } from '../config';
import { dropOrphanHaving, type ColumnFilter } from '../filters/build';
import { keepVisible, sanitizeAggregation } from '../model/aggregation';
import type { Model, Schema } from '../model/types';
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

const clampLimit = (n: number) => Math.min(PAGE_SIZE * 10, Math.max(PAGE_SIZE, Math.round(n / PAGE_SIZE) * PAGE_SIZE));

/** Prunes the grid to the fields on offer; with no column left it opens with its defaults. */
export function pruneGrid(grid: GridState, schema: Schema, skipped: Skipped): GridState | null {
  const offered = new Set(schema.map((f) => f.name));
  const columns = grid.columns.filter((c) => offered.has(c));
  skipped.columns += grid.columns.length - columns.length;
  const filters: Record<string, ColumnFilter> = {};
  for (const [k, f] of Object.entries(grid.filters)) {
    if (offered.has(f.field)) filters[k] = f; else skipped.filters++;
  }
  // A slice needs a joined field on offer; one on a main-mart field (the backend refuses it) is skipped too. Slices are counted with the filters.
  const slices: Record<string, ColumnFilter> = {};
  for (const [k, f] of Object.entries(grid.slices ?? {})) {
    if (schema.some((x) => x.name === f.field && x.joined)) slices[k] = f; else skipped.filters++;
  }
  let sorts = grid.sorts;
  if (sorts) {
    const kept = sorts.filter((s) => offered.has(s.field));
    skipped.sorts += sorts.length - kept.length;
    // An empty list means the member chose no sort, so a list emptied by pruning goes back to the default order.
    sorts = kept.length || !sorts.length ? kept : null;
  }
  // Rules on a column that is gone are left out; every column dropped means no grid (filters and sorts were still counted above).
  // Then what the backend would refuse: a function the field does not allow, a calculated field, a bucket on a column that cannot take one.
  const agg = sanitizeAggregation(keepVisible({ aggregations: grid.aggregations ?? [], dateTrunc: grid.dateTrunc ?? [] }, columns), schema);
  skipped.aggregations += (grid.aggregations?.length ?? 0) + (grid.dateTrunc?.length ?? 0) - agg.aggregations.length - agg.dateTrunc.length;
  if (!columns.length) return null;
  // A HAVING filter whose aggregation did not survive is left out and counted with the filters.
  const havingKept = dropOrphanHaving(filters, agg.aggregations);
  skipped.filters += Object.keys(filters).length - Object.keys(havingKept).length;
  const out: GridState = { ...grid, columns, filters: havingKept, sorts };
  delete out.slices;
  if (Object.keys(slices).length) out.slices = slices;
  delete out.aggregations;
  delete out.dateTrunc;
  if (agg.aggregations.length) out.aggregations = agg.aggregations;
  if (agg.dateTrunc.length) out.dateTrunc = agg.dateTrunc;
  return out;
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
  // A link made before custom connectors were grouped by service names the connector itself: follow it to the card that now holds it.
  if (sourceKey && !model.sources.some((s) => s.key === sourceKey)) {
    const old = sourceKey.toLowerCase();
    const live = [...model.marts.values()].filter((m) => m.accessible && m.connectorName);
    // The exact spelling first, so `Shopify` and `shopify` as two connectors each find their own card.
    const found = live.find((m) => m.connectorName === sourceKey) ?? live.find((m) => m.connectorName!.toLowerCase() === old);
    if (found) sourceKey = found.sourceKey;
  }
  if (sourceKey && (!model.sources.some((s) => s.key === sourceKey) || (martId && mart!.sourceKey !== sourceKey))) {
    skipped.source = true;
    sourceKey = null;
  }

  const record = martId && view.record && typeof view.record === 'object' && !Array.isArray(view.record) ? { martId, pk: view.record } : null;
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
    grid = schema ? pruneGrid(g, schema, skipped) : g;
  }

  // A link that names found marts shows `search` only as the box's text: with none of them available to this member it would
  // be a title filter by a question, so the search is left out and the notice says a part of the link was.
  const found = (view.found ?? []).filter((id) => model.marts.get(id)?.accessible);
  const lostFound = (view.found?.length ?? 0) > 0 && found.length === 0;
  if (lostFound) skipped.found = true;

  return { apply: { selection, grid, search: lostFound ? '' : view.search, found, contextIds, storageIds, folded: view.folded }, skipped };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one-line notice for a skipped view, or null when nothing was. */
export function skippedMessage(s: Skipped): string | null {
  const items = [
    s.mart && 'the data mart',
    s.found && 'the data marts the search found',
    s.source && 'the source',
    s.columns > 0 && plural(s.columns, 'column', 'columns'),
    s.filters > 0 && plural(s.filters, 'filter', 'filters'),
    s.sorts > 0 && plural(s.sorts, 'sort', 'sorts'),
    s.aggregations > 0 && plural(s.aggregations, 'aggregation', 'aggregations'),
    s.contexts > 0 && plural(s.contexts, 'context', 'contexts'),
    s.storages > 0 && plural(s.storages, 'storage', 'storages'),
  ].filter(Boolean);
  return items.length ? `Some parts of this link aren't available to you: ${items.join(', ')}.` : null;
}
