import { useEffect, useRef, useState } from 'react';
import { DATE_PRESETS, RELATIVE_MAX_N, RELATIVE_PRESETS, RELATIVE_UNITS, fromRule, isDateTimeField, isPreset, operatorsFor, toRule, type OpId, type RelativeUnit } from '../../filters/catalogue';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { isDayType } from '../../model/field-category';
import type { RelativeDatePreset } from '../../sdk/types';
import { Select } from '../Select';
import { HOVER_MS, HoverIntent, Panel, Row } from './MenuParts';

const input = 'dm-input h-8 w-full rounded-md border bg-background px-2 text-sm';

type EditorProps = { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void };

/** Date and timestamp columns open on the presets; the other operators are a step away. Time-of-day columns have no presets. */
export function FilterEditor(p: EditorProps) {
  return p.field.category === 'date' ? <DateFilterEditor {...p} /> : <OperatorForm {...p} />;
}

const REST: { op: OpId; label: string }[] = [{ op: 'before', label: 'Before…' }, { op: 'after', label: 'After…' }];
const LAST_LABELS = ['Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'Last week', 'Last month', 'Last quarter', 'Last 12 months'];
const THIS_LABELS = ['This week', 'This month', 'This quarter', 'This year'];
const GROUPS = { last: { title: 'Last…', labels: LAST_LABELS }, this: { title: 'This…', labels: THIS_LABELS } } as const;
type Group = keyof typeof GROUPS;
type Fly = { key: Group; row: HTMLElement; seq: number };
const inGroup = (rule: RelativeDatePreset | undefined, key: Group) => !!rule && (key === 'last' ? rule.kind === 'last_week' || rule.kind === 'last_month' || rule.kind === 'last_quarter' || rule.kind === 'last_n_days' || rule.kind === 'last_n_months' : rule.kind.startsWith('this_'));
const dash = <div role="separator" className="dm-menu-sep" />;

function DateFilterEditor({ field, value, onApply, onClear }: EditorProps) {
  // A filter that is not a preset (a range, a day) reopens on its own form, with a way back to the presets.
  const [form, setForm] = useState<OpId | null>(value && value.op !== 'relative' && value.op !== 'is_blank' && value.op !== 'is_not_blank' ? value.op : null);
  const current = value?.op === 'relative' ? (value.value as RelativeDatePreset) : undefined;
  const custom = current && !DATE_PRESETS.some((p) => isPreset(current, p.rule)) ? fromRule(current) : undefined;
  const [n, setN] = useState<number>(custom?.n ?? 7);
  const [unit, setUnit] = useState<RelativeUnit>(custom?.unit ?? 'days');
  const [fly, setFly] = useState<Fly | null>(null);
  // Hover intent as in the column menu: a flyout is replaced only once the pointer has rested on another row, and never while a field in it is being edited.
  const [intent] = useState(() => new HoverIntent());
  useEffect(() => () => intent.clear(), [intent]);
  // A flyout closed by the keyboard leaves the pointer resting on its row (on a narrow screen, where it covered the row, the browser then reports a hover): that row stays closed until the pointer leaves it.
  const closedRow = useRef<HTMLElement | null>(null);
  if (form) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setForm(null)} className="self-start text-xs text-muted-foreground hover:text-foreground">← Presets</button>
        <OperatorForm field={field} value={value} onApply={onApply} onClear={onClear} startOp={form} />
      </div>
    );
  }
  const apply = (rule: RelativeDatePreset) => onApply({ field: field.name, op: 'relative', value: rule });
  const rule = toRule(n, unit);
  const nOk = Number.isInteger(n) && n > 0 && rule.n <= RELATIVE_MAX_N;
  const isDay = isDayType(field.type);
  const editing = () => [...document.querySelectorAll<HTMLElement>('[data-column-menu][data-form]')].some((p) => 'edited' in p.dataset || (p.contains(document.activeElement) && !!document.activeElement?.matches('input, select, textarea')));
  const open = (key: Group, row: HTMLElement, focus: boolean) => { intent.clear(); closedRow.current = null; setFly((cur) => ({ key, row, seq: focus ? (cur?.key === key ? cur.seq : 0) + 1 : cur?.key === key ? cur.seq : 0 })); };
  const hoverGroup = (key: Group, row: HTMLElement) => { if (closedRow.current === row) return; if (fly?.key === key) intent.clear(); else if (!fly) open(key, row, false); else intent.after(HOVER_MS, () => { if (!editing()) open(key, row, false); }); };
  const hoverOther = () => { if (fly) intent.after(HOVER_MS, () => { if (!editing()) setFly(null); }); };
  const closeFly = () => { const row = fly?.row; closedRow.current = row ?? null; setFly(null); row?.focus(); };
  const leave = () => { intent.clear(); closedRow.current = null; };
  const plain = { tabbable: true, onHover: hoverOther, onLeaveRow: leave } as const;
  // Rows in the flyout itself must not close it when the pointer rests on them.
  const preset = (label: string, inFly = false) => {
    const pr = DATE_PRESETS.find((p) => p.label === label)!;
    return <Row key={label} {...(inFly ? { tabbable: false } : plain)} check checked={isPreset(current, pr.rule)} label={label} onActivate={() => apply(pr.rule)} />;
  };
  const group = (key: Group) => (
    <Row key={key} tabbable check checked={inGroup(current, key)} sub expanded={fly?.key === key} label={GROUPS[key].title}
      onActivate={(r) => open(key, r, true)} onOpen={(r) => open(key, r, true)} onHover={(r) => hoverGroup(key, r)} onLeaveRow={leave} />
  );
  const factor = toRule(1, unit).n;
  return (
    <div className="dm-menu-flush" role="group" aria-label={`Filter ${columnTitle(field)}`}>
      {preset('Today')}
      {preset('Yesterday')}
      {group('last')}
      {group('this')}
      <Row {...plain} slot label="Custom range…" onActivate={() => setForm('between')} />
      {dash}
      {isDay && <Row {...plain} slot label="On…" onActivate={() => setForm('on')} />}
      {REST.map((r) => <Row key={r.op} {...plain} slot label={r.label} onActivate={() => setForm(r.op)} />)}
      {(['is_blank', 'is_not_blank'] as const).map((op) => (
        <Row key={op} {...plain} check checked={value?.op === op} label={op === 'is_blank' ? 'Is blank' : 'Is not blank'} onActivate={() => onApply({ field: field.name, op })} />
      ))}
      {value && <>{dash}<Row {...plain} slot label="Clear" onActivate={onClear} /></>}
      {fly && (
        <Panel anchor={fly.row} mode="beside" role="menu" label={GROUPS[fly.key].title} onEscape={closeFly} onLeave={closeFly} focusSeq={fly.seq} className="dm-menu-editor dm-menu-fly" form={fly.key === 'last'}>
          <div className="dm-menu-list">{GROUPS[fly.key].labels.map((l) => preset(l, true))}</div>
          {fly.key === 'last' && (
            <form className="dm-menu-fly-form" onSubmit={(e) => { e.preventDefault(); if (nOk) apply(rule); }}>
              <span>Last</span>
              <input aria-label="N" className="w-16" type="number" min={1} max={Math.floor(RELATIVE_MAX_N / factor)} value={Number.isNaN(n) ? '' : n} onChange={(e) => setN(e.target.valueAsNumber)} />
              <Select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as RelativeUnit)}>
                {RELATIVE_UNITS.map((u) => <option key={u.unit} value={u.unit}>{u.label}</option>)}
              </Select>
              <button type="submit" disabled={!nOk} className="dm-btn dm-btn-primary dm-btn-sm">Apply</button>
            </form>
          )}
        </Panel>
      )}
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
      <Select aria-label="Operator" value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      {(def.value === 'text' || def.value === 'number') && (
        <input aria-label="Value" className={input} type={def.value === 'number' ? 'number' : 'text'} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />
      )}
      {def.value === 'date' && <input aria-label="Value" className={input} type={dateType} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />}
      {(def.value === 'number-range' || def.value === 'date-range') && (
        <div className="flex flex-wrap gap-2">
          {(['from', 'to'] as const).map((k) => (
            <input key={k} aria-label={k === 'from' ? 'From' : 'To'} className={`${input} !w-auto min-w-0 flex-1 basis-40`} type={def.value === 'number-range' ? 'number' : dateType}
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
      <div className="dm-menu-actions">
        <button type="button" onClick={onClear} className="dm-btn dm-btn-secondary">Clear</button>
        <button type="submit" disabled={!isComplete(draft, field)} className="dm-btn dm-btn-primary">Apply</button>
      </div>
    </form>
  );
}
