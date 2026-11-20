import { useState } from 'react';
import { AGG_LABELS, BUCKET_LABELS, DATE_BUCKETS, allowedFunctions, canBucket, canZone, type AggFn, type AggregationDraft, type DateBucket } from '../../model/aggregation';
import type { Field } from '../../model/types';
import { ActionForm } from '../ActionForm';
import { Select } from '../Select';
import { SheetsChecklist } from '../SheetsChecklist';

/** A small curated list, as the OWOX report picker offers; the value is checked again by the backend. */
const TIME_ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Kyiv', 'Europe/Berlin', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];

/**
 * What one column is aggregated by, ported from the OWOX report picker: any of the functions the field allows (each its own
 * output column), or for a date one bucket (Day to Year, with an optional time zone), never both. Unticking everything and applying removes it. Filters still apply to the raw rows, before they are grouped.
 */
export function AggregationEditor({ field, value, blocker, onApply, onCancel }: { field: Field; value: AggregationDraft; /** The title of a shown column that cannot be grouped: while it is shown, a rule that would group the rows is not applied. */ blocker?: string; onApply: (d: AggregationDraft) => void; onCancel: () => void }) {
  const allowed = allowedFunctions(field);
  const bucketable = canBucket(field);
  const zoneable = canZone(field);
  const [fns, setFns] = useState<AggFn[]>(value.functions);
  const [bucket, setBucket] = useState<DateBucket | null>(value.bucket);
  const [zone, setZone] = useState<string | null>(value.timeZone);
  const had = value.functions.length > 0 || value.bucket !== null;
  const pick = (next: string[]) => { setBucket(null); setZone(null); setFns(next as AggFn[]); };
  const choose = (unit: DateBucket | null) => { setBucket(unit); if (unit === null) setZone(null); else setFns([]); };
  const ordered = allowed.filter((f) => fns.includes(f));
  const groups = bucket !== null || ordered.length > 0;
  const stranded = !!blocker && groups;
  const canApply = !((!had && ordered.length === 0 && bucket === null) || stranded);
  const apply = () => { if (canApply) onApply({ functions: bucket ? [] : ordered, bucket, timeZone: bucket && zoneable ? zone : null }); };
  return (
    <ActionForm className="flex flex-col gap-3" onAction={apply}>
      {bucketable && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor={`bucket-${field.name}`}>Group by bucket</label>
          <Select id={`bucket-${field.name}`} aria-label="Group by bucket" value={bucket ?? ''} onChange={(e) => choose((e.target.value || null) as DateBucket | null)}>
            <option value="">No bucket</option>
            {DATE_BUCKETS.map((u) => <option key={u} value={u}>{BUCKET_LABELS[u]}</option>)}
          </Select>
          {bucket && zoneable && (
            <>
              <label className="pt-1 text-xs text-muted-foreground" htmlFor={`zone-${field.name}`}>Time zone (optional)</label>
              <Select id={`zone-${field.name}`} aria-label="Time zone" value={zone ?? ''} onChange={(e) => setZone(e.target.value || null)}>
                <option value="">No conversion</option>
                {TIME_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            </>
          )}
        </div>
      )}
      {allowed.length > 0 && (
        <fieldset aria-label={bucketable ? 'Or aggregate by' : 'Aggregate by'} className="flex flex-col gap-1">
          <SheetsChecklist label={bucketable ? 'Or aggregate by' : 'Aggregate by'} items={allowed.map((fn) => ({ value: fn, text: AGG_LABELS[fn] }))} selected={bucket ? [] : fns} onChange={pick} />
        </fieldset>
      )}
      {allowed.length === 0 && !bucketable && <p className="text-xs text-muted-foreground">No aggregation is allowed for this field.</p>}
      {stranded && <p role="alert" className="text-xs text-destructive">{`"${blocker}" can't be grouped. Hide it to aggregate.`}</p>}
      <p className="text-xs text-muted-foreground">Filters still apply to the rows before they are aggregated.</p>
      <div className="dm-menu-actions">
        <button type="button" onClick={onCancel} className="dm-btn dm-btn-secondary">Cancel</button>
        <button type="button" onClick={apply} disabled={!canApply} className="dm-btn dm-btn-primary">Apply</button>
      </div>
    </ActionForm>
  );
}
