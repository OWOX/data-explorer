import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, EyeOff, Funnel, Hash, Layers, Sigma } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatsFor, keepsUnit, type Format } from '../../format/formats';
import { describeFilter } from '../../filters/catalogue';
import { valueCache } from '../../filters/valueSuggest';
import { havingField, sliceField } from '../../filters/slice';
import type { ColumnFilter } from '../../filters/build';
import { BUCKET_LABELS, AGG_LABELS, allowedFunctions, canBucket, type AggFn, type AggregationDraft, type Output } from '../../model/aggregation';
import { columnTitle } from '../../model/fieldLabel';
import type { SortDirection, SortKey } from '../../model/sort';
import type { Field } from '../../model/types';
import { AggregationEditor } from './AggregationEditor';
import { Tooltip } from '../Tooltip';
import { FilterEditor } from './FilterEditor';
import { FilterLinesIcon } from './FilterLinesIcon';
import { Panel, Row, panelBeingEdited, useSubmenu } from './MenuParts';
import { useOutsidePress } from '../outsidePress';
import { useLatest } from '../useLatest';

type SubKey = 'filter' | 'slice' | 'aggregate' | 'format' | 'sort';

/** Everything a column's menu reads and changes. The grid provides it through context so a header cell is never rebuilt (and its open menu never lost) when a setting changes. */
export type ColumnMenuEnv = {
  sorts: SortKey[];
  /** `null` takes the column's sort away. A sort added here goes last in the order of precedence, as a title click's first step does. */
  setSort: (field: string, direction: SortDirection | null) => void;
  filters: Record<string, ColumnFilter>;
  setFilter: (field: string, f: ColumnFilter | undefined) => void;
  /** The slices (pre-join rules on joined fields), one per field. */
  slices: Record<string, ColumnFilter>;
  setSlice: (field: string, f: ColumnFilter | undefined) => void;
  isAggregated: (column: string) => boolean;
  draftOf: (column: string) => AggregationDraft;
  blockerFor: (field: string) => string | undefined;
  changeAgg: (column: string, draft: AggregationDraft) => void;
  formatOf: (column: string, type: string) => Format;
  /** The member's own format for the column. An AI pick is not one, so it never lights the menu icon. */
  memberFormat: (column: string) => Format | undefined;
  setFormat: (column: string, f: Format | null) => void;
  canHide: (field: string) => boolean;
  hide: (field: string) => void;
  /** Whether the field is a column on the grid. A field of a fields panel that is not has no Move rows, and Aggregate, Sort and Format first show it as a column. */
  isShown: (field: string) => boolean;
  /** The output the grid gives the field: its first one when shown, else the plain column it would be. */
  outputOf: (field: string) => Output;
  /** Whether the column has a neighbour on that side inside its own data mart's group. */
  canMove: (field: string, dir: -1 | 1) => boolean;
  move: (field: string, dir: -1 | 1) => void;
  /** The warehouse type the column shows, after any aggregation function. */
  typeOf: (field: Field, output: Output) => string;
  /** Takes a data mart's Unique Count column off the grid (by the mart's alias path). */
  removeUnique?: (path: string) => void;
  /** False in Charts mode: no sort row and no sort mark. Absent means true. */
  sortable?: boolean;
  /** The read behind a text input's suggested values (a Filter or a Slice on this column), or null when none can be made. */
  valuesFor?: (field: Field, scope: 'filter' | 'slice') => { key: string; load?: (signal: AbortSignal) => Promise<string[]>; loaded?: string[] } | null;
};

const NOOP = () => undefined;
export const ColumnMenuEnvContext = createContext<ColumnMenuEnv>({
  sorts: [], setSort: NOOP, filters: {}, setFilter: NOOP, slices: {}, setSlice: NOOP, isAggregated: () => false, draftOf: () => ({ functions: [], bucket: null, timeZone: null }), blockerFor: () => undefined,
  changeAgg: NOOP, formatOf: () => ({ kind: 'auto' }), memberFormat: () => undefined, setFormat: NOOP, isShown: () => true, outputOf: (name) => ({ key: name, column: name, sortable: true }), canHide: () => true, hide: NOOP, canMove: () => false, move: NOOP, typeOf: (f) => f.type,
});

