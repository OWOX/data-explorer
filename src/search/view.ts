import { PAGE_SIZE } from '../config';
import type { ColumnFilter, FilterValue } from '../filters/build';
import { isComplete } from '../filters/build';
import { operatorsFor, RELATIVE_MAX_N, RELATIVE_PRESETS, type OpDef } from '../filters/catalogue';
import { AGGREGATE_FUNCTIONS, DATE_BUCKETS, type AggFn, type AggregationRule, type DateBucket, type DateTruncRule } from '../model/aggregation';
import type { SortKey } from '../model/sort';
import type { Schema } from '../model/types';
import type { GridState } from '../state/store';
import { pruneGrid, type Skipped } from '../state/view-link-resolve';
import { defaultColumns } from '../ui/explorer/useMartRows';

const MAX_COLUMNS = 50;
const MAX_FILTERS = 20;
const MAX_SORTS = 5;
const MAX_RULES = 20;
const MAX_TEXT = 500;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

const numeric = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const DATE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+)?(Z|[+-]\d{2}:?\d{2})?$/;
const dateText = (v: unknown): string | undefined => (typeof v === 'string' && DATE.test(v.trim()) ? v.trim() : undefined);
const text = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_TEXT) : undefined;
};

function relative(v: unknown): FilterValue | undefined {
  if (!isRecord(v)) return undefined;
  const kind = own(v, 'kind');
  const preset = RELATIVE_PRESETS.find((p) => p.kind === kind);
  if (!preset) return undefined;
  if (!preset.needsN) return { kind: preset.kind } as FilterValue;
  const n = own(v, 'n');
  return Number.isInteger(n) && (n as number) > 0 && (n as number) <= RELATIVE_MAX_N ? ({ kind: preset.kind, n } as FilterValue) : undefined;
}

function range(v: unknown, one: (x: unknown) => string | number | undefined): FilterValue | undefined {
  if (!isRecord(v)) return undefined;
  const from = one(own(v, 'from'));
  const to = one(own(v, 'to'));
  return from === undefined || to === undefined ? undefined : { from, to };
}

/** The value an operator takes, rebuilt from what the model wrote: only the shape the filter popover would have produced. */
function valueFor(def: OpDef, raw: unknown): { ok: boolean; value?: FilterValue } {
  switch (def.value) {
    case 'none': return { ok: true };
    case 'text': { const v = text(raw); return { ok: v !== undefined, value: v }; }
    case 'number': { const v = numeric(raw); return { ok: v !== undefined, value: v }; }
    case 'date': { const v = dateText(raw); return { ok: v !== undefined, value: v }; }
    case 'number-range': { const v = range(raw, numeric); return { ok: v !== undefined, value: v }; }
    case 'date-range': { const v = range(raw, dateText); return { ok: v !== undefined, value: v }; }
    case 'relative': { const v = relative(raw); return { ok: v !== undefined, value: v }; }
  }
}

export type AiFields = { columns: string[]; aggregations: AggregationRule[]; dateTrunc: DateTruncRule[] };
export type AiFilters = { filters: Record<string, ColumnFilter>; sorts: SortKey[] };

/**
 * Turns the model's columns, aggregations and date buckets into rules, or null when there is nothing to apply. Never throws and
 * trusts nothing: every name must be in the schema, every function one the aggregation catalogue knows.
 */
