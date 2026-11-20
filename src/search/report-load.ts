import { PAGE_SIZE } from '../config';
import { isComplete, type ColumnFilter, type FilterValue } from '../filters/build';
import { isDateTimeField, operatorsFor, RELATIVE_PRESETS, type OpId } from '../filters/catalogue';
import { AGGREGATE_FUNCTIONS, DATE_BUCKETS, type AggFn, type AggregationRule, type DateBucket, type DateTruncRule } from '../model/aggregation';
import { isDayType } from '../model/field-category';
import type { SortKey } from '../model/sort';
import type { Field, Schema } from '../model/types';
import type { RelativeDatePreset } from '../sdk/types';
import type { GridState } from '../state/store';
import { pruneGrid, type Skipped } from '../state/view-link-resolve';
import { defaultColumns } from '../ui/explorer/useMartRows';

/** The part of `GET /api/reports/:id` the explorer reads. */
export type ReportDto = {
  id: string; title?: string;
  dataMart?: { id?: string };
  columnConfig?: string[] | null;
  filterConfig?: unknown[] | null;
  sortConfig?: { column: string; direction: 'asc' | 'desc' }[] | null;
  aggregationConfig?: { column: string; function: string }[] | null;
  dateTruncConfig?: { column: string; unit: string; timeZone?: string }[] | null;
  uniqueCountConfig?: boolean | string[] | null;
};

export type ReportSkipped = { columns: number; filters: number; sorts: number; aggregations: number; slices: number; having: number; uniqueCount: boolean };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATETIME_START = /^(\d{4}-\d{2}-\d{2}) 00:00:00$/;
const DATETIME_END = /^(\d{4}-\d{2}-\d{2}) 23:59:59$/;

function opFor(operator: string, field: Field): OpId {
  if (operator === 'relative_date') return 'relative';
  if (field.category === 'date') {
    if (operator === 'eq' && isDayType(field.type)) return 'on';
    if (operator === 'lt') return 'before';
    if (operator === 'gt') return 'after';
  }
  return operator as OpId;
}

/** A rule value in the shape the operator takes, or not ok when it has the wrong shape. */
function valueFor(kind: string, value: unknown, field: Field): { ok: true; value?: FilterValue } | { ok: false } {
  switch (kind) {
    case 'none': return { ok: true };
    case 'text':
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value: String(value) };
      return typeof value === 'string' && value !== '' ? { ok: true, value } : { ok: false };
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false };
    case 'date': return typeof value === 'string' && value !== '' ? { ok: true, value } : { ok: false };
    case 'number-range': {
      if (!isObject(value) || typeof value.from !== 'number' || typeof value.to !== 'number' || !Number.isFinite(value.from) || !Number.isFinite(value.to)) return { ok: false };
      return { ok: true, value: { from: value.from, to: value.to } };
    }
    case 'date-range': {
      if (!isObject(value) || typeof value.from !== 'string' || typeof value.to !== 'string') return { ok: false };
      let { from, to } = value as { from: string; to: string };
      const start = DATETIME_START.exec(from);
      const end = DATETIME_END.exec(to);
      if (isDateTimeField(field) && start && end) { from = start[1]!; to = end[1]!; }
      return { ok: true, value: { from, to } };
    }
    case 'relative': {
      if (!isObject(value) || typeof value.kind !== 'string' || !RELATIVE_PRESETS.some((p) => p.kind === value.kind)) return { ok: false };
      return { ok: true, value: value as RelativeDatePreset };
    }
    default: return { ok: false };
  }
}

/**
 * The inverse of `toTraverseFilter`: a report rule as a grid filter, or null when the explorer has no equivalent.
 * Slices (`placement: 'pre-join'`) and HAVING rules (`function`) are the caller's to count and are null here.
 */