const FORMAT_LABELS: Record<Format['kind'], string> = { auto: 'Automatic', plain: 'Plain number', percent: 'Percent', money: 'Money', date: 'Date', datetime: 'Date time', time: 'Time' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'UAH'];

/** The currencies the Money submenu lists: the four fixed ones, then the current one (an AI pick or an old choice) when it is another. */
const currenciesFor = (current: Format): string[] => (current.kind === 'money' && !CURRENCIES.includes(current.currency) ? [...CURRENCIES, current.currency] : CURRENCIES);

/** The notes under the Filter and Slice panels, after the OWOX web app's output settings. */
const FILTER_NOTE = <>Filters narrow the final result — applied <strong>after</strong> all joins.</>;
const SLICE_NOTE = <>Slices filter the joined data mart <strong>before</strong> it is joined — reducing the rows pulled in.</>;

/** The function's label in lower case, as the HAVING note and the Funnel tooltip name it: "sum". */
const fnName = (f: AggFn) => AGG_LABELS[f].toLowerCase();
/** What a filter says in a tooltip: a HAVING filter names its function and reads against the aggregate's type. */
export function describeColumnFilter(field: Field, f: ColumnFilter): string {
  return f.fn ? `${fnName(f.fn)} ${describeFilter(havingField(field, f.fn), f)}` : describeFilter(field, f);
}

const aggOn = (d: AggregationDraft) => d.functions.length > 0 || d.bucket !== null;
/** The member set a format of their own on a column that has formats. An AI project pick does not count. */
function formatActive(env: ColumnMenuEnv, field: Field, output: Output, type: string): boolean {
  const own = env.memberFormat(field.name);
  return keepsUnit(output.fn) && formatsFor(type).length > 0 && !!own && own.kind !== 'auto' && env.formatOf(field.name, type).kind !== 'auto';
}

/** Whether the member set something on the field (a filter, a slice, a function or bucket, a sort, a format), shown or not: it lights the menu icon. */
function fieldActive(env: ColumnMenuEnv, field: Field, output: Output): boolean {
  const canSort = output.sortable && env.sortable !== false;
  return !!env.filters[field.name] || (!!env.slices[field.name] && !!field.joined) || aggOn(env.draftOf(field.name)) || (canSort && env.sorts.some((s) => s.field === field.name)) || formatActive(env, field, output, env.typeOf(field, output));
}

/** A form submenu: a dialog panel beside its row, with a scrolling body. */
function EditorPanel({ row, seq, label, onEscape, children }: { row: HTMLElement; seq: number; label: string; onEscape: () => void; children: ReactNode }) {
  return (
    <Panel anchor={row} mode="beside" role="dialog" label={label} onEscape={onEscape} focusSeq={seq} className="dm-menu-sub dm-menu-editor">
      <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">{children}</div>
    </Panel>
  );
}

/** The read behind a text input's suggested values, with the shared cache. */
const valuesIn = (env: ColumnMenuEnv, f: Field, scope: 'filter' | 'slice') => { const v = env.valuesFor?.(f, scope); return v ? { ...v, cache: valueCache } : undefined; };

/**
 * The edit form of one field's Filter or Slice rule, beside `row`: the column menu's Filter / Slice submenu and the data mart badges' lists share it.
 * A HAVING filter (one with `fn`) edits the aggregate and keeps its function. `onDone` runs after Apply or Clear.
 */
