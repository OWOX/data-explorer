import { useState } from 'react';
import { DATE_PRESETS, RELATIVE_MAX_N, RELATIVE_PRESETS, isDateTimeField, isPreset, operatorsFor, type OpId } from '../../filters/catalogue';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { RelativeDatePreset } from '../../sdk/types';
import { Select } from '../Select';

const input = 'dm-input h-8 w-full rounded-md border bg-background px-2 text-sm';

type EditorProps = { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void };

/** Date and timestamp columns open on the presets; the other operators are a step away. Time-of-day columns have no presets. */
export function FilterEditor(p: EditorProps) {
  return p.field.category === 'date' ? <DateFilterEditor {...p} /> : <OperatorForm {...p} />;
}

const item = 'flex w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-accent';
const REST: { op: OpId; label: string }[] = [{ op: 'before', label: 'Before…' }, { op: 'after', label: 'After…' }];

function DateFilterEditor({ field, value, onApply, onClear }: EditorProps) {
  // A filter that is not a preset (a range, a day) reopens on its own form, with a way back to the presets.
  const [form, setForm] = useState<OpId | null>(value && value.op !== 'relative' && value.op !== 'is_blank' && value.op !== 'is_not_blank' ? value.op : null);
  const current = value?.op === 'relative' ? (value.value as RelativeDatePreset) : undefined;
  const customN = current && current.kind === 'last_n_days' && !DATE_PRESETS.some((p) => isPreset(current, p.rule)) ? current.n : 7;
  const [n, setN] = useState<number>(customN);
  if (form) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setForm(null)} className="self-start text-xs text-muted-foreground hover:text-foreground">← Presets</button>
        <OperatorForm field={field} value={value} onApply={onApply} onClear={onClear} startOp={form} />
      </div>
    );
  }
  const apply = (rule: RelativeDatePreset) => onApply({ field: field.name, op: 'relative', value: rule });
  const nOk = Number.isInteger(n) && n > 0 && n <= RELATIVE_MAX_N;
  const isDay = field.type.trim().toUpperCase() === 'DATE';
  return (
    <div className="flex flex-col gap-0.5" role="group" aria-label={`Filter ${columnTitle(field)}`}>
      <div className="dm-popover-title px-2 text-xs font-medium text-muted-foreground">Filter</div>
      <div className="flex flex-col gap-0.5" role="group" aria-label="Date presets">
        {DATE_PRESETS.map((pr) => {
          const active = isPreset(current, pr.rule);
          return <button key={pr.label} type="button" aria-pressed={active} onClick={() => apply(pr.rule)} className={`${item} ${active ? 'bg-accent font-medium' : ''}`}>{pr.label}</button>;
        })}
      </div>
      <form className="flex items-center gap-1 px-2 py-1 text-sm" onSubmit={(e) => { e.preventDefault(); if (nOk) apply({ kind: 'last_n_days', n }); }}>
        <span>Last</span>
        <input aria-label="N" className={`${input} w-16`} type="number" min={1} max={RELATIVE_MAX_N} value={Number.isNaN(n) ? '' : n} onChange={(e) => setN(e.target.valueAsNumber)} />
        <span>days</span>
        <button type="submit" disabled={!nOk} className="ml-auto rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-50">Apply</button>
      </form>
      <button type="button" onClick={() => setForm('between')} className={item}>Custom range…</button>
      <hr className="my-1" />
      {isDay && <button type="button" onClick={() => setForm('on')} className={item}>On…</button>}
      {REST.map((r) => <button key={r.op} type="button" onClick={() => setForm(r.op)} className={item}>{r.label}</button>)}
      {(['is_blank', 'is_not_blank'] as const).map((op) => {
        const active = value?.op === op;
        return <button key={op} type="button" aria-pressed={active} onClick={() => onApply({ field: field.name, op })} className={`${item} ${active ? 'bg-accent font-medium' : ''}`}>{op === 'is_blank' ? 'Is blank' : 'Is not blank'}</button>;
      })}
      {value && <button type="button" onClick={onClear} className="mt-1 self-end rounded-md border px-2.5 py-1 text-sm hover:bg-accent">Clear</button>}
    </div>
  );
}

function OperatorForm({ field, value, onApply, onClear, startOp }: EditorProps & { startOp?: OpId }) {
  const ops = operatorsFor(field).filter((o) => field.category !== 'date' || o.id !== 'relative');
  const [op, setOp] = useState<OpId>(startOp ?? (value && ops.some((o) => o.id === value.op) ? value.op : ops[0]!.id));
  const [val, setVal] = useState<FilterValue>(value?.op === op ? value.value : undefined);
  const def = ops.find((o) => o.id === op)!;
  const draft: ColumnFilter = { field: field.name, op, ...(def.value === 'none' ? {} : { value: val }) };
  const range = (val ?? { from: '', to: '' }) as { from: string; to: string };
  const rel = (val ?? { kind: 'today' }) as RelativeDatePreset;
  const dateType = field.category === 'time' ? 'time' : isDateTimeField(field) ? 'datetime-local' : 'date';

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (isComplete(draft, field)) onApply(draft); }}>
      <div className="dm-popover-title text-xs font-medium text-muted-foreground">Filter</div>
      <Select aria-label="Operator" value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
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
          <Select aria-label="Period" value={rel.kind} onChange={(e) => {
            const p = RELATIVE_PRESETS.find((x) => x.kind === e.target.value)!;
            setVal((p.needsN ? { kind: p.kind, n: 7 } : { kind: p.kind }) as RelativeDatePreset);
          }}>
            {RELATIVE_PRESETS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
          </Select>
          {'n' in rel && <input aria-label="N" className={`${input} w-20`} type="number" min={1} max={RELATIVE_MAX_N} value={Number.isNaN(rel.n) ? '' : rel.n} onChange={(e) => setVal({ ...rel, n: e.target.valueAsNumber } as RelativeDatePreset)} />}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClear} className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent">Clear</button>
        <button type="submit" disabled={!isComplete(draft, field)} className="rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-50">Apply</button>
      </div>
    </form>
  );
}
