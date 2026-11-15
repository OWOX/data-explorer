import { Filter } from 'lucide-react';
import { useState } from 'react';
import { RELATIVE_PRESETS, operatorsFor, type OpId } from '../../filters/catalogue';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import type { Field } from '../../model/types';
import type { RelativeDatePreset } from '../../sdk/types';
import { Popover } from '../Popover';

const input = 'h-8 w-full rounded-md border bg-background px-2 text-sm';

export function FilterEditor({ field, value, onApply, onClear }: { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void }) {
  const ops = operatorsFor(field);
  const [op, setOp] = useState<OpId>(value?.op ?? ops[0]!.id);
  const [val, setVal] = useState<FilterValue>(value?.value);
  const def = ops.find((o) => o.id === op)!;
  const draft: ColumnFilter = { field: field.name, op, ...(def.value === 'none' ? {} : { value: val }) };
  const range = (val ?? { from: '', to: '' }) as { from: string; to: string };
  const rel = (val ?? { kind: 'today' }) as RelativeDatePreset;
  const dateType = field.category === 'time' ? 'time' : 'date';

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (isComplete(draft, field)) onApply(draft); }}>
      <div className="text-xs font-medium text-muted-foreground">{field.alias ?? field.name}</div>
      <select aria-label="Operator" className={input} value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {(def.value === 'text' || def.value === 'number') && (
        <input aria-label="Value" className={input} type={def.value === 'number' ? 'number' : 'text'} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />
      )}
      {def.value === 'date' && <input aria-label="Value" className={input} type={dateType} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />}
      {(def.value === 'number-range' || def.value === 'date-range') && (
        <div className="flex gap-2">
          {(['from', 'to'] as const).map((k) => (
            <input key={k} aria-label={k === 'from' ? 'From' : 'To'} className={input} type={def.value === 'number-range' ? 'number' : dateType}
              value={range[k] ?? ''} onChange={(e) => setVal({ ...range, [k]: e.target.value })} />
          ))}
        </div>
      )}
      {def.value === 'relative' && (
        <div className="flex gap-2">
          <select aria-label="Period" className={input} value={rel.kind} onChange={(e) => {
            const p = RELATIVE_PRESETS.find((x) => x.kind === e.target.value)!;
            setVal((p.needsN ? { kind: p.kind, n: 7 } : { kind: p.kind }) as RelativeDatePreset);
          }}>
            {RELATIVE_PRESETS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
          </select>
          {'n' in rel && <input aria-label="N" className={`${input} w-20`} type="number" min={1} value={Number.isNaN(rel.n) ? '' : rel.n} onChange={(e) => setVal({ ...rel, n: e.target.valueAsNumber } as RelativeDatePreset)} />}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClear} className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent">Clear</button>
        <button type="submit" disabled={!isComplete(draft, field)} className="rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-50">Apply</button>
      </div>
    </form>
  );
}

export function FilterPopover({ field, value, onChange }: { field: Field; value: ColumnFilter | undefined; onChange: (f: ColumnFilter | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={
      <button type="button" aria-label={`Filter ${field.alias ?? field.name}`} className={value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>
        <Filter className="size-3.5" fill={value ? 'currentColor' : 'none'} />
      </button>
    }>
      <FilterEditor key={JSON.stringify(value)} field={field} value={value}
        onApply={(f) => { onChange(f); setOpen(false); }} onClear={() => { onChange(undefined); setOpen(false); }} />
    </Popover>
  );
}
