import { Columns3 } from 'lucide-react';
import { useState } from 'react';
import { UNIQUE_COUNT_LABEL } from '../../model/unique-count';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { fieldLabel } from '../../model/fieldLabel';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';
import { FieldHint, FieldLabel } from './FieldLabel';

/**
 * The columns of one data mart's tab: only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart).
 * The main mart's own fields that stay keep the order they have on the grid (the member may have dragged them); a newly
 * ticked one goes right after the nearest field before it in the schema that is shown, or first when none is, so a grid
 * that was never reordered stays in schema order. `locked` names the ticked fields that cannot be unticked.
 * `unique` is the mart's Unique Count metric, when the mart offers one (a hidden or composite key counts too): a first row toggles its column, which sits after the mart's own columns. It does not show or hide any field.
 */
export function ColumnPicker({ title, fields, main, visible, locked, onChange, unique }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
  unique?: { on: boolean; onToggle: () => void };
}) {
  const set = new Set(visible);
  const mine = new Set(fields.map((f) => f.name));
  // A joined mart whose last field is unticked stays on the grid while the popup is open (Clear, then a new tick, keeps it); it leaves when the popup closes with nothing ticked.
  const [open, setOpen] = useState(false);
  const [emptied, setEmptied] = useState(false);
  const apply = (picked: string[]) => {
    if (!main && picked.length === 0) { setEmptied(true); return; }
    setEmptied(false);
    commit(picked);
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o && emptied) { setEmptied(false); commit([]); }
  };
  const ownInOrder = (keep: Set<string>) => {
    const schema = fields.map((f) => f.name);
    const own = visible.filter((c) => mine.has(c) && keep.has(c));
    for (const n of schema.filter((x) => keep.has(x) && !set.has(x))) {
      let at = 0;
      for (let j = schema.indexOf(n) - 1; j >= 0; j--) {
        const k = own.indexOf(schema[j]!);
        if (k >= 0) { at = k + 1; break; }
      }
      own.splice(at, 0, n);
    }
    return own;
  };
  const commit = (picked: string[]) => {
    const keep = new Set(picked);
    const others = visible.filter((c) => !mine.has(c));
    let next = main
      ? [...ownInOrder(keep), ...others]
      : [...visible.filter((c) => !mine.has(c) || keep.has(c)), ...picked.filter((n) => !set.has(n))];
    // Clear never leaves the grid without a column.
    if (next.length === 0) next = visible.slice(0, 1);
    onChange(next);
  };
  const shownNow = emptied ? [] : visible.filter((c) => mine.has(c));
  const items: ChecklistItem[] = fields.map((f) => ({
    value: f.name,
    text: fieldLabel(f),
    label: <FieldLabel field={f} hint={false} />,
    extra: <FieldHint field={f} decorative />,
    description: f.description?.trim() || undefined,
    disabled: set.has(f.name) && (visible.length === 1 || locked(f.name)),
  }));
  return (
    <Popover align="start" tip="Fields" open={open} onOpenChange={onOpenChange} trigger={
      <button type="button" aria-label={`Fields of ${title}`} className="dm-ctl dm-ctl-lg dm-reveal"><Columns3 className="dm-icon" aria-hidden /></button>
    }>
      <div className="flex flex-col gap-2">
        <SheetsChecklist label={`Fields of ${title}`} items={items} selected={shownNow} displaying={shownNow.length} onChange={apply}
          lead={unique ? { item: { value: 'unique-count', text: UNIQUE_COUNT_LABEL }, on: unique.on, onToggle: unique.onToggle } : undefined} />
      </div>
    </Popover>
  );
}
