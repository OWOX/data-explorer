import { PAGE_SIZE } from '../config';
import { havingField, sliceField } from '../filters/slice';
import { isComplete, type ColumnFilter, type FilterValue } from '../filters/build';
import { isDateTimeField, operatorsFor, RELATIVE_PRESETS, type OpId } from '../filters/catalogue';
import { isAggFn, isDateBucket, isTimeZone, type AggregationRule, type DateTruncRule } from '../model/aggregation';
import { isRecord } from '../model/guards';
import { isDayType } from '../model/field-category';
import type { SortKey } from '../model/sort';
import type { Field, Schema } from '../model/types';
import type { RelativeDatePreset, ReportDto } from '../sdk/types';
import type { GridState } from '../state/store';
import { plural, pruneGrid } from '../state/view-link-resolve';
import { defaultColumns } from '../model/columns';

export type { ReportDto };
export type ReportSkipped = { columns: number; filters: number; sorts: number; aggregations: number; slices: number; having: number; uniqueCount: boolean };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const DATETIME_START = /^(\d{4}-\d{2}-\d{2}) 00:00:00$/;
const DATETIME_END = /^(\d{4}-\d{2}-\d{2}) 23:59:59$/;

function opFor(operator: string, field: Field): OpId {
  if (operator === 'relative_date') return 'relative';
  if (field.category === 'date' || field.category === 'time') {
    if (operator === 'eq' && field.category === 'date' && isDayType(field.type)) return 'on';
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
      if (!isRecord(value) || typeof value.from !== 'number' || typeof value.to !== 'number' || !Number.isFinite(value.from) || !Number.isFinite(value.to)) return { ok: false };
      return { ok: true, value: { from: value.from, to: value.to } };
    }
    case 'date-range': {
      if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string') return { ok: false };
      let { from, to } = value as { from: string; to: string };
      const start = DATETIME_START.exec(from);
      const end = DATETIME_END.exec(to);
      if (isDateTimeField(field) && start && end) { from = start[1]!; to = end[1]!; }
      return { ok: true, value: { from, to } };
    }
    case 'relative': {
      if (!isRecord(value) || typeof value.kind !== 'string' || !RELATIVE_PRESETS.some((p) => p.kind === value.kind)) return { ok: false };
      return { ok: true, value: { kind: value.kind, ...(typeof value.n === 'number' ? { n: value.n } : {}) } as RelativeDatePreset };
    }
    default: return { ok: false };
  }
}

/**
 * The inverse of `toTraverseFilter`: a report rule as a grid filter, or null when the explorer has no equivalent.
 * The caller picks the field to read the rule against: `sliceField` for a slice, `havingField` for a HAVING rule.
 */
export function fromTraverseFilter(rule: unknown, field: Field): ColumnFilter | null {
  if (!isRecord(rule) || typeof rule.column !== 'string' || typeof rule.operator !== 'string') return null;
  const op = opFor(rule.operator, field);
  const def = operatorsFor(field).find((o) => o.id === op);
  if (!def) return null;
  const v = valueFor(def.value, rule.value, field);
  if (!v.ok) return null;
  const filter: ColumnFilter = v.value === undefined ? { field: field.name, op } : { field: field.name, op, value: v.value };
  return isComplete(filter, field) ? filter : null;
}

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

  // HAVING rules are read only against an aggregation the report carries, so those are collected first.
  const aggFns = new Set<string>();
  for (const a of asArray(report.aggregationConfig)) if (isRecord(a) && typeof a.column === 'string' && typeof a.function === 'string') aggFns.add(`${a.column}\u0000${a.function}`);

  const filters: Record<string, ColumnFilter> = {};
  const slices: Record<string, ColumnFilter> = {};
  for (const rule of asArray(report.filterConfig)) {
    const field = isRecord(rule) && typeof rule.column === 'string' ? byName.get(rule.column) : undefined;
    if (isRecord(rule) && rule.function) {
      const fn = isAggFn(rule.function) ? rule.function : null;
      const filter = field && fn && aggFns.has(`${field.name}\u0000${fn}`) && rule.placement !== 'pre-join' ? fromTraverseFilter(rule, havingField(field, fn)) : null;
      if (!fn || !filter || Object.hasOwn(filters, filter.field)) { skipped.having++; continue; }
      filters[filter.field] = { ...filter, fn };
      continue;
    }
    if (isRecord(rule) && rule.placement === 'pre-join') {
      const filter = field?.joined ? fromTraverseFilter(rule, sliceField(field)) : null;
      if (!filter || Object.hasOwn(slices, filter.field)) { skipped.slices++; continue; }
      slices[filter.field] = filter;
      continue;
    }
    const filter = field ? fromTraverseFilter(rule, field) : null;
    if (!filter || Object.hasOwn(filters, filter.field)) { skipped.filters++; continue; }
    filters[filter.field] = filter;
  }

  const sorts: SortKey[] = [];
  const sorted = new Set<string>();
  for (const s of asArray(report.sortConfig)) {
    if (isRecord(s) && typeof s.column === 'string' && (s.direction === 'asc' || s.direction === 'desc')) {
      if (sorted.has(s.column)) { skipped.sorts++; continue; }
      sorted.add(s.column);
      sorts.push({ field: s.column, direction: s.direction });
    } else skipped.sorts++;
  }

  const aggregations: AggregationRule[] = [];
  for (const a of asArray(report.aggregationConfig)) {
    if (isRecord(a) && typeof a.column === 'string' && isAggFn(a.function)) aggregations.push({ column: a.column, function: a.function });
    else skipped.aggregations++;
  }
  const dateTrunc: DateTruncRule[] = [];
  for (const d of asArray(report.dateTruncConfig)) {
    if (isRecord(d) && typeof d.column === 'string' && isDateBucket(d.unit)) {
      dateTrunc.push({ column: d.column, unit: d.unit, ...(isTimeZone(d.timeZone) ? { timeZone: d.timeZone } : {}) });
    } else skipped.aggregations++;
  }

  const columns = asArray(report.columnConfig).filter((c): c is string => typeof c === 'string');
  const built: GridState = {
    columns: columns.length ? columns : defaultColumns(nativeSchema),
    filters,
    ...(Object.keys(slices).length ? { slices } : {}),
    sorts: sorts.length ? sorts : null,
    limit: PAGE_SIZE,
    ...(aggregations.length ? { aggregations } : {}),
    ...(dateTrunc.length ? { dateTrunc } : {}),
  };

  const { grid, dropped } = pruneGrid(built, schema);
  skipped.columns += dropped.columns;
  skipped.filters += dropped.filters;
  skipped.sorts += dropped.sorts;
  skipped.aggregations += dropped.aggregations;
  return { grid, skipped };
}
