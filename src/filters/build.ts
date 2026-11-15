import type { Field } from '../model/types';
import type { RelativeDatePreset, TraverseFilter } from '../sdk/types';
import { isDateTimeField, operatorsFor, RELATIVE_MAX_N, RELATIVE_PRESETS, type OpId } from './catalogue';

export type FilterValue = string | number | { from: string | number; to: string | number } | RelativeDatePreset | undefined;
export type ColumnFilter = { field: string; op: OpId; value?: FilterValue };

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
const numeric = (v: unknown) => filled(v) && Number.isFinite(Number(v));

export function isComplete(f: ColumnFilter, field: Field): boolean {
  const def = operatorsFor(field).find((o) => o.id === f.op);
  if (!def) return false;
  const v = f.value as never;
  switch (def.value) {
    case 'none': return true;
    case 'text':
    case 'date': return filled(v);
    case 'number': return numeric(v);
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
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/;
const NO_SECONDS = /^\d{2}:\d{2}$/;

/**
 * datetime-local and time inputs give `YYYY-MM-DDTHH:MM` / `HH:MM`; the backend wants seconds, and a space
 * between date and time, which every warehouse casts (Athena's CAST AS TIMESTAMP rejects the `T`).
 * Full values with a fraction or a zone (from a row) pass through untouched.
 */
const withSeconds = (v: string) => {
  const m = LOCAL_DATETIME.exec(v);
  if (m) return `${m[1]} ${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}`;
  return NO_SECONDS.test(v) ? `${v}:00` : v;
};
/** A date-only bound on a timestamp widens to the start or the end of that day, so "to" is inclusive. */
const bound = (v: string, end: boolean) => (DATE_ONLY.test(v) ? `${v} ${end ? '23:59:59' : '00:00:00'}` : withSeconds(v));

export function toTraverseFilter(f: ColumnFilter, field: Field): TraverseFilter {
  const column = field.name;
  const isNum = field.category === 'number';
  const stamped = isDateTimeField(field) || field.category === 'time';
  const scalar = (v: FilterValue) => (isNum ? Number(v) : stamped ? withSeconds(String(v)) : String(v));
  switch (f.op) {
    case 'is_blank': case 'is_not_blank': case 'is_true': case 'is_false':
      return { column, operator: f.op };
    case 'on': return { column, operator: 'eq', value: String(f.value) };
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
      return { column, operator: f.op, value: scalar(f.value) } as TraverseFilter;
  }
}