function RuleEditor({ kind, field, row, seq, onEscape, onDone }: { kind: 'filter' | 'slice'; field: Field; row: HTMLElement; seq: number; onEscape: () => void; onDone: () => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const title = columnTitle(field);
  if (kind === 'slice') {
    if (!field.joined) return null;
    return (
      <EditorPanel row={row} seq={seq} label={`Slice of ${title}`} onEscape={onEscape}>
        <FilterEditor key={JSON.stringify(env.slices[field.name])} field={sliceField(field)} value={env.slices[field.name]} values={valuesIn(env, field, 'slice')}
          onApply={(f) => { env.setSlice(field.name, f); onDone(); }} onClear={() => { env.setSlice(field.name, undefined); onDone(); }}
          note={<p className="mt-2 text-xs text-muted-foreground">{SLICE_NOTE}</p>} />
      </EditorPanel>
    );
  }
  const having = env.filters[field.name]?.fn;
  return (
    <EditorPanel row={row} seq={seq} label={`Filter of ${title}`} onEscape={onEscape}>
      <FilterEditor key={JSON.stringify(env.filters[field.name])} field={having ? havingField(field, having) : field} value={env.filters[field.name]} values={having ? undefined : valuesIn(env, field, 'filter')}
        onApply={(f) => { env.setFilter(field.name, having ? { ...f, fn: having } : f); onDone(); }} onClear={() => { env.setFilter(field.name, undefined); onDone(); }}
        note={<>
          <p className="mt-2 text-xs text-muted-foreground">{FILTER_NOTE}</p>
          {having ? <p className="mt-2 text-xs text-muted-foreground">Filters the {fnName(having)} after grouping</p>
            : env.isAggregated(field.name) ? <p className="mt-2 text-xs text-muted-foreground">Filters rows before they are aggregated</p> : null}
        </>} />
    </EditorPanel>
  );
}

/** A click inside a dialog panel (Custom range, On, an operator) is an edit, but a click on a row is a choice, not an edit: hover intent leaves the form alone. */
function useMarkEdits() {
  useEffect(() => {
    const mark = (e: MouseEvent) => { const t = e.target as Element | null; if (t?.closest('.dm-menu-row')) return; t?.closest<HTMLElement>(EDITING)?.setAttribute('data-edited', ''); };
    document.addEventListener('click', mark, true);
    return () => document.removeEventListener('click', mark, true);
  }, []);
}

/**
 * The list under a data mart's "N filters" / "N slices" badge: one row per field that carries the rule. Hovering a row (or Arrow Right, or a click)
 * opens the same edit form the column menu's Filter / Slice submenu shows. Apply and Clear in the form save the one rule and close the list; `onClose` refocuses the badge.
 * The last row, after a separator, is "Clear": `onClear` removes every rule of the list and the caller closes it and places focus.
 */
export function RuleListMenu({ kind, title, fields, anchor, onClose, onClear, onDismiss }: { kind: 'filter' | 'slice'; title: string; fields: Field[]; anchor: HTMLElement; onClose: () => void; onClear: () => void; /** A press outside or a scroll: close without moving focus. */ onDismiss: () => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const holder = useLatest<HTMLElement | null>(anchor);
  useMenuDismiss(true, holder, onDismiss);
  useMarkEdits();
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub } = useSubmenu<string>({ isEditing: () => panelBeingEdited(EDITING) });
  const noun = kind === 'filter' ? 'Filters' : 'Slices';
  const describe = (f: Field) => (kind === 'filter' ? describeColumnFilter(f, env.filters[f.name]!) : describeFilter(sliceField(f), env.slices[f.name]!));
  const at = sub ? fields.find((f) => f.name === sub.key) : undefined;
  return (
    <>
      <Panel anchor={anchor} mode="below" role="menu" label={`${noun} in ${title}`} onEscape={() => (sub ? closeSub() : onClose())} onTab={onClose} focusSeq={1} className="dm-menu-root">
        {fields.map((f) => (
          <Row key={f.name} label={`${columnTitle(f)}: ${describe(f)}`} sub haspopup="dialog" expanded={sub?.key === f.name}
            onActivate={(r) => open(f.name, r, true)} onOpen={(r) => open(f.name, r, true)} onHover={(r) => hoverRow(f.name, r)} onLeaveRow={leaveRow} />
        ))}
        <div className="dm-menu-sep" role="separator" />
        <Row label="Clear" onActivate={onClear} onHover={hoverOther} onLeaveRow={leaveRow} />
      </Panel>
      {sub && at && <RuleEditor kind={kind} field={at} row={sub.row} seq={sub.seq} onEscape={closeSub} onDone={onClose} />}
    </>
  );
}

const Divider = () => <div role="separator" className="dm-menu-sep" />;

/** The panels whose fields count as an edit in progress. */
const EDITING = '[data-column-menu][role="dialog"]:not([data-config-panel]), [data-column-menu][data-form]';

function MenuPopup({ field, output, anchor, initial, onClose, onHide }: { field: Field; output: Output; anchor: HTMLElement; initial: SubKey | null; onClose: (refocus?: boolean) => void; /** Replaces the grid's Hide (a fields panel unticks the field through its own path). */ onHide?: () => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const title = columnTitle(field);
  const type = env.typeOf(field, output);
  const aggregable = allowedFunctions(field).length > 0 || canBucket(field);
  const formats = keepsUnit(output.fn) ? formatsFor(type) : [];
  const [money, setMoney] = useState<{ row: HTMLElement; seq: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  // A field opened from a fields panel may not be a column: it has no Move rows and nothing to hide.
  const shown = env.isShown(field.name);
  const rootSeq = initial ? 0 : 1;
  const rows = useRef(new Map<string, HTMLElement>());
  const ref = (k: string) => (el: HTMLElement | null) => { if (el) rows.current.set(k, el); else rows.current.delete(k); };
  // A submenu is measured from its row, so it waits until the menu has its place; a menu opened from an indicator then opens that submenu.
  const placeDone = () => {
    setPlaced(true);
    const row = initial ? rows.current.get(initial) : undefined;
    if (initial && row) setSub({ key: initial, row, seq: 1 });
  };
  // Hover intent never replaces a submenu that holds a focused field or an edit.
  const { sub, setSub, open, hoverRow, hoverOther, leaveRow, closeSub } = useSubmenu<SubKey>({ isEditing: () => panelBeingEdited(EDITING), onReset: () => setMoney(null) });
  useMarkEdits();
  const current = env.formatOf(field.name, type);
  // After Hide column the column is gone: focus goes to the next column's menu icon, or the previous one when it was the last.
  const hide = () => {
    if (onHide) { onHide(); onClose(); return; }
    const head = anchor.closest('thead');
    const icons = head ? [...head.querySelectorAll<HTMLElement>('[data-menu-icon]')] : [];
    const mine = anchor.closest('.dm-hdr-controls')?.querySelector('[data-menu-icon]');
    const at = mine ? icons.indexOf(mine as HTMLElement) : -1;
    // By field name: two columns of different data marts can share a title.
    const target = (icons[at + 1] ?? icons[at - 1])?.dataset.field;
    env.hide(field.name);
    onClose(false);
    if (target && head) focusIconOf(head, target);
  };
  // After Move left / right the headers are rebuilt: focus goes to the moved column's menu icon.
  const moveBy = (d: -1 | 1) => {
    const head = anchor.closest('thead');
    env.move(field.name, d);
    onClose(false);
    if (head) focusIconOf(head, field.name);
  };
  const choose = (f: Format) => { env.setFormat(field.name, f); onClose(); };
  const dir = env.sorts.find((s) => s.field === field.name)?.direction ?? null;
  const canSort = output.sortable && env.sortable !== false;
  const on: Record<SubKey, boolean> = { filter: !!env.filters[field.name], slice: !!env.slices[field.name], aggregate: aggOn(env.draftOf(field.name)), format: formatActive(env, field, output, type), sort: canSort && !!dir };
  const glyph: Record<SubKey, ReactNode> = { filter: <Funnel />, slice: <Layers />, aggregate: <Sigma />, format: <Hash />, sort: <ArrowUpDown /> };
  // A data mart's Unique Count is read-only: it takes no filter, no function and no format, and it is not a field that can move or hide.
  const metric = output.unique !== undefined;
  const rowFor = (k: SubKey, label: string, haspopup: 'menu' | 'dialog') => (
    <Row key={k} label={label} icon={glyph[k]} active={on[k]} sub haspopup={haspopup} expanded={sub?.key === k} rowRef={ref(k)} onActivate={(r) => open(k, r, true)} onOpen={(r) => open(k, r, true)} onHover={(r) => hoverRow(k, r)} onLeaveRow={leaveRow} />
  );
  return (
    <>
      <Panel anchor={anchor} mode="below" role="menu" label={`Menu of ${title}`} onEscape={() => (sub ? closeSub() : onClose())} onTab={() => onClose()} onPlaced={placeDone} focusSeq={rootSeq} className="dm-menu-root">
        {!metric && rowFor('filter', 'Filter', 'dialog')}
        {!metric && field.joined && rowFor('slice', 'Slice', 'dialog')}
        {!metric && aggregable && rowFor('aggregate', 'Aggregate', 'dialog')}
        {!metric && formats.length > 0 && rowFor('format', 'Format', 'menu')}
        {canSort && rowFor('sort', 'Sort', 'menu')}
        {canSort && metric && <Divider />}
        {metric ? <Row label="Remove Unique Count" icon={<EyeOff />} onActivate={() => { env.removeUnique?.(output.unique!); onClose(false); }} onHover={hoverOther} onLeaveRow={leaveRow} /> : (<>
        <Divider />
        {shown && <Row label="Move left" icon={<ArrowLeft />} disabled={!env.canMove(field.name, -1)} onActivate={() => moveBy(-1)} onHover={hoverOther} onLeaveRow={leaveRow} />}
        {shown && <Row label="Move right" icon={<ArrowRight />} disabled={!env.canMove(field.name, 1)} onActivate={() => moveBy(1)} onHover={hoverOther} onLeaveRow={leaveRow} />}
        <Row label="Hide column" icon={<EyeOff />} disabled={!shown || !env.canHide(field.name)} onActivate={hide} onHover={hoverOther} onLeaveRow={leaveRow} />
        </>)}
      </Panel>
      {placed && (sub?.key === 'filter' || sub?.key === 'slice') && <RuleEditor kind={sub.key} field={field} row={sub.row} seq={sub.seq} onEscape={closeSub} onDone={() => onClose()} />}
      {placed && sub?.key === 'aggregate' && (
        <EditorPanel row={sub.row} seq={sub.seq} label={`Aggregation of ${title}`} onEscape={closeSub}>
          <AggregationEditor key={JSON.stringify(env.draftOf(field.name))} field={field} value={env.draftOf(field.name)} blocker={env.blockerFor(field.name)}
            onApply={(d) => { env.changeAgg(field.name, d); onClose(); }} onCancel={closeSub} />
        </EditorPanel>
      )}
      {placed && sub?.key === 'sort' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={`Sort ${title}`} onEscape={closeSub} onLeave={closeSub} onTab={() => onClose()} focusSeq={sub.seq} className="dm-menu-sub">
          <Row check checked={dir === 'asc'} label="Sort A → Z" onActivate={() => { env.setSort(field.name, 'asc'); onClose(); }} />
          <Row check checked={dir === 'desc'} label="Sort Z → A" onActivate={() => { env.setSort(field.name, 'desc'); onClose(); }} />
          <Row slot label="Remove sort" disabled={!dir} onActivate={() => { env.setSort(field.name, null); onClose(); }} />
        </Panel>
      )}
      {placed && sub?.key === 'format' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={`Format ${title}`} onEscape={closeSub} onLeave={closeSub} onTab={() => onClose()} focusSeq={sub.seq} className="dm-menu-sub">
          {formats.map((kind) => kind === 'money' ? (
            <Row key={kind} check checked={current.kind === 'money'} sub expanded={!!money} label={FORMAT_LABELS.money}
              onActivate={(r) => setMoney({ row: r, seq: 1 })} onOpen={(r) => setMoney({ row: r, seq: 1 })} onHover={(r) => setMoney((c) => c ?? { row: r, seq: 0 })} />
          ) : (
            <Row key={kind} check checked={current.kind === kind} label={FORMAT_LABELS[kind]} onHover={() => setMoney(null)}
              onActivate={() => choose({ kind } as Format)} />
          ))}
        </Panel>
      )}
      {placed && sub?.key === 'format' && money && (
        <Panel anchor={money.row} mode="beside" role="menu" label={`Money ${title}`} onTab={() => onClose()} onEscape={() => { const r = money.row; setMoney(null); r.focus(); }} onLeave={() => { const r = money.row; setMoney(null); r.focus(); }} focusSeq={money.seq}>
          {currenciesFor(current).map((c) => <Row key={c} check checked={current.kind === 'money' && current.currency === c} label={c} onActivate={() => choose({ kind: 'money', currency: c })} />)}
        </Panel>
      )}
    </>
  );
}

/** What a column's header shows at its right end: an icon for each active filter, aggregation and sort, then the green menu icon. Each opens the column menu. */
/** The pending focus after Hide column. The menu that set it is gone by then, so it lives here; a new hide or an unmounted header cancels it. */
let focusTimer: number | undefined;

/** Focuses the menu icon of the column with this field name once the headers have been rebuilt, dropping any earlier pending focus. */
function focusIconOf(head: Element, fieldName: string) {
  window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => { if (head.isConnected) [...head.querySelectorAll<HTMLElement>('[data-menu-icon]')].find((i) => i.dataset.field === fieldName)?.focus(); }, 0);
}

