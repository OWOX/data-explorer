import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';
import { num } from '../format';
import type { Mark } from '../storage-icons';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';

export type MultiOption = { value: string; label: string; count?: number; icon?: Mark };

/**
 * A Sheets-style checklist menu on a native `<details>`: no library, and `name` makes the browser close the other
 * one when this opens. Every row starts ticked; "Clear" empties the menu, which is what asking for none of them means. Ported from Data Flow.
 */
export function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  // `<details name>` closes the other menu when one opens; nothing but this closes the last one
  // when the pointer goes elsewhere.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.dm-filter[open]')) {
        if (!menu.contains(e.target as Node)) menu.open = false;
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  if (options.length === 0) return null;
  // Counted against the options on offer: a ticked id that has since gone is no reason to say "3"
  // where every box in the menu is ticked.
  const ticked = options.filter((o) => selected.includes(o.value)).length;
  const all = ticked === options.length;
  const summary = all ? 'All' : ticked === 0 ? 'None' : ticked;

  const items: ChecklistItem[] = options.map((o) => ({
    value: o.value,
    text: o.label,
    label: <>{o.icon && <o.icon size={14} />}<span className="dm-filter-label">{o.label}</span>{o.count !== undefined && <span className="dm-badge">{num(o.count)}</span>}</>,
    only: () => onChange([o.value]),
  }));

  return (
    <details className="dm-filter" name="dm-filter">
      <summary>
        {label}
        <span className={typeof summary === 'string' ? 'dm-filter-all' : 'dm-filter-count'}>{summary}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="dm-filter-menu">
        <SheetsChecklist label={label} items={items} selected={selected} onChange={onChange} />
      </div>
    </details>
  );
}
