import { Check, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DATE_PRESETS, RELATIVE_MAX_N, RELATIVE_PRESETS, RELATIVE_UNITS, fromRule, isDateTimeField, isPreset, operatorsFor, toRule, type OpId, type RelativeUnit } from '../../filters/catalogue';
import { formatListValue, parseListText } from '../../filters/list-text';
import { canSuggest, keepsPicks } from '../../filters/valueSuggest';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import { columnTitle } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { RelativeDatePreset } from '../../sdk/types';
import { ActionForm } from '../ActionForm';
import { Select } from '../Select';
import { ValueInput, type ValueSource } from './ValueInput';
import { Panel, Row, panelBeingEdited, useSubmenu } from './MenuParts';

/** Under these operators the second suggestion picked turns the text into the list form. */
const TO_LIST: Record<string, OpId> = { contains: 'in', not_contains: 'not_in' };
const input = 'dm-input h-8 w-full rounded-md border bg-background px-2 text-sm';

type EditorProps = { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void;
  /** A note under the Cancel / Apply row, in the sticky footer with it. */
  note?: ReactNode;
  /** Where the known values of a text column come from; absent, the text input has no suggestions. */
  values?: ValueSource;
  /** The date menu's last row, which takes the rule away: "Remove filter" or "Remove slice". */
  removeLabel?: string };

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

