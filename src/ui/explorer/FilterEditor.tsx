import { useState, type ReactNode } from 'react';
import { DATE_PRESETS, LIST_LABELS, RELATIVE_MAX_N, RELATIVE_PRESETS, RELATIVE_UNITS, fromRule, isDateTimeField, isPreset, operatorsFor, toRule, type OpId, type RelativeUnit } from '../../filters/catalogue';
import { canSuggest, keepsPicks, tokensOf } from '../../filters/valueSuggest';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { isDayType } from '../../model/field-category';
import type { RelativeDatePreset } from '../../sdk/types';
import { ActionForm } from '../ActionForm';
import { Select } from '../Select';
import { ValueInput, type ValueSource } from './ValueInput';
import { Panel, Row, panelBeingEdited, useSubmenu } from './MenuParts';

const input = 'dm-input h-8 w-full rounded-md border bg-background px-2 text-sm';

type EditorProps = { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void;
  /** A note under the Cancel / Apply row, in the sticky footer with it. */
  note?: ReactNode;
  /** Where the known values of a text column come from; absent, the text input has no suggestions. */
  values?: ValueSource };

/** Date and timestamp columns open on the presets; the other operators are a step away. Time-of-day columns have no presets. */
export function FilterEditor(p: EditorProps) {
  return p.field.category === 'date' ? <DateFilterEditor {...p} /> : <OperatorForm {...p} />;
}

const REST: { op: OpId; label: string }[] = [{ op: 'before', label: 'Before…' }, { op: 'after', label: 'After…' }];
const LAST_LABELS = ['Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'Last week', 'Last month', 'Last quarter', 'Last 12 months'];
const THIS_LABELS = ['This week', 'This month', 'This quarter', 'This year'];
const GROUPS = { last: { title: 'Last…', labels: LAST_LABELS }, this: { title: 'This…', labels: THIS_LABELS } } as const;
type Group = keyof typeof GROUPS;
const inGroup = (rule: RelativeDatePreset | undefined, key: Group) => !!rule && (key === 'last' ? rule.kind === 'last_week' || rule.kind === 'last_month' || rule.kind === 'last_quarter' || rule.kind === 'last_n_days' || rule.kind === 'last_n_months' : rule.kind.startsWith('this_'));
const dash = <div role="separator" className="dm-menu-sep" />;

function DateFilterEditor({ field, value, onApply, onClear, note }: EditorProps) {
  // A filter that is not a preset (a range, a day) reopens on its own form, with a way back to the presets.
  const [form, setForm] = useState<OpId | null>(value && value.op !== 'relative' && value.op !== 'is_blank' && value.op !== 'is_not_blank' ? value.op : null);
  const current = value?.op === 'relative' ? (value.value as RelativeDatePreset) : undefined;
  const custom = current && !DATE_PRESETS.some((p) => isPreset(current, p.rule)) ? fromRule(current) : undefined;
  const [n, setN] = useState<number>(custom?.n ?? 7);
  const [unit, setUnit] = useState<RelativeUnit>(custom?.unit ?? 'days');
  // Hover intent as in the column menu. A flyout closed by the keyboard leaves the pointer resting on its row (on a narrow screen, where it covered the row, the browser then reports a hover): that row stays closed until the pointer leaves it.
  const { sub: fly, open, hoverRow: hoverGroup, hoverOther, leaveRow: leave, closeSub: closeFly, dismiss } = useSubmenu<Group>({ isEditing: () => panelBeingEdited('[data-column-menu][data-form]'), holdClosed: true });
  // A form replaces the list and its row, so the flyout anchored to that row and any pending hover go with it.
  const goForm = (op: OpId | null) => { dismiss(); setForm(op); };
  if (form) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => goForm(null)} className="self-start text-xs text-muted-foreground hover:text-foreground">← Presets</button>
        <OperatorForm field={field} value={value} onApply={onApply} onClear={onClear} note={note} startOp={form} />
      </div>
    );
  }
  const apply = (rule: RelativeDatePreset) => onApply({ field: field.name, op: 'relative', value: rule });
  const rule = toRule(n, unit);
  const nOk = Number.isInteger(n) && n > 0 && rule.n <= RELATIVE_MAX_N;
  const isDay = isDayType(field.type);
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
    <div className="dm-menu-flush" role="menu" aria-label={`Filter ${columnTitle(field)}`}>
      {preset('Today')}
      {preset('Yesterday')}
      {group('last')}
      {group('this')}
      <Row {...plain} slot label="Custom range…" onActivate={() => goForm('between')} />
      {dash}
      {isDay && <Row {...plain} slot label="On…" onActivate={() => goForm('on')} />}
      {REST.map((r) => <Row key={r.op} {...plain} slot label={r.label} onActivate={() => goForm(r.op)} />)}
      {(['is_blank', 'is_not_blank'] as const).map((op) => (
        <Row key={op} {...plain} check checked={value?.op === op} label={op === 'is_blank' ? 'Is blank' : 'Is not blank'} onActivate={() => onApply({ field: field.name, op })} />
      ))}
      {value && <>{dash}<Row {...plain} slot label="Clear" onActivate={onClear} /></>}
      {note && <div className="px-4 pb-2 pt-2">{note}</div>}
      {fly && (
        <Panel anchor={fly.row} mode="beside" role="menu" returnTo={fly.row} label={GROUPS[fly.key].title} onEscape={closeFly} onLeave={closeFly} focusSeq={fly.seq} className="dm-menu-editor dm-menu-fly" form={fly.key === 'last'}>
          <div className="dm-menu-list">{GROUPS[fly.key].labels.map((l) => preset(l, true))}</div>
          {fly.key === 'last' && (
            <ActionForm className="dm-menu-fly-form" onAction={() => { if (nOk) apply(rule); }}>
              <span>Last</span>
              <input aria-label="N" className="w-16" type="number" min={1} max={Math.floor(RELATIVE_MAX_N / factor)} value={Number.isNaN(n) ? '' : n} onChange={(e) => setN(e.target.valueAsNumber)} />
              <Select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as RelativeUnit)}>
                {RELATIVE_UNITS.map((u) => <option key={u.unit} value={u.unit}>{u.label}</option>)}
              </Select>
              <button type="button" onClick={() => { if (nOk) apply(rule); }} disabled={!nOk} className="dm-btn dm-btn-primary dm-btn-sm">Apply</button>
            </ActionForm>
          )}
        </Panel>
      )}
    </div>
  );
}