/** The menu icon is revealed by its header's hover or focus; a column with something active keeps it on. */
export function menuIconClass(active: boolean): string {
  return active ? 'dm-ctl dm-ctl-lg dm-ctl-on dm-reveal dm-reveal-on' : 'dm-ctl dm-ctl-lg dm-reveal';
}

/**
 * Closes an open column menu on a press outside it, and on a scroll of anything that holds its opener (a fixed menu would be left behind it).
 * A press outside only closes it: it does not reach whatever is under the pointer. A resize only repositions the panels (each listens for it):
 * on a touch screen the on-screen keyboard resizes the viewport. `holder` is the element the menu opened from; presses on it are the opener's own.
 * `inside` matches the panels that belong to the menu: by default every column menu panel except a config panel (a field menu opened from one is a layer above it),
 * so a press on a row of the config panel closes the field menu. The config menu itself passes every panel.
 */
export function useMenuDismiss(open: boolean, holder: { current: HTMLElement | null }, close: () => void, inside = '[data-column-menu]:not([data-config-panel])') {
  const closeNow = useLatest(close);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.(inside)) return;
      const el = holder.current;
      if (t === document || (t instanceof Node && el && t.contains(el))) closeNow.current();
    };
    window.addEventListener('scroll', away, true);
    return () => window.removeEventListener('scroll', away, true);
  }, [open, holder, closeNow, inside]);
  useOutsidePress(open, (t) => !!t.closest(inside) || !!holder.current?.contains(t), close);
}