function DateFilterEditor({ field, value, onApply, onClear, note, removeLabel = 'Remove filter' }: EditorProps) {
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
      <Row {...plain} slot label="On…" onActivate={() => goForm('on')} />
      {REST.map((r) => <Row key={r.op} {...plain} slot label={r.label} onActivate={() => goForm(r.op)} />)}
      {(['is_blank', 'is_not_blank'] as const).map((op) => (
        <Row key={op} {...plain} check checked={value?.op === op} label={op === 'is_blank' ? 'Is blank' : 'Is not blank'} onActivate={() => onApply({ field: field.name, op })} />
      ))}
      {/* The trash sits in the check column (as the tick's -4px), so its label lines up with the rows above. */}
      {value && <>{dash}<Row {...plain} glyph={<Trash2 className="-ml-1 size-4" />} label={removeLabel} onActivate={onClear} /></>}
      {note && <div className="px-4 pb-2 pt-2">{note}</div>}
      {fly && (
        <Panel anchor={fly.row} mode="beside" role="menu" returnTo={fly.row} label={GROUPS[fly.key].title} onEscape={closeFly} onLeave={closeFly} focusSeq={fly.seq} className="dm-menu-editor dm-menu-fly" form={fly.key === 'last'}>
          <div className="dm-menu-list">{GROUPS[fly.key].labels.map((l) => preset(l, true))}</div>
          {fly.key === 'last' && (
            <ActionForm className="dm-menu-fly-form" onAction={() => { if (nOk) apply(rule); }}>
              {/* The tick column of the rows above: "Last" lines up with their labels, and a count the presets do not cover is ticked here. */}
              <span className="dm-menu-check" aria-hidden>{custom && <Check className="size-4" />}</span>
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
  // Bumped when the member picks another operator: the value input starts over, so a pick made under the old operator does not count as finished.
  const [opSeq, setOpSeq] = useState(0);
  const [val, setVal] = useState<FilterValue>(value?.op === op ? value.value : undefined);
  const def = ops.find((o) => o.id === op)!;
  // Under contains / does not contain the text was built by suggestion picks (a trailing ", " is the separator, not part of the value).
  // `undefined` means no pick yet: a reopened single value seeds pick mode only when it is one of the column's loaded suggestions,
  // otherwise it is plain contains text (a fragment such as "Ukr" must not become the first token of a list).
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [, setLoadedTick] = useState(0);
  const loadedValues = values && canSuggest(field) ? values.cache.get(values.key) : undefined;
  const seed = value?.op === op && (op === 'contains' || op === 'not_contains') && typeof value.value === 'string' && formatListValue(value.value) === value.value ? value.value : null;
  const eb = base !== undefined ? base : seed !== null && (loadedValues?.includes(seed) || values?.loaded?.includes(seed)) ? seed : null;
  const inPick = eb !== null && typeof val === 'string' && keepsPicks(eb, val);
  // A second value in a contains text built by picks (or typed after them) makes it the list form: the operator becomes is any of / is none of.
  if (inPick && op in TO_LIST && typeof val === 'string' && parseListText(val).length >= 2) { setOp(TO_LIST[op]!); setBase(null); }
  // Under contains the text built by picks has no separator left over: "Ukraine," is the one value "Ukraine".
  const sent = inPick && op in TO_LIST && typeof val === 'string' ? parseListText(val).join(', ') : val;
  const draft: ColumnFilter = { field: field.name, op, ...(def.value === 'none' ? {} : { value: sent }) };
  const range = (val ?? { from: '', to: '' }) as { from: string; to: string };
  const rel = (val ?? { kind: 'today' }) as RelativeDatePreset;
  /** What a date input can show: a loaded `2024-01-01 10:00:00.5+02:00` becomes `2024-01-01T10:00:00`. The stored value stays as loaded until edited. */
  const shown = (v: unknown, type: string) => {
    const t = String(v ?? '');
    if (type === 'date') return /^\d{4}-\d{2}-\d{2}[T ]/.test(t) ? t.slice(0, 10) : t;
    if (type !== 'datetime-local') return t;
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(t);
    return m ? `${m[1]}T${m[2]}` : t;
  };
  /** The zone a loaded stamp carries (`+02:00`, `Z`, `UTC`), which the input cannot show. */
  const zoneOf = (v: unknown) => /\d{2}:\d{2}:\d{2}(?:\.\d+)?( ?(?:Z|UTC|[+-]\d{2}(?::?\d{2})?))$/.exec(String(v ?? ''))?.[1];
  // The zones the editor opened with, held per input: clearing and retyping a value keeps its zone, and a bound with none takes the other's.
  const [zones, setZones] = useState<Record<string, string | undefined>>(() => {
    const o = value?.op === op ? value.value : undefined;
    // A value opened without a zone holds '' (no zone): only a bound that opened empty takes the other bound's zone.
    const held = (x: unknown) => zoneOf(x) ?? (x === undefined || x === null || String(x) === '' ? undefined : '');
    return typeof o === 'object' && o !== null ? { from: held((o as { from?: unknown }).from), to: held((o as { to?: unknown }).to) } : { v: held(o) };
  });
  const zoneFor = (k: 'v' | 'from' | 'to') => zones[k] ?? (k === 'from' ? zones.to : k === 'to' ? zones.from : undefined);
  /** An edited datetime-local value, in the space form with seconds, keeping the zone the input holds. */
  const edited = (k: 'v' | 'from' | 'to', raw: string, type: string) => {
    const z = type === 'datetime-local' ? zoneFor(k) : undefined;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(raw);
    if (z && m && zones[k] === undefined) setZones((p) => ({ ...p, [k]: z }));
    return z && m ? `${m[1]} ${m[2]}:${m[3] ?? '00'}${z}` : raw;
  };
  const zoneNote = (k: 'v' | 'from' | 'to', type: string) => { const z = type === 'datetime-local' ? zoneFor(k) : undefined; return z ? <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="zone-note">{z.trim()}</span> : null; };
  const dateType = field.category === 'time' ? 'time' : isDateTimeField(field) ? 'datetime-local' : 'date';
  // "On" a datetime column is a whole day.
  const valueType = op === 'on' && isDateTimeField(field) ? 'date' : dateType;

  return (
    <ActionForm className="dm-filter-form flex flex-col gap-2" onAction={() => { if (isComplete(draft, field)) onApply(draft); }}>
      <Select aria-label="Operator" value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); setZones({}); setBase(null); setOpSeq((n) => n + 1); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      {(def.value === 'text' || (def.value === 'list' && field.category === 'string')) && <ValueInput key={opSeq} op={op} value={String(val ?? '')} onChange={(v, b) => { setVal(v);
            // Typing before the suggestions load leaves the base unseeded, so a reopened value is seeded once they arrive.
            setBase(b ?? (eb !== null && keepsPicks(eb, v) ? eb : base === undefined && seed !== null && !loadedValues ? undefined : null)); }}
            inPick={inPick} onLoad={() => setLoadedTick((t) => t + 1)} source={canSuggest(field) && op !== 'regex' && op !== 'not_regex' ? values : undefined} className={input} />}
      {def.value === 'list' && field.category !== 'string' && <input aria-label="Value" className={input} type="text" placeholder="comma-separated" autoComplete="off" value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />}
      {def.value === 'number' && (
        <input aria-label="Value" className={input} type="number" value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />
      )}
      {def.value === 'date' && (
        <div className="flex items-center gap-2">
          <input aria-label="Value" className={`${input} min-w-0 flex-1`} type={valueType} value={shown(val, valueType)} onChange={(e) => setVal(edited('v', e.target.value, valueType))} />
          {zoneNote('v', valueType)}
        </div>
      )}
      {(def.value === 'number-range' || def.value === 'date-range') && (
        <div className="flex flex-wrap gap-2">
          {(['from', 'to'] as const).map((k) => (
            <div key={k} className="flex min-w-0 flex-1 basis-40 items-center gap-2">
              <input aria-label={k === 'from' ? 'From' : 'To'} className={`${input} min-w-0 flex-1`} type={def.value === 'number-range' ? 'number' : dateType}
                value={def.value === 'date-range' ? shown(range[k], dateType) : (range[k] ?? '')}
                onChange={(e) => setVal({ ...range, [k]: def.value === 'date-range' ? edited(k, e.target.value, dateType) : e.target.value })} />
              {def.value === 'date-range' && zoneNote(k, dateType)}
            </div>
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
