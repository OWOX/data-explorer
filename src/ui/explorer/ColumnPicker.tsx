import { Columns3, Funnel, Layers } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
 * The green Filter and Slice marks after a data mart's title: they show when any field of the mart (shown or not) carries
 * such a rule, and their tooltip lists the rules one per line. A click opens the mart's Fields list.
 * A slice only counts on a joined mart's field, as in the column header.
 */
export function MartRuleMarks({ title, fields, filters, slices, expanded, onOpen }: {
  title: string;
  fields: Field[];
  filters: Record<string, ColumnFilter>;
  slices: Record<string, ColumnFilter>;
  /** The mart's Fields list is open. */
  expanded: boolean;
  onOpen: (mark: HTMLElement) => void;
}) {
  const filterLines = fields.filter((f) => filters[f.name]).map((f) => `Filter: ${describeColumnFilter(f, filters[f.name]!)}`);
  const sliceLines = fields.filter((f) => slices[f.name] && f.joined).map((f) => `Slice: ${describeFilter(sliceField(f), slices[f.name]!)}`);
  const mark = (lines: string[], label: string, icon: ReactNode) => lines.length > 0 && (
    <Tooltip content={<span className="dm-tip-lines dm-tip-plain">{lines.map((l) => <span key={l}>{l}</span>)}</span>}>
      <button type="button" data-mart-mark={label.toLowerCase()} aria-label={`${label} rules in ${title}`} aria-haspopup="dialog" aria-expanded={expanded} className="dm-ctl dm-ctl-on dm-reveal dm-reveal-on" onClick={(e) => onOpen(e.currentTarget)}>{icon}</button>
    </Tooltip>
  );
  return <>{mark(filterLines, 'Filter', <Funnel className="dm-icon" aria-hidden />)}{mark(sliceLines, 'Slice', <Layers className="dm-icon" aria-hidden />)}</>;
}

/**
 * The columns of one data mart's tab: only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart).
 * The main mart's own fields that stay keep the order they have on the grid (the member may have dragged them); a newly
 * ticked one goes right after the nearest field before it in the schema that is shown, or first when none is, so a grid
 * that was never reordered stays in schema order. `locked` names the ticked fields that cannot be unticked.
 * `unique` is the mart's Unique Count metric, when the mart offers one (a hidden or composite key counts too): a first row toggles its column, which sits after the mart's own columns. It does not show or hide any field.
 */
export function ColumnPicker({ title, fields, main, visible, locked, onChange, unique, open: openProp, onOpenChange: onOpenProp, onCloseAutoFocus }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
  unique?: { on: boolean; onToggle: () => void };
  /** Lets the grid open the list from outside (a click on a rule mark). */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** Lets the grid take over where focus goes when the list closes. */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const set = new Set(visible);
  const mine = new Set(fields.map((f) => f.name));
  // A joined mart whose last field is unticked stays on the grid while the popup is open (Clear, then a new tick, keeps it); it leaves when the popup closes with nothing ticked.
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const [emptied, setEmptied] = useState(false);
  const apply = (picked: string[]) => {
    if (!main && picked.length === 0) { setEmptied(true); return; }
    setEmptied(false);
    commit(picked);
  };
  const onOpenChange = (o: boolean) => {
    setOwnOpen(o);
    onOpenProp?.(o);
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
    <Popover align="start" onCloseAutoFocus={onCloseAutoFocus} open={open} onOpenChange={onOpenChange} trigger={
      <button type="button" aria-label={`Fields of ${title}`} className="dm-ctl dm-ctl-lg dm-reveal"><Columns3 className="dm-icon" aria-hidden /></button>
    }>
      <div className="flex flex-col gap-2">
        <SheetsChecklist label={`Fields of ${title}`} items={items} selected={shownNow} displaying={shownNow.length} onChange={apply}
          lead={unique ? { item: { value: 'unique-count', text: UNIQUE_COUNT_LABEL }, on: unique.on, onToggle: unique.onToggle } : undefined} />
      </div>
    </Popover>
  );
}
