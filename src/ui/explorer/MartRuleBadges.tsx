import { Funnel, Layers, type LucideIcon } from 'lucide-react';
import { forwardRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Field } from '../../model/types';
import type { ColumnFilter } from '../../filters/build';
import { RuleListMenu } from './ColumnMenu';

/** Focuses a badge's button of this title cell once the cell has been rebuilt: the named kind when it is still there, else the config button (a cleared badge is gone). */
function focusBadge(from: HTMLElement | null, kind: string | null) {
  const cell = from?.closest('th');
  window.setTimeout(() => { if (cell?.isConnected) ((kind && cell.querySelector<HTMLElement>(`[data-mart-badge="${kind}"] .dm-rule-badge-text`)) || document.querySelector<HTMLElement>('[data-config-button]'))?.focus(); }, 0);
}

/** A badge's text button: its icon at rest; hover, focus or an open list widens the badge to the label (CSS). The accessible name is the label either way. */
const BadgeText = forwardRef<HTMLButtonElement, { icon: LucideIcon; label: string; aria: string } & ButtonHTMLAttributes<HTMLButtonElement>>(function BadgeText({ icon: Icon, label, aria, ...rest }, ref) {
  return <button ref={ref} type="button" aria-label={aria} className="dm-rule-badge-text" {...rest}><Icon className="dm-badge-icon size-3" aria-hidden /><span className="dm-badge-label">{label}</span></button>;
});

/**
 * The "N slices" and "N filters" badges after a data mart's title: they show when any field of the mart (shown or not)
 * carries such a rule. A click lists the fields with their rules (hover one to edit it); the list's Clear removes all of them in one step.
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
        {open && <RuleListMenu kind={kind} title={title} fields={on} anchor={anchor!} onClose={() => { setMenu(null); focusBadge(anchor, kind); }} onDismiss={() => setMenu(null)}
          onClear={() => { const a = anchor; setMenu(null); clear(on.map((f) => f.name)); focusBadge(a, kind === 'filter' ? 'slice' : 'filter'); }} />}
      </span>
    );
  };
  return <>
    {badge('slice', sliced, onClearSlices)}
    {badge('filter', filtered, onClearFilters)}
  </>;
}
