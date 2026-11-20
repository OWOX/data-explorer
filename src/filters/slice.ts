import type { AggFn } from '../model/aggregation';
import { categorizeFieldType } from '../model/field-category';
import type { Field } from '../model/types';

/** A slice filters the joined mart's rows before the join, so its field is typed by the raw pre-join type, not the type after the join-level roll-up. */
export function sliceField(field: Field): Field {
  const type = field.joined?.sourceType ?? field.type;
  return { ...field, type, category: categorizeFieldType(type) };
}

const NUMERIC_RESULT = new Set<AggFn>(['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'P25', 'P50', 'P75', 'P95']);

/** A HAVING filter compares the aggregate's result: a number for counts, sums, averages and percentiles, else the column's own type. */
export function havingField(field: Field, fn: AggFn): Field {
  return NUMERIC_RESULT.has(fn) ? { ...field, type: 'NUMERIC', category: 'number' } : field;
}
