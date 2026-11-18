import { Check, Search } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type ChecklistItem = {
  value: string;
  /** What the search matches and what a screen reader says for the row. */
  text: string;
  /** What the row shows; defaults to `text`. */
  label?: ReactNode;
  /** A selected disabled row cannot be unticked (Clear skips it); an unselected one cannot be ticked. */
  disabled?: boolean;
  /** Beside the label, such as a count or an "only" shortcut. It sits outside the toggle's keyboard handling. */
  extra?: ReactNode;
};

/**
 * A checklist in the style of Google Sheets' "Filter by values": "Select all N - Clear" and "Displaying N" on top,
 * a search box, then rows where a chosen value carries a check mark. Select all and Clear act on the rows that match
 * the search. `onChange` gets the whole new selection (values not on offer are left as they were).
 */
export function SheetsChecklist({ items, selected, onChange, label }: {
  items: ChecklistItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** The list's accessible name. */
  label: string;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items;
  const on = new Set(selected);

  const toggle = (item: ChecklistItem) => {
    if (item.disabled) return;
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
    else rows()[Math.min(to, rows().length - 1)]?.focus();
  };
  const onRowKey = (e: KeyboardEvent<HTMLElement>, item: ChecklistItem, at: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows().length - 1); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(item); }
  };

  return (
    <div className="dm-checklist">
      <div className="dm-checklist-top">
        <span className="dm-checklist-links">
          <button type="button" className="dm-checklist-link" onClick={selectAll}>{`Select all ${shown.length}`}</button>
          <span aria-hidden>-</span>
          <button type="button" className="dm-checklist-link" onClick={clear}>Clear</button>
        </span>
        <span className="dm-checklist-count" aria-live="polite">{`Displaying ${shown.length}`}</span>
      </div>
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
      <div ref={list} id={id} role="listbox" aria-label={label} aria-multiselectable="true" className="dm-checklist-list">
        {shown.map((item, at) => {
          const sel = on.has(item.value);
          return (
            <div key={item.value} role="presentation" className="dm-checklist-row dm-reveal-host">
              <div
                role="option"
                aria-selected={sel}
                aria-disabled={item.disabled || undefined}
                aria-label={item.text}
                tabIndex={at === 0 ? 0 : -1}
                className="dm-checklist-opt"
                onClick={() => toggle(item)}
                onKeyDown={(e) => onRowKey(e, item, at)}
              >
                <span className="dm-checklist-check" aria-hidden>{sel && <Check size={14} />}</span>
                <span className="dm-checklist-label">{item.label ?? item.text}</span>
              </div>
              {item.extra}
            </div>
          );
        })}
        {shown.length === 0 && <p className="dm-checklist-empty">No matches</p>}
      </div>
    </div>
  );
}
