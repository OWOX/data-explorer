import { AGG_LABELS, sanitizeAggregation, type Aggregation } from '../../model/aggregation';
import { isComplete, type ColumnFilter } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field, Schema } from '../../model/types';

/** What a member's aggregation Apply leaves out of the request (a function the column does not allow), in words; null when nothing is left out. */
export function unappliedAggregation(column: string, next: Aggregation, schema: Schema): string | null {
  const sent = sanitizeAggregation(next, schema);
  const dropped = next.aggregations.filter((r) => r.column === column && !sent.aggregations.includes(r));
  const field = schema.find((f) => f.name === column);
  return dropped.length && field ? `${dropped.map((r) => AGG_LABELS[r.function]).join(', ')} isn't allowed on ${columnTitle(field)}; it was not applied.` : null;
}

/** What a member's filter Apply leaves out of the request (a filter the column cannot take as it stands), in words; null when it is sent. */
export function unappliedFilter(filter: ColumnFilter, field: Field | undefined): string | null {
  return field && !isComplete(filter, field) ? `The filter on ${columnTitle(field)} is incomplete or does not fit this column; it was not applied.` : null;
}
