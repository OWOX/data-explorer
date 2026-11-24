import { Columns3, Funnel, Layers, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useState, type ButtonHTMLAttributes } from 'react';
import { UNIQUE_COUNT_LABEL } from '../../model/unique-count';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { fieldLabel } from '../../model/fieldLabel';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';
import { FieldHint, FieldLabel } from './FieldLabel';
import type { ColumnFilter } from '../../filters/build';
import { Tooltip } from '../Tooltip';
import { ownInSchemaOrder } from '../../state/column-order';
import { FieldMenuButton, RuleListMenu } from './ColumnMenu';

/** Focuses a badge's button of this title cell once the cell has been rebuilt: the named kind when it is still there, else the "N columns" button (a cleared badge is gone). */
function focusBadge(from: HTMLElement | null, kind: string) {
  const cell = from?.closest('th');
  window.setTimeout(() => { if (cell?.isConnected) (cell.querySelector<HTMLElement>(`[data-mart-badge="${kind}"] .dm-rule-badge-text`) ?? cell.querySelector<HTMLElement>('[data-mart-badge="column"] .dm-rule-badge-text'))?.focus(); }, 0);
}

/** A badge's text button: its icon at rest; hover, focus or an open list widens the badge to the label (CSS). The accessible name is the label either way. */
const BadgeText = forwardRef<HTMLButtonElement, { icon: LucideIcon; label: string; aria: string } & ButtonHTMLAttributes<HTMLButtonElement>>(function BadgeText({ icon: Icon, label, aria, ...rest }, ref) {
  return <button ref={ref} type="button" aria-label={aria} className="dm-rule-badge-text" {...rest}><Icon className="dm-badge-icon size-3" aria-hidden /><span className="dm-badge-label">{label}</span></button>;
});

/**
 * The "N slices" and "N filters" badges after a data mart's Fields button: they show when any field of the mart (shown or not)
 * carries such a rule. A click lists the fields with their rules (hover one to edit it); the x on a badge removes all of them in one step.
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
  const [menu, setMenu] = useState<'filter' | 'slice' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const filtered = fields.filter((f) => filters[f.name]);
  const sliced = fields.filter((f) => slices[f.name] && f.joined);
  // A list whose rules are all gone (Undo) closes: Redo must not bring the badge back with it open on a detached anchor.
  if (menu && (menu === 'filter' ? filtered : sliced).length === 0) setMenu(null);
  const badge = (kind: 'filter' | 'slice', on: Field[], clear: (names: string[]) => void) => {
    if (on.length === 0) return null;
    const noun = kind;
    const label = `${on.length} ${noun}${on.length === 1 ? '' : 's'}`;
    const open = menu === kind && !!anchor?.isConnected;
    return (
      <span className="dm-rule-badge" data-mart-badge={noun}>
        <BadgeText icon={kind === 'filter' ? Funnel : Layers} label={label} aria={`${label} in ${title}`} aria-haspopup="menu" aria-expanded={open}
          onClick={(e) => { const a = e.currentTarget; if (open) setMenu(null); else { setAnchor(a); setMenu(kind); } }} />
        <Tooltip content={`Remove all ${noun}s in ${title}`}>
          <button type="button" aria-label={`Remove all ${noun}s in ${title}`} className="dm-rule-badge-x" onClick={(e) => { const x = e.currentTarget; setMenu(null); clear(on.map((f) => f.name)); focusBadge(x, 'column'); }}><X className="size-3" aria-hidden /></button>
        </Tooltip>
        {open && <RuleListMenu kind={kind} title={title} fields={on} anchor={anchor!} onClose={() => { setMenu(null); focusBadge(anchor, kind); }} onDismiss={() => setMenu(null)} />}
      </span>
    );
  };
  return <>
    {badge('slice', sliced, onClearSlices)}
    {badge('filter', filtered, onClearFilters)}
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
export function ColumnPicker({ title, fields, main, visible, locked, onChange, unique, remove, columns }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
  unique?: { on: boolean; onToggle: () => void };
  /** The badge's x: takes the data mart's columns (and the mart) off the grid. Absent when the mart is the only one. */
  remove?: { onRemove: () => void; disabled?: boolean };
  /** The outputs under the mart's header (its group's span: the Unique Count and every function column count). Absent, the shown fields are counted. */
  columns?: number;
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
  const n = emptied ? 0 : columns ?? shownNow.length;
  const count = `${n} column${n === 1 ? '' : 's'}`;
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
      <BadgeText icon={Columns3} label={count} aria={`Fields of ${title}: ${count}`} />
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
