import type { Field, Schema } from '../model/types';
import type { RelativeDatePreset, TraverseFilter, TraverseFilterRule } from '../sdk/types';
import type { AggFn, AggregationRule } from '../model/aggregation';
import { havingField, sliceField } from './slice';
import { jsRegexSource } from './regex';
import { normalizeType } from '../model/field-category';
import { parseListText } from './list-text';
import { isDateTimeField, operatorsFor, RELATIVE_MAX_N, RELATIVE_PRESETS, type OpId } from './catalogue';

export type FilterValue = string | number | { from: string | number; to: string | number } | RelativeDatePreset | undefined;
/**
 * A column filter. With `fn` it is a HAVING filter on the aggregate of that column; slices never carry `fn`.
 * The value of `in` / `not_in` is a comma-separated text ("a, b", a value with a comma in double quotes: "Acme, Inc."); every other operator reads a comma as part of its one value.
 */
export type ColumnFilter = { field: string; op: OpId; value?: FilterValue; fn?: AggFn };

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
const numeric = (v: unknown) => filled(v) && Number.isFinite(Number(v));

/** The backend's IN_LIST_MAX_VALUES. */
const IN_LIST_MAX = 500;
// Newer JS engines accept `(?i:...)` modifier groups; the warehouses mostly do not, so they stay incomplete everywhere.
const MODIFIER_GROUP = /(?<!\\)\(\?[a-zA-Z]*(?:-[a-zA-Z]*)?:/;
const validRegex = (v: string) => { try { const r = jsRegexSource(v); if (MODIFIER_GROUP.test(r.source)) return false; new RegExp(r.source, r.flags); return true; } catch { return false; } };
const realDate = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** [1] year, [2] month, [3] day, [4] the zone, if any. A fraction (1-6 digits) and a zone may follow only `:SS`: `Z`, ` UTC` or `±HH:MM`, nothing else. */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?(Z| UTC|[+-](?:0\d|1[0-4]):[0-5]\d)?)?)$/;
/** Types that carry a zone of their own take any zone; a plain TIMESTAMP takes only UTC; every other type takes none. */
const ZONED_TYPES = new Set(['TIMESTAMPTZ', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP_TZ', 'TIMESTAMP_LTZ', 'TIMESTAMP WITH LOCAL TIME ZONE']);
const UTC_ZONES = new Set(['Z', ' UTC', '+00:00']);
function zoneAllowed(zone: string, type: string): boolean {
  const t = normalizeType(type);
  return ZONED_TYPES.has(t) || (t === 'TIMESTAMP' && UTC_ZONES.has(zone));
}
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/** One in / not_in entry, as the extension's list editor checks it: a real YYYY-MM-DD (a datetime may add HH:MM(:SS)), HH:MM(:SS), a number. */
function validEntry(x: string, field: Field): boolean {
  if (field.category === 'number') return numeric(x);
  if (field.category === 'time') return CLOCK.test(x);
  if (field.category === 'date') {
    const m = DAY.exec(x) ?? (isDateTimeField(field) ? STAMP.exec(x) : null);
    if (!m || !realDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
    return !m[4] || zoneAllowed(m[4], field.type);
  }
  return true;
}

export function isComplete(f: ColumnFilter, field: Field): boolean {
  const def = operatorsFor(field).find((o) => o.id === f.op);
  if (!def) return false;
  const v = f.value as never;
  switch (def.value) {
    case 'none': return true;
    case 'text': return filled(v) && (f.op !== 'regex' && f.op !== 'not_regex' || validRegex(String(v)));
    case 'date': return filled(v);
    case 'number': return numeric(v);
    case 'list': { const t = typeof v === 'string' ? parseListText(v) : []; return t.length > 0 && t.length <= IN_LIST_MAX && t.every((x) => validEntry(x, field)); }
    case 'number-range': return typeof v === 'object' && v !== null && numeric((v as { from: unknown }).from) && numeric((v as { to: unknown }).to);
    case 'date-range': return typeof v === 'object' && v !== null && filled((v as { from: unknown }).from) && filled((v as { to: unknown }).to);
    case 'relative': {
      const p = v as RelativeDatePreset | undefined;
      if (!p || typeof p !== 'object' || !('kind' in p)) return false;
      const preset = RELATIVE_PRESETS.find((r) => r.kind === p.kind);
      if (!preset) return false;
      if (!preset.needsN) return true;
      const n = (p as { n?: unknown }).n;
      return Number.isInteger(n) && (n as number) > 0 && (n as number) <= RELATIVE_MAX_N;
    }
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(.*)$/;
const NO_SECONDS = /^\d{2}:\d{2}$/;

/**
 * datetime-local and time inputs give `YYYY-MM-DDTHH:MM` / `HH:MM`; the backend wants seconds, and a space
 * between date and time, which every warehouse casts (Athena's CAST AS TIMESTAMP rejects the `T`).
 * Full values with a fraction or a zone (from a row) pass through untouched.
 */
const withSeconds = (v: string) => {
  const m = LOCAL_DATETIME.exec(v);
  if (m) return `${m[1]} ${m[2]}${m[3] || ':00'}`;
  return NO_SECONDS.test(v) ? `${v}:00` : v;
};
/** A date-only bound on a timestamp widens to the start or the end of that day, so "to" is inclusive. */
const bound = (v: string, end: boolean) => (DATE_ONLY.test(v) ? `${v} ${end ? '23:59:59' : '00:00:00'}` : withSeconds(v));

export function toTraverseFilter(f: ColumnFilter, field: Field): TraverseFilterRule {
  const column = field.name;
  const isNum = field.category === 'number';
  const stamped = isDateTimeField(field) || field.category === 'time';
  const scalar = (v: FilterValue) => (isNum ? Number(v) : stamped ? withSeconds(String(v)) : String(v));
  switch (f.op) {
    case 'is_blank': case 'is_not_blank': case 'is_true': case 'is_false':
      return { column, operator: f.op };
    // A datetime has no single moment to match: "on" a day is that whole day.
    case 'on':
      if (isDateTimeField(field)) { const day = String(f.value).slice(0, 10); return { column, operator: 'between', value: { from: bound(day, false), to: bound(day, true) } }; }
      return { column, operator: 'eq', value: scalar(f.value) as string };
    case 'in': case 'not_in': {
      const tokens = parseListText(String(f.value ?? ''));
      return { column, operator: f.op, value: (isNum ? tokens.map(Number) : stamped ? tokens.map(withSeconds) : tokens) as string[] | number[] };
    }
    case 'before': return { column, operator: 'lt', value: scalar(f.value) as string };
    case 'after': return { column, operator: 'gt', value: scalar(f.value) as string };
    case 'relative': return { column, operator: 'relative_date', value: f.value as RelativeDatePreset };
    case 'between': {
      const r = f.value as { from: string | number; to: string | number };
      if (isDateTimeField(field)) return { column, operator: 'between', value: { from: bound(String(r.from), false), to: bound(String(r.to), true) } };
      if (field.category === 'time') return { column, operator: 'between', value: { from: withSeconds(String(r.from)), to: withSeconds(String(r.to)) } };
      return isNum
        ? { column, operator: 'between', value: { from: Number(r.from), to: Number(r.to) } }
        : { column, operator: 'between', value: { from: String(r.from), to: String(r.to) } };
    }
    default:
      return { column, operator: f.op, value: scalar(f.value) } as TraverseFilterRule;
  }
}

/**
 * The complete filters as traverseData filters, then the complete slices (pre-join rules). The grid's rows query and an export report share this.
 * A slice on a field that is not joined is dropped. A filter with `fn` is a HAVING filter, kept only when `aggregations` has its (column, fn).
 */
export function toTraverseFilters(schema: Schema, filters: ColumnFilter[], slices: ColumnFilter[] = [], aggregations: AggregationRule[] = []): TraverseFilter[] {
  const out: TraverseFilter[] = [];
  for (const flt of filters) {
    const field = schema.find((x) => x.name === flt.field);
    if (!field) continue;
    if (flt.fn) {
      const having = havingField(field, flt.fn);
      if (aggregations.some((a) => a.column === flt.field && a.function === flt.fn) && isComplete(flt, having)) out.push({ ...toTraverseFilter(flt, having), function: flt.fn });
    } else if (isComplete(flt, field)) out.push(toTraverseFilter(flt, field));
  }
  for (const sl of slices) {
    const field = schema.find((x) => x.name === sl.field);
    if (!field?.joined) continue;
    const raw = sliceField(field);
    if (isComplete(sl, raw)) out.push({ ...toTraverseFilter(sl, raw), placement: 'pre-join' });
  }
  return out;
}

/** The filters without the HAVING ones whose `(column, fn)` aggregation is gone, as the extension's `withoutHavingFiltersOrphanedBy` does. The same map when none is orphaned. */
export function dropOrphanHaving(filters: Record<string, ColumnFilter>, aggregations: AggregationRule[]): Record<string, ColumnFilter> {
  const orphan = (f: ColumnFilter) => !!f.fn && !aggregations.some((a) => a.column === f.field && a.function === f.fn);
  if (!Object.values(filters).some(orphan)) return filters;
  return Object.fromEntries(Object.entries(filters).filter(([, f]) => !orphan(f)));
}
