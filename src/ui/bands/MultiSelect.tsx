import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutsidePress } from '../outsidePress';
import { num } from '../format';
import type { Mark } from '../storage-icons';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';

type MultiOption = { value: string; label: string; count?: number; icon?: Mark };

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
  // `<details name>` closes the other menu when one opens; nothing but this closes the last one when the pointer goes elsewhere.
  // The press that does it goes no further: it closes the menu and nothing under the pointer acts. Listening only while this one is open.
  const menu = useRef<HTMLDetailsElement>(null);
  const [shown, setShown] = useState(false);
  useOutsidePress(shown, (t) => !!menu.current?.contains(t), () => { if (menu.current) menu.current.open = false; });

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
    <details ref={menu} className="dm-filter" name="dm-filter" onToggle={(e) => setShown(e.currentTarget.open)}>
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