export function ColumnControls({ field, output }: { field: Field; output: Output }) {
  const env = useContext(ColumnMenuEnvContext);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; sub: SubKey | null } | null>(null);
  const icon = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLSpanElement>(null);
  const title = columnTitle(field);
  const filter = env.filters[field.name];
  const slice = env.slices[field.name];
  const draft = env.draftOf(field.name);
  const aggregated = aggOn(draft);
  const at = env.sorts.findIndex((s) => s.field === field.name);
  const direction = at < 0 ? null : env.sorts[at]!.direction;
  const canSort = output.sortable && env.sortable !== false;
  const active = fieldActive(env, field, output);
  const close = useCallback((refocus = true) => { setMenu(null); if (refocus) icon.current?.focus(); }, []);
  const toggle = (anchor: HTMLElement, sub: SubKey | null) => setMenu((cur) => (cur && cur.sub === sub ? null : { anchor, sub }));
  useMenuDismiss(!!menu, controls, () => setMenu(null));
  // The sort mark steps this column's sort (ascending, descending, none) in place; it does not open the menu.
  // Stepping to none unmounts the mark, so focus moves to the column's menu icon rather than dropping to the page.
  const cycleMark = () => {
    env.setSort(field.name, direction === 'asc' ? 'desc' : direction === 'desc' ? null : 'asc');
    if (direction === 'desc') icon.current?.focus();
  };
  const Arrow = direction === 'desc' ? ArrowDown : ArrowUp;
  // The indicators shown beside the menu icon, in this order; each opens the menu at its own submenu.
  const marks: { sub: SubKey; on: boolean; tip?: string; label: string; icon: ReactNode; badge?: ReactNode }[] = [
    { sub: 'filter', on: !!filter, tip: filter && `Filter: ${describeColumnFilter(field, filter)}`, label: `Filter ${title}`, icon: <Funnel className="dm-icon" /> },
    { sub: 'slice', on: !!slice && !!field.joined, tip: slice && `Slice: ${describeFilter(sliceField(field), slice)}`, label: `Slice ${title}`, icon: <Layers className="dm-icon" /> },
    { sub: 'aggregate', on: aggregated, tip: `Aggregation: ${draft.bucket ? `by ${BUCKET_LABELS[draft.bucket].toLowerCase()}` : draft.functions.map((f) => AGG_LABELS[f]).join(', ')}`, label: `Aggregate ${title}`, icon: <Sigma className="dm-icon" /> },
    { sub: 'sort', on: canSort && !!direction, label: `Sorted ${direction === 'asc' ? 'A to Z' : 'Z to A'}: ${title}`, icon: <Arrow className="dm-icon" />, badge: env.sorts.length > 1 ? <span className="text-[9px] leading-none tabular-nums">{at + 1}</span> : undefined },
  ];
  return (
    <span ref={controls} className="dm-hdr-controls">
      {marks.filter((m) => m.on).map((m) => {
        const button = (
          <button key={m.sub} type="button" {...(m.sub === 'sort' ? { 'data-sort-mark': '' } : {})} aria-label={m.label} {...(m.sub === 'sort' ? {} : { 'aria-haspopup': 'menu' as const })} className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => (m.sub === 'sort' ? cycleMark() : toggle(e.currentTarget, m.sub))}>
            {m.icon}{m.badge}
          </button>
        );
        return m.tip ? <Tooltip key={m.sub} content={m.tip}>{button}</Tooltip> : button;
      })}
      <button ref={icon} type="button" aria-label={`Column menu ${title}`} aria-haspopup="menu" aria-expanded={!!menu} data-menu-icon data-field={field.name}
        className={menuIconClass(active)} onClick={(e) => toggle(e.currentTarget, null)}>
        <FilterLinesIcon className="dm-icon" />
      </button>
      {menu && <MenuPopup key={menu.sub ?? 'root'} field={field} output={output} anchor={menu.anchor} initial={menu.sub} onClose={close} />}
    </span>
  );
}