function OperatorForm({ field, value, onApply, onClear, note, values, startOp }: EditorProps & { startOp?: OpId }) {
  const ops = operatorsFor(field).filter((o) => field.category !== 'date' || o.id !== 'relative');
  const [op, setOp] = useState<OpId>(startOp ?? (value && ops.some((o) => o.id === value.op) ? value.op : ops[0]!.id));
  const [val, setVal] = useState<FilterValue>(value?.op === op ? value.value : undefined);
  const def = ops.find((o) => o.id === op)!;
  // A comma in a text eq/neq typed here makes a list (any of); the rule says so, so only editor values are read that way.
  // A reopened rule stays as it was until the text is edited.
  const [edited, setEdited] = useState(false);
  // Under contains / does not contain the text was built by suggestion picks (a trailing ", " is the separator, not part of the value).
  // `undefined` means no pick yet: a reopened single value seeds pick mode only when it is one of the column's loaded suggestions,
  // otherwise it is plain contains text (a fragment such as "Ukr" must not become the first token of a list).
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [, setLoadedTick] = useState(0);
  const loadedValues = values && canSuggest(field) ? values.cache.get(values.key) : undefined;
  const seed = value?.op === op && (op === 'contains' || op === 'not_contains') && typeof value.value === 'string' && !value.value.includes(',') && !value.list ? value.value : null;
  const eb = base !== undefined ? base : seed !== null && loadedValues?.includes(seed) ? seed : null;
  const inPick = eb !== null && typeof val === 'string' && keepsPicks(eb, val);
  const wasList = !!value?.list && value.op === op;
  const isList = field.category === 'string' && (op === 'eq' || op === 'neq') && typeof val === 'string' && (edited ? val.includes(',') : wasList);
  // In pick mode the text is a list of picks: two or more values send as the list form, as the second pick would have switched it.
  const picked = inPick && (op === 'contains' || op === 'not_contains') && typeof val === 'string' ? tokensOf(val) : null;
  const toList = !!picked && picked.length >= 2;
  const sendOp: OpId = toList ? (op === 'contains' ? 'eq' : 'neq') : op;
  const sent = picked ? picked.join(', ') : val;
  const draft: ColumnFilter = { field: field.name, op: sendOp, ...(def.value === 'none' ? {} : { value: sent }), ...(isList || toList ? { list: true as const } : {}) };
  const range = (val ?? { from: '', to: '' }) as { from: string; to: string };
  const rel = (val ?? { kind: 'today' }) as RelativeDatePreset;
  const dateType = field.category === 'time' ? 'time' : isDateTimeField(field) ? 'datetime-local' : 'date';

  return (
    <ActionForm className="dm-filter-form flex flex-col gap-2" onAction={() => { if (isComplete(draft, field)) onApply(draft); }}>
      <Select aria-label="Operator" value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); setBase(null); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.id === op && toList ? LIST_LABELS[sendOp as 'eq' | 'neq'] : isList && o.id === op && (o.id === 'eq' || o.id === 'neq') ? LIST_LABELS[o.id] : o.label}</option>)}
      </Select>
      {def.value === 'text' && <ValueInput op={op} value={String(val ?? '')} onChange={(v, b) => { setEdited(true); setVal(v); // Typing before the suggestions load leaves the base unseeded, so a reopened value is seeded once they arrive.
            setBase(b ?? (eb !== null && keepsPicks(eb, v) ? eb : base === undefined && seed !== null && !loadedValues ? undefined : null)); }} inPick={inPick} onLoad={() => setLoadedTick((t) => t + 1)} onOp={(o) => { setOp(o as OpId); setBase(null); }} source={canSuggest(field) ? values : undefined} className={input} />}
      {def.value === 'number' && (
        <input aria-label="Value" className={input} type="number" value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />
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
      <div className="dm-menu-foot">
        <div className="dm-menu-actions">
          <button type="button" onClick={onClear} className="dm-btn dm-btn-secondary">Clear</button>
          <button type="button" onClick={() => { if (isComplete(draft, field)) onApply(draft); }} disabled={!isComplete(draft, field)} className="dm-btn dm-btn-primary">Apply</button>
        </div>
        {note}
      </div>
    </ActionForm>
  );
}
