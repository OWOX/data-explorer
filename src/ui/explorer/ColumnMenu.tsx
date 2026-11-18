import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Funnel, Hash, Sigma } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatsFor, keepsUnit, type Format } from '../../format/formats';
import { describeFilter } from '../../filters/catalogue';
import type { ColumnFilter } from '../../filters/build';
import { BUCKET_LABELS, AGG_LABELS, allowedFunctions, canBucket, type AggregationDraft, type Output } from '../../model/aggregation';
import { columnTitle } from '../../model/fieldLabel';
import type { SortDirection, SortKey } from '../../model/sort';
import type { Field } from '../../model/types';
import { AggregationEditor } from './AggregationEditor';
import { Tooltip } from '../Tooltip';
import { FilterEditor } from './FilterEditor';
import { FilterLinesIcon } from './FilterLinesIcon';
import { HOVER_MS, HoverIntent, Panel, Row } from './MenuParts';
export { HOVER_MS };

export type SubKey = 'filter' | 'aggregate' | 'format' | 'sort';

/** Everything a column's menu reads and changes. The grid provides it through context so a header cell is never rebuilt (and its open menu never lost) when a setting changes. */
export type ColumnMenuEnv = {
  sorts: SortKey[];
  /** `null` takes the column's sort away. A sort added here goes last in the order of precedence, as a title click's first step does. */
  setSort: (field: string, direction: SortDirection | null) => void;
  filters: Record<string, ColumnFilter>;
  setFilter: (field: string, f: ColumnFilter | undefined) => void;
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
  /** The warehouse type the column shows, after any aggregation function. */
  typeOf: (field: Field, output: Output) => string;
};

const NOOP = () => undefined;
export const ColumnMenuEnvContext = createContext<ColumnMenuEnv>({
  sorts: [], setSort: NOOP, filters: {}, setFilter: NOOP, isAggregated: () => false, draftOf: () => ({ functions: [], bucket: null, timeZone: null }), blockerFor: () => undefined,
  changeAgg: NOOP, formatOf: () => ({ kind: 'auto' }), memberFormat: () => undefined, setFormat: NOOP, canHide: () => true, hide: NOOP, typeOf: (f) => f.type,
});

export const FORMAT_LABELS: Record<Format['kind'], string> = { auto: 'Automatic', plain: 'Plain number', percent: 'Percent', money: 'Money', date: 'Date', datetime: 'Date time', time: 'Time' };
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'UAH'];

/** The currencies the Money submenu lists: the four fixed ones, then the current one (an AI pick or an old choice) when it is another. */
export const currenciesFor = (current: Format): string[] => (current.kind === 'money' && !CURRENCIES.includes(current.currency) ? [...CURRENCIES, current.currency] : CURRENCIES);

const aggOn = (d: AggregationDraft) => d.functions.length > 0 || d.bucket !== null;
/** The member set a format of their own on a column that has formats. An AI project pick does not count. */
function formatActive(env: ColumnMenuEnv, field: Field, output: Output, type: string): boolean {
  const own = env.memberFormat(field.name);
  return keepsUnit(output.fn) && formatsFor(type).length > 0 && !!own && own.kind !== 'auto' && env.formatOf(field.name, type).kind !== 'auto';
}

const Divider = () => <div role="separator" className="dm-menu-sep" />;

type Sub = { key: SubKey; row: HTMLElement; seq: number };

