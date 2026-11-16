import { PAGE_SIZE } from '../config';
import type { ColumnFilter } from '../filters/build';
import type { Model, Schema } from '../model/types';
import type { GridState, Selection } from './store';
import type { DecodedView } from './view-link';

export type AppliedView = {
  selection: Selection;
  grid: GridState | null;
  search: string;
  contextIds: string[];
  storageIds: string[] | null;
  folded: DecodedView['folded'];
};

export type Skipped = { mart: boolean; source: boolean; columns: number; filters: number; sorts: number; contexts: number; storages: number };

const clampLimit = (n: number) => Math.min(PAGE_SIZE * 10, Math.max(PAGE_SIZE, Math.round(n / PAGE_SIZE) * PAGE_SIZE));

/** Prunes the grid to the fields on offer; every column dropped means no grid, so it opens with its defaults. */
function pruneGrid(grid: GridState, offered: Set<string>, skipped: Skipped): GridState | null {
  const columns = grid.columns.filter((c) => offered.has(c));
  skipped.columns += grid.columns.length - columns.length;
  if (!columns.length) return null;
  const filters: Record<string, ColumnFilter> = {};
  for (const [k, f] of Object.entries(grid.filters)) {
    if (offered.has(f.field)) filters[k] = f; else skipped.filters++;
  }
  let sorts = grid.sorts;
  if (sorts) {
    const kept = sorts.filter((s) => offered.has(s.field));
    skipped.sorts += sorts.length - kept.length;
    // An empty list means the member chose no sort, so a list emptied by pruning goes back to the default order.
    sorts = kept.length || !sorts.length ? kept : null;
  }
  return { ...grid, columns, filters, sorts };
}

/** Checks a decoded view against what this member can see. Never throws; what can't be shown is counted in `skipped`. */
export async function resolveView(
  view: DecodedView,
  model: Model,
  readGrid: (martId: string) => Promise<Schema | null>,
): Promise<{ apply: AppliedView; skipped: Skipped }> {
  // Entries the codec dropped are counted under columns, whatever they were.
  const skipped: Skipped = { mart: false, source: false, columns: view.dropped, filters: 0, sorts: 0, contexts: 0, storages: 0 };

  const mart = view.martId ? model.marts.get(view.martId) : undefined;
  const martId = mart?.accessible ? mart.id : null;
  if (view.martId && !martId) skipped.mart = true;

  let sourceKey = view.sourceKey;
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
    grid = schema ? pruneGrid(g, new Set(schema.map((f) => f.name)), skipped) : g;
  }

  return { apply: { selection, grid, search: view.search, contextIds, storageIds, folded: view.folded }, skipped };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one-line notice for a skipped view, or null when nothing was. */
export function skippedMessage(s: Skipped): string | null {
  const items = [
    s.mart && 'the data mart',
    s.source && 'the source',
    s.columns > 0 && plural(s.columns, 'column', 'columns'),
    s.filters > 0 && plural(s.filters, 'filter', 'filters'),
    s.sorts > 0 && plural(s.sorts, 'sort', 'sorts'),
    s.contexts > 0 && plural(s.contexts, 'context', 'contexts'),
    s.storages > 0 && plural(s.storages, 'storage', 'storages'),
  ].filter(Boolean);
  return items.length ? `Some parts of this link aren't available to you: ${items.join(', ')}.` : null;
}
