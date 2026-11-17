import { Sigma } from 'lucide-react';
import { useState } from 'react';
import { AGG_LABELS, BUCKET_LABELS, DATE_BUCKETS, allowedFunctions, canBucket, canZone, type AggFn, type AggregationDraft, type DateBucket } from '../../model/aggregation';
import { columnTitle } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { Select } from '../Select';

/** A small curated list, as the OWOX report picker offers; the value is checked again by the backend. */
export const TIME_ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Kyiv', 'Europe/Berlin', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];

/**
 * What one column is aggregated by, ported from the OWOX report picker: any of the functions the field allows (each its own
 * output column), or for a date one bucket (Day to Year, with an optional time zone), never both. "No aggregation" leaves the column
 * a group key. Filters still apply to the raw rows, before they are grouped.
 */
export function AggregationEditor({ field, value, blocker, onApply, onCancel }: { field: Field; value: AggregationDraft; /** The title of a shown column that cannot be grouped: while it is shown, a rule that would group the rows is not applied. */ blocker?: string; onApply: (d: AggregationDraft) => void; onCancel: () => void }) {
  const allowed = allowedFunctions(field);
  const bucketable = canBucket(field);
  const zoneable = canZone(field);
  const [fns, setFns] = useState<AggFn[]>(value.functions);
  const [bucket, setBucket] = useState<DateBucket | null>(value.bucket);
  const [zone, setZone] = useState<string | null>(value.timeZone);
  const had = value.functions.length > 0 || value.bucket !== null;
  const toggle = (fn: AggFn, on: boolean) => { setBucket(null); setZone(null); setFns((cur) => (on ? [...cur.filter((f) => f !== fn), fn] : cur.filter((f) => f !== fn))); };
  const choose = (unit: DateBucket | null) => { setBucket(unit); if (unit === null) setZone(null); else setFns([]); };
  const ordered = allowed.filter((f) => fns.includes(f));
  const groups = bucket !== null || ordered.length > 0;
  const stranded = !!blocker && groups;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onApply({ functions: bucket ? [] : ordered, bucket, timeZone: bucket && zoneable ? zone : null }); }}>
      <div className="dm-popover-title text-sm font-medium">Aggregation</div>
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
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-xs text-muted-foreground">{bucketable ? 'Or aggregate by' : 'Aggregate by'}</legend>
          {allowed.map((fn) => (
            <label key={fn} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!bucket && fns.includes(fn)} onChange={(e) => toggle(fn, e.target.checked)} />
              {AGG_LABELS[fn]}
            </label>
          ))}
        </fieldset>
      )}
      {allowed.length === 0 && !bucketable && <p className="text-xs text-muted-foreground">No aggregation is allowed for this field.</p>}
      {stranded && <p role="alert" className="text-xs text-destructive">{`"${blocker}" can't be grouped. Hide it to aggregate.`}</p>}
      <p className="text-xs text-muted-foreground">Filters still apply to the rows before they are aggregated.</p>
      <div className="flex items-center justify-end gap-2">
        <button type="button" disabled={!had && fns.length === 0 && bucket === null} onClick={() => onApply({ functions: [], bucket: null, timeZone: null })} className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent disabled:opacity-50">Clear</button>
        <button type="button" onClick={onCancel} className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent">Cancel</button>
        <button type="submit" disabled={(!had && ordered.length === 0 && bucket === null) || stranded} className="rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-50">Apply</button>
      </div>
    </form>
  );
}

/** The Sigma on a column title: shown on hover or focus, and kept on in the primary colour while the column has a function or a bucket. */
export function AggregationPopover({ field, value, blocker, onApply }: { field: Field; value: AggregationDraft; blocker?: string; onApply: (d: AggregationDraft) => void }) {
  const [open, setOpen] = useState(false);
  const on = value.functions.length > 0 || value.bucket !== null;
  const allowed = allowedFunctions(field);
  if (allowed.length === 0 && !canBucket(field)) return null;
  const tip = on ? `Aggregation: ${value.bucket ? `by ${BUCKET_LABELS[value.bucket].toLowerCase()}` : value.functions.map((f) => AGG_LABELS[f]).join(', ')}` : 'Aggregate';
  return (
    <Popover open={open} onOpenChange={setOpen} tip={tip} label={`Aggregation of ${columnTitle(field)}`} trigger={
      <button type="button" aria-label={`Aggregate ${columnTitle(field)}`} className={on ? 'dm-reveal dm-reveal-on text-primary' : 'dm-reveal text-muted-foreground hover:text-foreground'}>
        <Sigma className="size-3.5" />
      </button>
    }>
      <AggregationEditor key={JSON.stringify(value)} field={field} value={value} blocker={blocker} onApply={(d) => { onApply(d); setOpen(false); }} onCancel={() => setOpen(false)} />
    </Popover>
  );
}
