import { X } from 'lucide-react';
import { useState } from 'react';
import { UNIQUE_COUNT_LABEL } from '../../model/unique-count';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { fieldLabel } from '../../model/fieldLabel';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';
import { FieldHint, FieldLabel } from './FieldLabel';
import { describeFilter } from '../../filters/catalogue';
import { sliceField } from '../../filters/slice';
import type { ColumnFilter } from '../../filters/build';
import { Tooltip } from '../Tooltip';
import { ownInSchemaOrder } from '../../state/column-order';
import { describeColumnFilter, FieldMenuButton } from './ColumnMenu';

/**
 * The "N slices" and "N filters" badges after a data mart's Fields button: they show when any field of the mart (shown or not)
 * carries such a rule. A click lists the fields with their rules; the x on a badge removes all of them in one step.
 * A slice only counts on a joined mart's field, as in the column header.
 */
export function MartRuleBadges({ title, fields, filters, slices, onClearFilters, onClearSlices }: {
  title: string;
  fields: Field[];
  filters: Record<string, ColumnFilter>;
  slices: Record<string, ColumnFilter>;
  /** Removes the rules on these fields. */
  onClearFilters: (names: string[]) => void;
  onClearSlices: (names: string[]) => void;
}) {
  const filtered = fields.filter((f) => filters[f.name]);
  const sliced = fields.filter((f) => slices[f.name] && f.joined);
  const badge = (on: Field[], noun: string, describe: (f: Field) => string, clear: (names: string[]) => void) => {
    if (on.length === 0) return null;
    const label = `${on.length} ${noun}${on.length === 1 ? '' : 's'}`;
    const Noun = noun[0]!.toUpperCase() + noun.slice(1);
    return (
      <span className="dm-rule-badge" data-mart-badge={noun}>
        <Popover align="start" label={`${Noun}s in ${title}`} trigger={
          <button type="button" aria-label={`${label} in ${title}`} className="dm-rule-badge-text">{label}</button>
        }>
          <div className="dm-popover-title font-medium">{`${Noun}s in ${title}`}</div>
          <ul className="flex flex-col gap-1.5">
            {on.map((f) => (
              <li key={f.name} className="flex flex-col">
                <span className="font-medium">{fieldLabel(f)}</span>
                <span className="text-muted-foreground">{describe(f)}</span>
              </li>
            ))}
          </ul>
        </Popover>
        <Tooltip content={`Remove all ${noun}s in ${title}`}>
          <button type="button" aria-label={`Remove all ${noun}s in ${title}`} className="dm-rule-badge-x" onClick={() => clear(on.map((f) => f.name))}><X className="size-3" aria-hidden /></button>
        </Tooltip>
      </span>
    );
  };
  return <>
    {badge(sliced, 'slice', (f) => describeFilter(sliceField(f), slices[f.name]!), onClearSlices)}
    {badge(filtered, 'filter', (f) => describeColumnFilter(f, filters[f.name]!), onClearFilters)}
  </>;
}

/**
 * The columns of one data mart's tab: only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart).
 * The main mart's own fields that stay keep the order they have on the grid (the member may have dragged them); a newly
 * ticked one goes right after the nearest field before it in the schema that is shown, or first when none is, so a grid
 * that was never reordered stays in schema order. `locked` names the ticked fields that cannot be unticked.
 * `unique` is the mart's Unique Count metric, when the mart offers one (a hidden or composite key counts too): a first row toggles its column, which sits after the mart's own columns. It does not show or hide any field.
 */
export function ColumnPicker({ title, fields, main, visible, locked, onChange, unique, remove }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
  unique?: { on: boolean; onToggle: () => void };
  /** The badge's x: takes the data mart's columns (and the mart) off the grid. Absent when the mart is the only one. */
  remove?: { onRemove: () => void; disabled?: boolean };
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
  const ownInOrder = (keep: Set<string>) => ownInSchemaOrder(visible, fields.map((f) => f.name), keep);
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
  const count = `${shownNow.length} column${shownNow.length === 1 ? '' : 's'}`;
  const items: ChecklistItem[] = fields.map((f) => ({
    value: f.name,
    text: fieldLabel(f),
    label: <FieldLabel field={f} hint={false} />,
    action: <FieldMenuButton field={f} onHide={() => apply(shownNow.filter((n) => n !== f.name))} />,
    extra: <FieldHint field={f} decorative />,
    description: f.description?.trim() || undefined,
    disabled: set.has(f.name) && (visible.length === 1 || locked(f.name)),
  }));
  return (
    <span className="dm-rule-badge dm-rule-badge-neutral" data-mart-badge="column">
    <Popover align="start" open={open} onOpenChange={onOpenChange} trigger={
      <button type="button" aria-label={`Fields of ${title}`} className="dm-rule-badge-text">{count}</button>
    }>
      <div className="flex flex-col gap-2">
        <SheetsChecklist label={`Fields of ${title}`} items={items} selected={shownNow} displaying={shownNow.length} onChange={apply}
          lead={unique ? { item: { value: 'unique-count', text: UNIQUE_COUNT_LABEL }, on: unique.on, onToggle: unique.onToggle } : undefined} />
      </div>
    </Popover>
    {remove && (
      <Tooltip content={`Remove ${title} from the grid`}>
        <button type="button" aria-label={`Remove ${title} from the grid`} data-remove disabled={remove.disabled} onClick={remove.onRemove} className="dm-rule-badge-x"><X className="size-3" aria-hidden /></button>
      </Tooltip>
    )}
    </span>
  );
}
