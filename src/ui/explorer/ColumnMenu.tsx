import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, EyeOff, Funnel, Hash, Layers, Sigma } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatsFor, keepsUnit, type Format } from '../../format/formats';
import { describeFilter } from '../../filters/catalogue';
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
  /** Whether the column has a neighbour on that side inside its own data mart's group. */
  canMove: (field: string, dir: -1 | 1) => boolean;
  move: (field: string, dir: -1 | 1) => void;
  /** The warehouse type the column shows, after any aggregation function. */
  typeOf: (field: Field, output: Output) => string;
  /** False in Charts mode: no sort row and no sort mark. Absent means true. */
  sortable?: boolean;
  /** A request to open one output's root menu from outside its header (a right-click on its column letter). A new `seq` is a new request. */
  menuRequest?: { key: string; seq: number } | null;
};

const NOOP = () => undefined;
export const ColumnMenuEnvContext = createContext<ColumnMenuEnv>({
  sorts: [], setSort: NOOP, filters: {}, setFilter: NOOP, slices: {}, setSlice: NOOP, isAggregated: () => false, draftOf: () => ({ functions: [], bucket: null, timeZone: null }), blockerFor: () => undefined,
  changeAgg: NOOP, formatOf: () => ({ kind: 'auto' }), memberFormat: () => undefined, setFormat: NOOP, canHide: () => true, hide: NOOP, canMove: () => false, move: NOOP, typeOf: (f) => f.type,
});

const FORMAT_LABELS: Record<Format['kind'], string> = { auto: 'Automatic', plain: 'Plain number', percent: 'Percent', money: 'Money', date: 'Date', datetime: 'Date time', time: 'Time' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'UAH'];

/** The currencies the Money submenu lists: the four fixed ones, then the current one (an AI pick or an old choice) when it is another. */
const currenciesFor = (current: Format): string[] => (current.kind === 'money' && !CURRENCIES.includes(current.currency) ? [...CURRENCIES, current.currency] : CURRENCIES);

/** The function's label in lower case, as the HAVING note and the Funnel tooltip name it: "sum". */
const fnName = (f: AggFn) => AGG_LABELS[f].toLowerCase();
/** What a filter says in a tooltip: a HAVING filter names its function and reads against the aggregate's type. */
function describeColumnFilter(field: Field, f: ColumnFilter): string {
  return f.fn ? `${fnName(f.fn)} ${describeFilter(havingField(field, f.fn), f)}` : describeFilter(field, f);
}

const aggOn = (d: AggregationDraft) => d.functions.length > 0 || d.bucket !== null;
/** The member set a format of their own on a column that has formats. An AI project pick does not count. */
function formatActive(env: ColumnMenuEnv, field: Field, output: Output, type: string): boolean {
  const own = env.memberFormat(field.name);
  return keepsUnit(output.fn) && formatsFor(type).length > 0 && !!own && own.kind !== 'auto' && env.formatOf(field.name, type).kind !== 'auto';
}

/** A form submenu: a dialog panel beside its row, with a scrolling body. */
function EditorPanel({ row, seq, label, onEscape, children }: { row: HTMLElement; seq: number; label: string; onEscape: () => void; children: ReactNode }) {
  return (
    <Panel anchor={row} mode="beside" role="dialog" label={label} onEscape={onEscape} focusSeq={seq} className="dm-menu-sub dm-menu-editor">
      <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">{children}</div>
    </Panel>
  );
}

const Divider = () => <div role="separator" className="dm-menu-sep" />;

/** The panels whose fields count as an edit in progress. */
const EDITING = '[data-column-menu][role="dialog"], [data-column-menu][data-form]';