export function fromTraverseFilter(rule: unknown, field: Field): ColumnFilter | null {
  if (!isObject(rule) || typeof rule.column !== 'string' || typeof rule.operator !== 'string') return null;
  if (rule.placement === 'pre-join' || rule.function) return null;
  const op = opFor(rule.operator, field);
  const def = operatorsFor(field).find((o) => o.id === op);
  if (!def) return null;
  const v = valueFor(def.value, rule.value, field);
  if (!v.ok) return null;
  const filter: ColumnFilter = v.value === undefined ? { field: field.name, op } : { field: field.name, op, value: v.value };
  return isComplete(filter, field) ? filter : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The notice for what a report carries that the explorer cannot show, or null when nothing was left out. */
export function reportSkippedMessage(s: ReportSkipped): string | null {
  const parts = [
    s.columns && plural(s.columns, 'column', 'columns'),
    s.filters && plural(s.filters, 'filter', 'filters'),
    s.sorts && plural(s.sorts, 'sort', 'sorts'),
    s.aggregations && plural(s.aggregations, 'aggregation', 'aggregations'),
    s.slices && plural(s.slices, 'slice', 'slices'),
    s.having && plural(s.having, 'HAVING filter', 'HAVING filters'),
    s.uniqueCount && 'unique count',
  ].filter(Boolean);
  return parts.length ? `Some parts of this report aren't shown: ${parts.join(', ')}.` : null;
}

/** A saved report as a grid; `grid` is null when no column survives. Pieces the explorer cannot show are counted in `skipped`. */
export function reportToGrid(report: ReportDto, schema: Schema, nativeSchema: Schema): { grid: GridState | null; skipped: ReportSkipped } {
  const skipped: ReportSkipped = { columns: 0, filters: 0, sorts: 0, aggregations: 0, slices: 0, having: 0, uniqueCount: false };
  const byName = new Map(schema.map((x) => [x.name, x]));

  const unique = report.uniqueCountConfig;
  skipped.uniqueCount = unique === true || (Array.isArray(unique) && unique.length > 0);

  const filters: Record<string, ColumnFilter> = {};
  for (const rule of asArray(report.filterConfig)) {
    if (isObject(rule) && rule.placement === 'pre-join') { skipped.slices++; continue; }
    if (isObject(rule) && rule.function) { skipped.having++; continue; }
    const field = isObject(rule) && typeof rule.column === 'string' ? byName.get(rule.column) : undefined;
    const filter = field ? fromTraverseFilter(rule, field) : null;
    if (!filter || filters[filter.field]) { skipped.filters++; continue; }
    filters[filter.field] = filter;
  }

  const sorts: SortKey[] = [];
  for (const s of asArray(report.sortConfig)) {
    if (isObject(s) && typeof s.column === 'string' && (s.direction === 'asc' || s.direction === 'desc')) sorts.push({ field: s.column, direction: s.direction });
    else skipped.sorts++;
  }

  const aggregations: AggregationRule[] = [];
  for (const a of asArray(report.aggregationConfig)) {
    if (isObject(a) && typeof a.column === 'string' && (AGGREGATE_FUNCTIONS as readonly string[]).includes(a.function as string)) aggregations.push({ column: a.column, function: a.function as AggFn });
    else skipped.aggregations++;
  }
  const dateTrunc: DateTruncRule[] = [];
  for (const d of asArray(report.dateTruncConfig)) {
    if (isObject(d) && typeof d.column === 'string' && (DATE_BUCKETS as readonly string[]).includes(d.unit as string)) {
      dateTrunc.push({ column: d.column, unit: d.unit as DateBucket, ...(typeof d.timeZone === 'string' ? { timeZone: d.timeZone } : {}) });
    } else skipped.aggregations++;
  }

  const columns = asArray(report.columnConfig).filter((c): c is string => typeof c === 'string');
  const built: GridState = {
    columns: columns.length ? columns : defaultColumns(nativeSchema),
    filters,
    sorts: sorts.length ? sorts : null,
    limit: PAGE_SIZE,
    ...(aggregations.length ? { aggregations } : {}),
    ...(dateTrunc.length ? { dateTrunc } : {}),
  };

  const pruned: Skipped = { mart: false, source: false, columns: 0, filters: 0, sorts: 0, aggregations: 0, contexts: 0, storages: 0, found: false };
  const grid = pruneGrid(built, schema, pruned);
  skipped.columns += pruned.columns;
  skipped.filters += pruned.filters;
  skipped.sorts += pruned.sorts;
  skipped.aggregations += pruned.aggregations;
  return { grid, skipped };
}
