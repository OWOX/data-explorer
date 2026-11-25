import { Check, Search } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { rovingTarget } from './roving';

export type ChecklistItem = {
  value: string;
  /** What the search matches and what a screen reader says for the row. */
  text: string;
  /** What the row shows; defaults to `text`. */
  label?: ReactNode;
  /** A selected disabled row cannot be unticked (Clear skips it); an unselected one cannot be ticked. */
  disabled?: boolean;
  /** A control at the row's right end, after `extra`: a menu button, say. Outside the option, so a click on it does not toggle. It carries `data-row-action` and is not a Tab stop: Arrow Right from the option reaches it, Arrow Left returns. */
  action?: ReactNode;
  /** Right after the label, outside the option (so it is not interactive content inside it): a hint glyph, say. Clicking it does not toggle. It is hidden from assistive tech and not a Tab stop, so put what it says in `description`. */
  extra?: ReactNode;
  /** What a screen reader says after the row's name (the text an `extra` hint shows). */
  description?: string;
  /** Makes this the only chosen row. Shown as a pointer-only "only" button on hover, focus and touch (hidden from assistive tech, not a Tab stop), and bound to Shift+Enter on the row. */
  only?: () => void;
};

/** Below this many rows a search box is clutter. */
const SEARCH_FROM = 8;

/**
 * A checklist in the style of Google Sheets' "Filter by values": "Select all N - Clear" and "Displaying N" on top,
 * a search box, then rows where a chosen value carries a check mark. Select all and Clear act on the rows that match
 * the search. `onChange` gets the whole new selection (values not on offer are left as they were).
 */
export function SheetsChecklist({ items, selected, onChange, label, displaying, lead }: {
  items: ChecklistItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** The list's accessible name. */
  label: string;
  /** The number "Displaying" shows; defaults to the rows on offer (those the search matches). */
  displaying?: number;
  /** A row above the others that is not one of them: Select all, Clear and the counts leave it alone, and it has its own toggle. */
  lead?: { item: ChecklistItem; on: boolean; onToggle: () => void };
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items;
  const on = new Set(selected);
  const hasSearch = items.length >= SEARCH_FROM;
  // The lead row shows while the search matches it, and comes first.
  const leading = lead && (!q || lead.item.text.toLowerCase().includes(q)) ? [lead.item] : [];
  const rowsShown = [...leading, ...shown];
  const stop = rowsShown.some((i) => i.value === active) ? active : rowsShown[0]?.value;

  const toggle = (item: ChecklistItem) => {
    if (item.disabled) return;
    if (lead && item === lead.item) { lead.onToggle(); return; }
    onChange(on.has(item.value) ? selected.filter((v) => v !== item.value) : [...selected, item.value]);
  };
  const selectAll = () => {
    const add = shown.filter((i) => !i.disabled && !on.has(i.value)).map((i) => i.value);
    if (add.length > 0) onChange([...selected, ...add]);
  };
  const clear = () => {
    const keep = new Set(shown.filter((i) => i.disabled).map((i) => i.value));
    const next = selected.filter((v) => !shown.some((i) => i.value === v) || keep.has(v));
    if (next.length !== selected.length) onChange(next);
  };

  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  const move = (to: number) => {
    if (to < 0) search.current?.focus();
    else rows()[to]?.focus();
  };
  const onRowKey = (e: KeyboardEvent<HTMLElement>, item: ChecklistItem, at: number) => {
    if (e.key === 'Enter' && e.shiftKey && item.only) { e.preventDefault(); item.only(); return; }
    if (hasSearch && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setQuery((c) => c + e.key);
      search.current?.focus();
      return;
    }
    if (e.key === 'ArrowRight' && item.action) {
      const action = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-row-action]');
      if (action) { e.preventDefault(); action.focus(); return; }
    }
    const to = rovingTarget(e.key, at, rows().length, { wrap: false });
    if (to !== null) { e.preventDefault(); move(to); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(item); }
  };

  // Keys on a row's action button: Arrow Left returns to the option, Arrow Up and Down move between the rows' options.
  const onActionKey = (e: KeyboardEvent<HTMLElement>, at: number) => {
    if (!(e.target instanceof HTMLElement) || !e.target.hasAttribute('data-row-action') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); rows()[at]?.focus(); return; }
    const to = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? rovingTarget(e.key, at, rows().length, { wrap: false }) : null;
    if (to !== null) { e.preventDefault(); move(to); }
  };

  return (
    <div className="dm-checklist">
      <div className="dm-checklist-top">
        <span className="dm-checklist-links">
          <button type="button" className="dm-checklist-link" onClick={selectAll}>{`Select all ${shown.length}`}</button>
          <span aria-hidden>-</span>
          <button type="button" className="dm-checklist-link" onClick={clear}>Clear</button>
        </span>
        <span className="dm-checklist-count">{`Displaying ${displaying ?? shown.length}`}</span>
      </div>
      {hasSearch && (
      <div className="dm-checklist-search">
          <input
            ref={search}
            type="text"
            role="searchbox"
            aria-label={`Search ${label}`}
            placeholder="Search"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
              else if (e.key === 'ArrowDown') { e.preventDefault(); rows()[0]?.focus(); }
            }}
          />
          <Search size={14} aria-hidden />
        </div>
      )}
      <div ref={list} id={id} role="listbox" aria-label={label} aria-multiselectable="true" className="dm-checklist-list">
        {rowsShown.map((item) => {
          const sel = lead && item === lead.item ? lead.on : on.has(item.value);
          return (
            <div key={item.value} role="presentation" className="dm-checklist-row dm-reveal-host"
              // With an `extra` the option ends at its label: the empty part of the row still toggles it.
              onClick={(e) => { if (e.target !== e.currentTarget) return; toggle(item); e.currentTarget.querySelector<HTMLElement>('[role="option"]')?.focus(); }}
              onKeyDown={item.action ? (e) => onActionKey(e, rowsShown.indexOf(item)) : undefined}>
              <div
                role="option"
                aria-selected={sel}
                aria-disabled={item.disabled || undefined}
                aria-label={item.text}
                aria-description={item.description}
                aria-keyshortcuts={[item.only && 'Shift+Enter', item.action && 'ArrowRight'].filter(Boolean).join(' ') || undefined}
                tabIndex={item.value === stop ? 0 : -1}
                className="dm-checklist-opt"
                onClick={() => toggle(item)}
                onFocus={() => setActive(item.value)}
                onKeyDown={(e) => onRowKey(e, item, rowsShown.indexOf(item))}
              >
                <span className="dm-checklist-check" aria-hidden>{sel && <Check size={14} />}</span>
                <span className="dm-checklist-label">{item.label ?? item.text}</span>
              </div>
              {item.extra}
              {item.action}
              {item.only && <button type="button" tabIndex={-1} aria-hidden="true" aria-label={`Only ${item.text}`} className="dm-filter-only" onClick={item.only}>only</button>}
            </div>
          );
        })}
        {rowsShown.length === 0 && <p className="dm-checklist-empty">No matches</p>}
      </div>
    </div>
  );
}
