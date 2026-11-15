import type { Field } from '../model/types';
import type { RelativeDatePreset } from '../sdk/types';

export type OpId = 'contains' | 'not_contains' | 'eq' | 'neq' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'on' | 'before' | 'after' | 'relative' | 'is_true' | 'is_false' | 'is_blank' | 'is_not_blank';
export type ValueKind = 'none' | 'text' | 'number' | 'date' | 'number-range' | 'date-range' | 'relative';
export type OpDef = { id: OpId; label: string; value: ValueKind };

const blank: OpDef[] = [
  { id: 'is_blank', label: 'is blank', value: 'none' },
  { id: 'is_not_blank', label: 'is not blank', value: 'none' },
];

const STRING: OpDef[] = [
  { id: 'contains', label: 'contains', value: 'text' },
  { id: 'not_contains', label: 'does not contain', value: 'text' },
  { id: 'eq', label: 'equals', value: 'text' },
  { id: 'neq', label: 'does not equal', value: 'text' },
  { id: 'starts_with', label: 'starts with', value: 'text' },
  { id: 'ends_with', label: 'ends with', value: 'text' },
  ...blank,
];
const NUMBER: OpDef[] = [
  { id: 'eq', label: '=', value: 'number' },
  { id: 'neq', label: '≠', value: 'number' },
  { id: 'gt', label: '>', value: 'number' },
  { id: 'gte', label: '≥', value: 'number' },
  { id: 'lt', label: '<', value: 'number' },
  { id: 'lte', label: '≤', value: 'number' },
  { id: 'between', label: 'between', value: 'number-range' },
  ...blank,
];
const dateOps = (withOn: boolean, withRelative: boolean): OpDef[] => [
  ...(withOn ? [{ id: 'on', label: 'on', value: 'date' } as OpDef] : []),
  { id: 'before', label: 'before', value: 'date' },
  { id: 'after', label: 'after', value: 'date' },
  { id: 'between', label: 'between', value: 'date-range' },
  ...(withRelative ? [{ id: 'relative', label: 'relative', value: 'relative' } as OpDef] : []),
  ...blank,
];

export function operatorsFor(field: Field): OpDef[] {
  switch (field.category) {
    case 'string': return STRING;
    case 'number': return NUMBER;
    case 'date': return dateOps(field.type.trim().toUpperCase() === 'DATE', true);
    case 'time': return dateOps(false, false);
    case 'boolean': return [
      { id: 'is_true', label: 'is true', value: 'none' },
      { id: 'is_false', label: 'is false', value: 'none' },
      { id: 'is_blank', label: 'is blank', value: 'none' },
    ];
    default: return blank;
  }
}

export const RELATIVE_PRESETS: { kind: RelativeDatePreset['kind']; label: string; needsN: boolean }[] = [
  { kind: 'today', label: 'Today', needsN: false },
  { kind: 'yesterday', label: 'Yesterday', needsN: false },
  { kind: 'this_week', label: 'This week', needsN: false },
  { kind: 'last_week', label: 'Last week', needsN: false },
  { kind: 'this_month', label: 'This month', needsN: false },
  { kind: 'last_month', label: 'Last month', needsN: false },
  { kind: 'this_quarter', label: 'This quarter', needsN: false },
  { kind: 'last_quarter', label: 'Last quarter', needsN: false },
  { kind: 'this_year', label: 'This year', needsN: false },
  { kind: 'last_n_days', label: 'Last N days', needsN: true },
  { kind: 'last_n_months', label: 'Last N months', needsN: true },
];

/** The backend's RELATIVE_DATE_MAX_N. */
export const RELATIVE_MAX_N = 3650;

/** A date-category field that carries a time of day (DATETIME, TIMESTAMP and their time-zone variants). */
export const isDateTimeField = (field: Field) => field.category === 'date' && field.type.trim().toUpperCase() !== 'DATE';