export function parseAiFields(raw: unknown, schema: Schema): AiFields | null {
  if (!isRecord(raw)) return null;
  const byName = new Map(schema.map((f) => [f.name, f]));
  const known = (v: unknown): v is string => typeof v === 'string' && byName.has(v);

  const columns = [...new Set(list(raw.columns, MAX_COLUMNS * 4).filter(known))].slice(0, MAX_COLUMNS);

  const aggregations: AggregationRule[] = [];
  for (const item of list(raw.aggregations, MAX_RULES)) {
    if (!isRecord(item)) continue;
    const column = own(item, 'column');
    const fn = own(item, 'function');
    if (!known(column) || !(AGGREGATE_FUNCTIONS as readonly unknown[]).includes(fn) || aggregations.some((r) => r.column === column && r.function === fn)) continue;
    aggregations.push({ column, function: fn as AggFn });
  }
  const dateTrunc: DateTruncRule[] = [];
  for (const item of list(raw.dateTrunc, MAX_RULES)) {
    if (!isRecord(item)) continue;
    const column = own(item, 'column');
    const unit = own(item, 'unit');
    if (!known(column) || !(DATE_BUCKETS as readonly unknown[]).includes(unit) || dateTrunc.some((r) => r.column === column)) continue;
    dateTrunc.push({ column, unit: unit as DateBucket });
  }
  return columns.length || aggregations.length || dateTrunc.length ? { columns, aggregations, dateTrunc } : null;
}

/**
 * Turns the model's filters and sorts into rules. Every field must be in the schema, every operator one the field's filter offers,
 * every value of the shape that operator takes. Sorts may name only the shown columns, which are the default columns when none were chosen.
 */
export function parseAiFilters(raw: unknown, schema: Schema, columns: string[]): AiFilters {
  const out: AiFilters = { filters: {}, sorts: [] };
  if (!isRecord(raw)) return out;
  const byName = new Map(schema.map((f) => [f.name, f]));
  const known = (v: unknown): v is string => typeof v === 'string' && byName.has(v);

  for (const item of list(raw.filters, MAX_FILTERS)) {
    if (!isRecord(item)) continue;
    const field = own(item, 'field');
    if (!known(field) || own(out.filters, field)) continue;
    const def = operatorsFor(byName.get(field)!).find((o) => o.id === own(item, 'op'));
    if (!def) continue;
    const v = valueFor(def, own(item, 'value'));
    if (!v.ok) continue;
    const filter: ColumnFilter = v.value === undefined ? { field, op: def.id } : { field, op: def.id, value: v.value };
    if (isComplete(filter, byName.get(field)!)) out.filters[field] = filter;
  }

  const shown = columns.length ? columns : defaultColumns(schema);
  for (const item of list(raw.sorts, MAX_SORTS * 2)) {
    if (!isRecord(item)) continue;
    const field = own(item, 'field');
    const direction = own(item, 'direction');
    if (!known(field) || !shown.includes(field) || (direction !== 'asc' && direction !== 'desc') || out.sorts.some((s) => s.field === field)) continue;
    out.sorts.push({ field, direction });
    if (out.sorts.length === MAX_SORTS) break;
  }
  return out;
}

/**
 * Puts the two answers into one grid, through the same pruning a view link gets, so a function a field does not allow is dropped there.
 * Null when neither answer has anything to apply. Without chosen columns the grid shows the default ones.
 */
export function mergeAiView(schema: Schema, fields: AiFields | null, filters: AiFilters | null): GridState | null {
  const filterMap = filters?.filters ?? {};
  const sorts = filters?.sorts ?? [];
  const aggregations = fields?.aggregations ?? [];
  const dateTrunc = fields?.dateTrunc ?? [];
  const chosen = fields?.columns ?? [];
  if (!chosen.length && !Object.keys(filterMap).length && !sorts.length && !aggregations.length && !dateTrunc.length) return null;
  // The AI view never sets slices: the grid state keeps `slices` absent.
  const grid: GridState = {
    columns: chosen.length ? chosen : defaultColumns(schema),
    filters: filterMap,
    sorts: sorts.length ? sorts : null,
    limit: PAGE_SIZE,
    ...(aggregations.length ? { aggregations } : {}),
    ...(dateTrunc.length ? { dateTrunc } : {}),
  };
  const skipped: Skipped = { mart: false, source: false, columns: 0, filters: 0, sorts: 0, aggregations: 0, contexts: 0, storages: 0, found: false };
  return pruneGrid(grid, schema, skipped);
}
