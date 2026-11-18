import { AGG_LABELS, type Aggregation } from '../../model/aggregation';
import { isComplete, type ColumnFilter } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field, Schema } from '../../model/types';

/** What is in `kept` and not in `applied` (the rules the schema's governance dropped), in words and as a key; null when nothing was dropped. */
export function removedAggregation(kept: Aggregation, applied: Aggregation, schema: Schema): { key: string; text: string } | null {
  if (kept === applied) return null;
  const dropped = kept.aggregations.filter((r) => !applied.aggregations.includes(r));
  const columns = [...new Set(dropped.map((r) => r.column))];
  const parts = columns.flatMap((column) => {
    const field = schema.find((f) => f.name === column);
    const fns = dropped.filter((r) => r.column === column).map((r) => AGG_LABELS[r.function]);
    return field ? [`${fns.join(', ')} ${fns.length > 1 ? 'are' : 'is'} no longer allowed on ${columnTitle(field)}; ${fns.length > 1 ? 'they were' : 'it was'} removed.`] : [];
  });
  return parts.length ? { key: JSON.stringify(dropped), text: parts.join(' ') } : null;
}

/** What a member's filter Apply leaves out of the request (a filter the column cannot take as it stands), in words; null when it is sent. */
export function unappliedFilter(filter: ColumnFilter, field: Field | undefined): string | null {
  return field && !isComplete(filter, field) ? `The filter on ${columnTitle(field)} is incomplete or does not fit this column; it was not applied.` : null;
}
