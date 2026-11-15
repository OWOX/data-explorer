import type { Field } from '../model/types';
import type { RelativeDatePreset, TraverseFilter } from '../sdk/types';
import { operatorsFor, RELATIVE_PRESETS, type OpId } from './catalogue';

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
      return Number.isInteger(n) && (n as number) > 0;
    }
  }
}

export function toTraverseFilter(f: ColumnFilter, field: Field): TraverseFilter {
  const column = field.name;
  const isNum = field.category === 'number';
  const scalar = (v: FilterValue) => (isNum ? Number(v) : String(v));
  switch (f.op) {
    case 'is_blank': case 'is_not_blank': case 'is_true': case 'is_false':
      return { column, operator: f.op };
    case 'on': return { column, operator: 'eq', value: String(f.value) };
    case 'before': return { column, operator: 'lt', value: String(f.value) };
    case 'after': return { column, operator: 'gt', value: String(f.value) };
    case 'relative': return { column, operator: 'relative_date', value: f.value as RelativeDatePreset };
    case 'between': {
      const r = f.value as { from: string | number; to: string | number };
      return isNum
        ? { column, operator: 'between', value: { from: Number(r.from), to: Number(r.to) } }
        : { column, operator: 'between', value: { from: String(r.from), to: String(r.to) } };
    }
    default:
      return { column, operator: f.op, value: scalar(f.value) } as TraverseFilter;
  }
}