function MenuPopup({ field, output, anchor, initial, onClose }: { field: Field; output: Output; anchor: HTMLElement; initial: SubKey | null; onClose: (refocus?: boolean) => void }) {
  const env = useContext(ColumnMenuEnvContext);
  const title = columnTitle(field);
  const type = env.typeOf(field, output);
  const aggregable = allowedFunctions(field).length > 0 || canBucket(field);
  const formats = keepsUnit(output.fn) ? formatsFor(type) : [];
  const [sub, setSub] = useState<Sub | null>(null);
  const [money, setMoney] = useState<{ row: HTMLElement; seq: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const rootSeq = initial ? 0 : 1;
  const rows = useRef(new Map<string, HTMLElement>());
  const ref = (k: string) => (el: HTMLElement | null) => { if (el) rows.current.set(k, el); else rows.current.delete(k); };
  // A submenu is measured from its row, so it waits until the menu has its place; a menu opened from an indicator then opens that submenu.
  const placeDone = () => {
    setPlaced(true);
    const row = initial ? rows.current.get(initial) : undefined;
    if (initial && row) setSub({ key: initial, row, seq: 1 });
  };
  const open = (key: SubKey, row: HTMLElement, focus: boolean) => { intent.clear(); setMoney(null); setSub((cur) => ({ key, row, seq: focus ? (cur?.key === key ? cur.seq : 0) + 1 : cur?.key === key ? cur.seq : 0 })); };
  // Hover intent: a submenu is replaced only after the pointer has rested on another row for HOVER_MS, and never while the open one
  // holds a focused field or an edit. A click or a key switches at once.
  const [intent] = useState(() => new HoverIntent());
  useEffect(() => () => intent.clear(), [intent]);
  // A click inside a dialog panel (Custom range, On, an operator) is an edit as well, but a click on a row is a choice, not an edit, so hover intent leaves the form alone.
  useEffect(() => {
    const mark = (e: MouseEvent) => { const t = e.target as Element | null; if (t?.closest('.dm-menu-row')) return; t?.closest<HTMLElement>('[data-column-menu][role="dialog"], [data-column-menu][data-form]')?.setAttribute('data-edited', ''); };
    document.addEventListener('click', mark, true);
    return () => document.removeEventListener('click', mark, true);
  }, []);
  const editing = () => [...document.querySelectorAll<HTMLElement>('[data-column-menu][role="dialog"], [data-column-menu][data-form]')].some((p) => 'edited' in p.dataset || (p.contains(document.activeElement) && !!document.activeElement?.matches('input, select, textarea')));
  const later = (apply: () => void) => intent.after(HOVER_MS, () => { if (!editing()) apply(); });
  const hoverRow = (k: SubKey, row: HTMLElement) => { if (sub?.key === k) intent.clear(); else if (!sub) open(k, row, false); else later(() => open(k, row, false)); };
  const hoverOther = () => { if (sub) later(() => { setSub(null); setMoney(null); }); };
  const leaveRow = () => intent.clear();
  const closeSub = () => { const row = sub?.row; setSub(null); setMoney(null); row?.focus(); };
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
    window.clearTimeout(focusTimer);
    if (target && head) focusTimer = window.setTimeout(() => { if (head.isConnected) [...head.querySelectorAll<HTMLElement>('[data-menu-icon]')].find((i) => i.dataset.field === target)?.focus(); }, 0);
  };
  const choose = (f: Format) => { env.setFormat(field.name, f); onClose(); };
  const dir = env.sorts.find((s) => s.field === field.name)?.direction ?? null;
  const on: Record<SubKey, boolean> = { filter: !!env.filters[field.name], aggregate: aggOn(env.draftOf(field.name)), format: formatActive(env, field, output, type), sort: output.sortable && !!dir };
  const glyph: Record<SubKey, ReactNode> = { filter: <Funnel />, aggregate: <Sigma />, format: <Hash />, sort: <ArrowUpDown /> };
  const rowFor = (k: SubKey, label: string, haspopup: 'menu' | 'dialog') => (
    <Row key={k} label={label} icon={glyph[k]} active={on[k]} sub haspopup={haspopup} expanded={sub?.key === k} rowRef={ref(k)} onActivate={(r) => open(k, r, true)} onOpen={(r) => open(k, r, true)} onHover={(r) => hoverRow(k, r)} onLeaveRow={leaveRow} />
  );
  return (
    <>
      <Panel anchor={anchor} mode="below" role="menu" label={`Menu of ${title}`} onEscape={() => (sub ? closeSub() : onClose())} onTab={() => onClose()} onPlaced={placeDone} focusSeq={rootSeq} className="dm-menu-root">
        {rowFor('filter', 'Filter', 'dialog')}
        {aggregable && rowFor('aggregate', 'Aggregate', 'dialog')}
        {formats.length > 0 && rowFor('format', 'Format', 'menu')}
        {output.sortable && rowFor('sort', 'Sort', 'menu')}
        <Divider />
        <Row label="Hide column" icon={<EyeOff />} disabled={!env.canHide(field.name)} onActivate={hide} onHover={hoverOther} onLeaveRow={leaveRow} />
      </Panel>
      {placed && sub?.key === 'filter' && (
        <Panel anchor={sub.row} mode="beside" role="dialog" label={`Filter of ${title}`} onEscape={closeSub} focusSeq={sub.seq} className="dm-menu-editor">
          <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">
            <FilterEditor key={JSON.stringify(env.filters[field.name])} field={field} value={env.filters[field.name]}
              onApply={(f) => { env.setFilter(field.name, f); onClose(); }} onClear={() => { env.setFilter(field.name, undefined); onClose(); }} />
            {env.isAggregated(field.name) && <p className="mt-2 text-xs text-muted-foreground">Filters rows before they are aggregated</p>}
          </div>
        </Panel>
      )}
      {placed && sub?.key === 'aggregate' && (
        <Panel anchor={sub.row} mode="beside" role="dialog" label={`Aggregation of ${title}`} onEscape={closeSub} focusSeq={sub.seq} className="dm-menu-editor">
          <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">
            <AggregationEditor key={JSON.stringify(env.draftOf(field.name))} field={field} value={env.draftOf(field.name)} blocker={env.blockerFor(field.name)}
              onApply={(d) => { env.changeAgg(field.name, d); onClose(); }} onCancel={closeSub} />
          </div>
        </Panel>
      )}
      {placed && sub?.key === 'sort' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={`Sort ${title}`} onEscape={closeSub} onLeave={closeSub} onTab={() => onClose()} focusSeq={sub.seq}>
          <Row check checked={dir === 'asc'} label="Sort A → Z" onActivate={() => { env.setSort(field.name, 'asc'); onClose(); }} />
          <Row check checked={dir === 'desc'} label="Sort Z → A" onActivate={() => { env.setSort(field.name, 'desc'); onClose(); }} />
          <Row slot label="Remove sort" disabled={!dir} onActivate={() => { env.setSort(field.name, null); onClose(); }} />
        </Panel>
      )}
      {placed && sub?.key === 'format' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={`Format ${title}`} onEscape={closeSub} onLeave={closeSub} onTab={() => onClose()} focusSeq={sub.seq}>
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
  const draft = env.draftOf(field.name);
  const aggregated = aggOn(draft);
  const at = env.sorts.findIndex((s) => s.field === field.name);
  const direction = at < 0 ? null : env.sorts[at]!.direction;
  const type = env.typeOf(field, output);
  // Active means the member set something: an AI project pick does not light the icon.
  const formatOn = formatActive(env, field, output, type);
  const active = !!filter || aggregated || (output.sortable && !!direction) || formatOn;
  const close = useCallback((refocus = true) => { setMenu(null); if (refocus) icon.current?.focus(); }, []);
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
  return (
    <span ref={controls} className="dm-hdr-controls">
      {filter && (
        <Tooltip content={`Filter: ${describeFilter(field, filter)}`}>
          <button type="button" aria-label={`Filter ${title}`} aria-haspopup="menu" className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => toggle(e.currentTarget, 'filter')}>
            <Funnel className="dm-icon" />
          </button>
        </Tooltip>
      )}
      {aggregated && (
        <Tooltip content={`Aggregation: ${draft.bucket ? `by ${BUCKET_LABELS[draft.bucket].toLowerCase()}` : draft.functions.map((f) => AGG_LABELS[f]).join(', ')}`}>
          <button type="button" aria-label={`Aggregate ${title}`} aria-haspopup="menu" className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => toggle(e.currentTarget, 'aggregate')}>
            <Sigma className="dm-icon" />
          </button>
        </Tooltip>
      )}
      {output.sortable && direction && (
        <button type="button" data-sort-mark aria-label={`Sorted ${direction === 'asc' ? 'A to Z' : 'Z to A'}: ${title}`} aria-haspopup="menu" className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => toggle(e.currentTarget, 'sort')}>
          <Arrow className="dm-icon" />{env.sorts.length > 1 && <span className="text-[9px] leading-none tabular-nums">{at + 1}</span>}
        </button>
      )}
      <button ref={icon} type="button" aria-label={`Column menu ${title}`} aria-haspopup="menu" aria-expanded={!!menu} data-menu-icon data-field={field.name}
        className={menuIconClass(active)} onClick={(e) => toggle(e.currentTarget, null)}>
        <FilterLinesIcon className="dm-icon" />
      </button>
      {menu && <MenuPopup key={menu.sub ?? 'root'} field={field} output={output} anchor={menu.anchor} initial={menu.sub} onClose={close} />}
    </span>
  );
}