/**
 * The column menu icon of a row in a data mart's fields panel: the same menu the header opens, for a field that may not be a column.
 * It is green whenever the field has a rule set on it, shown or not; otherwise it is grey and appears with the row's hover or focus.
 * Arrow Right from the row's option reaches it (it is not a Tab stop of its own).
 */
export function FieldMenuButton({ field, onHide }: { field: Field; onHide?: () => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const output = env.outputOf(field.name);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const icon = useRef<HTMLButtonElement>(null);
  const title = columnTitle(field);
  const close = () => { setAnchor(null); icon.current?.focus(); };
  // A press or scroll outside only closes the menu; focus stays where the press put it.
  useMenuDismiss(!!anchor, icon, () => setAnchor(null));
  const active = fieldActive(env, field, output);
  return (
    <>
      <button ref={icon} type="button" tabIndex={-1} data-row-action aria-label={`Column menu ${title}`} aria-haspopup="menu" aria-expanded={!!anchor} data-field={field.name}
        className={`dm-ctl dm-ctl-lg dm-row-ctl${active ? ' dm-ctl-on' : ''}`} onClick={(e) => { const a = e.currentTarget; setAnchor((cur) => (cur ? null : a)); }}>
        <FilterLinesIcon className="dm-icon" />
      </button>
      {anchor && <MenuPopup field={field} output={output} anchor={anchor} initial={null} onClose={close} onHide={onHide} />}
    </>
  );
}
