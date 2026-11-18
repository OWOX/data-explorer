import { Columns3 } from 'lucide-react';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { fieldLabel } from '../../model/fieldLabel';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';
import { FieldHint, FieldLabel } from './FieldLabel';

/**
 * The columns of one data mart's tab: only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart);
 * the main mart's own fields keep the schema's order. `locked` names the ticked fields that cannot be unticked.
 */
export function ColumnPicker({ title, fields, main, visible, locked, onChange }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
}) {
  const set = new Set(visible);
  const mine = new Set(fields.map((f) => f.name));
  const ticked = fields.filter((f) => set.has(f.name)).length;
  const apply = (picked: string[]) => {
    const keep = new Set(picked);
    const others = visible.filter((c) => !mine.has(c));
    let next = main
      ? [...fields.map((f) => f.name).filter((n) => keep.has(n)), ...others]
      : [...visible.filter((c) => !mine.has(c) || keep.has(c)), ...picked.filter((n) => !set.has(n))];
    // Clear never leaves the grid without a column.
    if (next.length === 0) next = visible.slice(0, 1);
    onChange(next);
  };
  const items: ChecklistItem[] = fields.map((f) => ({
    value: f.name,
    text: fieldLabel(f),
    label: <FieldLabel field={f} hint={false} />,
    extra: <FieldHint field={f} />,
    disabled: set.has(f.name) && (visible.length === 1 || locked(f.name)),
  }));
  return (
    <Popover align="start" tip="Fields" trigger={
      <button type="button" aria-label={`Fields of ${title}`} className="dm-ctl dm-ctl-lg dm-reveal"><Columns3 className="dm-icon" aria-hidden /></button>
    }>
      <div className="flex flex-col gap-2">
        <p className="dm-popover-title text-xs font-medium text-muted-foreground">Fields · {ticked}/{fields.length}</p>
        <SheetsChecklist label={`Fields of ${title}`} items={items} selected={visible.filter((c) => mine.has(c))} onChange={apply} />
      </div>
    </Popover>
  );
}
