import { ChevronDown } from 'lucide-react';
import { num } from '../format';
import type { Mark } from '../storage-icons';

export type MultiOption = { value: string; label: string; count?: number; icon?: Mark };

/**
 * A checkbox menu on a native `<details>`: no library, and `name` makes the browser close the other
 * one when this opens. Every row starts ticked, so "Select all" is a real toggle: unticking it
 * empties the menu, which is what asking for none of them means. Ported from Data Flow.
 */
export function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) return null;
  // Counted against the options on offer: a ticked id that has since gone is no reason to say "3"
  // where every box in the menu is ticked.
  const ticked = options.filter((o) => selected.includes(o.value)).length;
  const all = ticked === options.length;
  const summary = all ? 'All' : ticked === 0 ? 'None' : ticked;

  return (
    <details className="dm-filter" name="dm-filter">
      <summary>
        {label}
        <span className={typeof summary === 'string' ? 'dm-filter-all' : 'dm-filter-count'}>{summary}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="dm-filter-menu">
        <label className="dm-filter-every">
          <input
            type="checkbox"
            checked={all}
            ref={(box) => { if (box) box.indeterminate = !all && ticked > 0; }}
            onChange={(e) => onChange(e.target.checked ? options.map((o) => o.value) : [])}
          />
          Select all
        </label>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <div key={o.value} className="dm-filter-row">
              <label className={on ? 'dm-on' : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
                />
                {o.icon && <o.icon size={14} />}
                <span className="dm-filter-label">{o.label}</span>
                {o.count !== undefined && <span className="dm-badge">{num(o.count)}</span>}
              </label>
              <button type="button" className="dm-filter-only" aria-label={`Only ${o.label}`} onClick={() => onChange([o.value])}>only</button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