function MenuPopup({ field, output, anchor, initial, onClose }: { field: Field; output: Output; anchor: HTMLElement; initial: SubKey | null; onClose: (refocus?: boolean) => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const title = columnTitle(field);
  const type = env.typeOf(field, output);
  const aggregable = allowedFunctions(field).length > 0 || canBucket(field);
  const formats = keepsUnit(output.fn) ? formatsFor(type) : [];
  const [money, setMoney] = useState<{ row: HTMLElement; seq: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const having = env.filters[field.name]?.fn;
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
  // A click inside a dialog panel (Custom range, On, an operator) is an edit as well, but a click on a row is a choice, not an edit, so hover intent leaves the form alone.
  useEffect(() => {
    const mark = (e: MouseEvent) => { const t = e.target as Element | null; if (t?.closest('.dm-menu-row')) return; t?.closest<HTMLElement>('[data-column-menu][role="dialog"], [data-column-menu][data-form]')?.setAttribute('data-edited', ''); };
    document.addEventListener('click', mark, true);
    return () => document.removeEventListener('click', mark, true);
  }, []);
  const current = env.formatOf(field.name, type);
  // After Hide column the column is gone: focus goes to the next column's menu icon, or the previous one when it was the last.
  const hide = () => {
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
  const rowFor = (k: SubKey, label: string, haspopup: 'menu' | 'dialog') => (
    <Row key={k} label={label} icon={glyph[k]} active={on[k]} sub haspopup={haspopup} expanded={sub?.key === k} rowRef={ref(k)} onActivate={(r) => open(k, r, true)} onOpen={(r) => open(k, r, true)} onHover={(r) => hoverRow(k, r)} onLeaveRow={leaveRow} />
  );
  return (
    <>
      <Panel anchor={anchor} mode="below" role="menu" label={`Menu of ${title}`} onEscape={() => (sub ? closeSub() : onClose())} onTab={() => onClose()} onPlaced={placeDone} focusSeq={rootSeq} className="dm-menu-root">
        {rowFor('filter', 'Filter', 'dialog')}
        {field.joined && rowFor('slice', 'Slice', 'dialog')}
        {aggregable && rowFor('aggregate', 'Aggregate', 'dialog')}
        {formats.length > 0 && rowFor('format', 'Format', 'menu')}
        {canSort && rowFor('sort', 'Sort', 'menu')}
        <Divider />
        <Row label="Move left" icon={<ArrowLeft />} disabled={!env.canMove(field.name, -1)} onActivate={() => moveBy(-1)} onHover={hoverOther} onLeaveRow={leaveRow} />
        <Row label="Move right" icon={<ArrowRight />} disabled={!env.canMove(field.name, 1)} onActivate={() => moveBy(1)} onHover={hoverOther} onLeaveRow={leaveRow} />
        <Row label="Hide column" icon={<EyeOff />} disabled={!env.canHide(field.name)} onActivate={hide} onHover={hoverOther} onLeaveRow={leaveRow} />
      </Panel>
      {placed && sub?.key === 'filter' && (
        <EditorPanel row={sub.row} seq={sub.seq} label={`Filter of ${title}`} onEscape={closeSub}>
          <FilterEditor key={JSON.stringify(env.filters[field.name])} field={having ? havingField(field, having) : field} value={env.filters[field.name]}
            onApply={(f) => { env.setFilter(field.name, having ? { ...f, fn: having } : f); onClose(); }} onClear={() => { env.setFilter(field.name, undefined); onClose(); }} />
          {having ? <p className="mt-2 text-xs text-muted-foreground">Filters the {fnName(having)} after grouping</p>
            : env.isAggregated(field.name) && <p className="mt-2 text-xs text-muted-foreground">Filters rows before they are aggregated</p>}
        </EditorPanel>
      )}
      {placed && sub?.key === 'slice' && field.joined && (
        <EditorPanel row={sub.row} seq={sub.seq} label={`Slice of ${title}`} onEscape={closeSub}>
          <FilterEditor key={JSON.stringify(env.slices[field.name])} field={sliceField(field)} value={env.slices[field.name]}
            onApply={(f) => { env.setSlice(field.name, f); onClose(); }} onClear={() => { env.setSlice(field.name, undefined); onClose(); }} />
          <p className="mt-2 text-xs text-muted-foreground">Slices filter the joined data mart before it is joined, reducing the rows pulled in.</p>
        </EditorPanel>
      )}
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
  const type = env.typeOf(field, output);
  // Active means the member set something: an AI project pick does not light the icon.
  const formatOn = formatActive(env, field, output, type);
  const canSort = output.sortable && env.sortable !== false;
  const active = !!filter || (!!slice && !!field.joined) || aggregated || (canSort && !!direction) || formatOn;
  const close = useCallback((refocus = true) => { setMenu(null); if (refocus) icon.current?.focus(); }, []);
  // A request names an output by key: that header opens its root menu at its icon, every other one closes its own. A request already
  // standing when the header mounts is not new.
  const request = env.menuRequest;
  const seen = useRef(request?.seq ?? 0);
  useEffect(() => {
    if (!request || request.seq === seen.current) return;
    seen.current = request.seq;
    const anchor = icon.current;
    setMenu(request.key === output.key && anchor ? { anchor, sub: null } : null);
  }, [request, output.key]);
  const toggle = (anchor: HTMLElement, sub: SubKey | null) => setMenu((cur) => (cur && cur.sub === sub ? null : { anchor, sub }));
  useEffect(() => {
    if (!menu) return;
    // Outside the menu, a press closes it; so does a scroll of anything that holds the column (a fixed menu would be left behind it).
    // A resize only repositions the panels (each listens for it): on a touch screen the on-screen keyboard resizes the viewport.
    const down = (e: Event) => { const t = e.target as Element; if (!t.closest?.('[data-column-menu]') && !controls.current?.contains(t)) setMenu(null); };
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.('[data-column-menu]')) return;
      const holder = controls.current;
      if (t === document || (t instanceof Node && holder && t.contains(holder))) setMenu(null);
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('scroll', away, true); };
  }, [menu]);
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
          <button key={m.sub} type="button" {...(m.sub === 'sort' ? { 'data-sort-mark': '' } : {})} aria-label={m.label} aria-haspopup="menu" className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => toggle(e.currentTarget, m.sub)}>
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
