import { Funnel, Layers, Sigma, type LucideIcon } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import type { ColumnFilter } from '../../filters/build';
import { describeFilter } from '../../filters/catalogue';
import { sliceField } from '../../filters/slice';
import { AGG_LABELS, BUCKET_LABELS } from '../../model/aggregation';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { Tooltip } from '../Tooltip';
import { ColumnMenuEnvContext, RuleListMenu, describeColumnFilter, type RuleEntry, type RuleKind } from './ColumnMenu';
import type { ConfigMart } from './MartFields';

/** The data mart a badge's list names its fields under: the report's marts in grid order, then the ones that only hold a leftover rule. */
export type RuleMart = Pick<ConfigMart, 'path' | 'title' | 'icon' | 'fields'>;

const KINDS: { kind: RuleKind; icon: LucideIcon; one: string; many: string }[] = [
  { kind: 'filter', icon: Funnel, one: 'filter', many: 'filters' },
  { kind: 'slice', icon: Layers, one: 'slice', many: 'slices' },
  { kind: 'aggregate', icon: Sigma, one: 'aggregation', many: 'aggregations' },
];

/**
 * The "N filters", "N slices" and "N aggregations" badges next to the config button: each shows when any field of the grid carries such a rule (shown or not), and counts fields.
 * Hovering one shows its rules in a tooltip, one per line. A click lists them; a field row opens its editor, and the list's last row removes them all. A filter on a field the grid does not offer (parked) is counted and listed by its name.
 * A slice only counts on a joined field, as in the column header; an aggregation only on a shown column.
 */
export function RuleBadges({ marts, filters, slices, offered, onRemove }: {
  marts: RuleMart[];
  /** Every filter and slice the member has, applied or parked, by field name. */
  filters: Record<string, ColumnFilter>;
  slices: Record<string, ColumnFilter>;
  /** Whether the grid offers the field (it is in the schema): a rule on one that is not is parked. */
  offered: (name: string) => boolean;
  /** Removes every rule of the kind, as one step. */
  onRemove: (kind: RuleKind) => void;
}) {
  const env = useContext(ColumnMenuEnvContext);
  const [menu, setMenu] = useState<RuleKind | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const has = (kind: RuleKind, f: Field) => (kind === 'filter' ? !!filters[f.name] : kind === 'slice' ? !!slices[f.name] && !!f.joined : env.isAggregated(f.name));
  const entriesOf = (kind: RuleKind): RuleEntry[] => {
    const own = marts.flatMap((m) => m.fields.filter((f) => has(kind, f)).map((f): RuleEntry => ({ key: f.name, martTitle: m.title, icon: m.icon, field: f, label: f.name })));
    if (kind === 'aggregate') return own;
    const parked = Object.keys(kind === 'filter' ? filters : slices).filter((n) => !offered(n)).map((n): RuleEntry => ({ key: n, martTitle: '', icon: null, field: null, label: n }));
    return [...own, ...parked];
  };
  /** One line of a badge's tooltip: "data mart · field: what the rule does". A parked rule is named by its field alone. */
  const lineOf = (kind: RuleKind, e: RuleEntry): string => {
    const f = e.field;
    if (!f) return e.label;
    const what = kind === 'filter' ? describeColumnFilter(f, filters[f.name]!)
      : kind === 'slice' ? describeFilter(sliceField(f), slices[f.name]!)
        : (() => { const d = env.draftOf(f.name); return d.bucket ? `by ${BUCKET_LABELS[d.bucket].toLowerCase()}` : d.functions.map((fn) => AGG_LABELS[fn]).join(', '); })();
    return `${e.martTitle} · ${fieldLabel(f)}: ${what}`;
  };
  const entries = Object.fromEntries(KINDS.map((k) => [k.kind, entriesOf(k.kind)])) as Record<RuleKind, RuleEntry[]>;
  // A list whose rules are all gone (Undo) closes: Redo must not bring the badge back with it open on a detached anchor.
  if (menu && entries[menu].length === 0) setMenu(null);
  /** Focuses the badge, or the config button when the badge is gone (its rules were all removed). */
  const focusBack = (from: HTMLElement | null, after?: RuleKind) => {
    window.setTimeout(() => {
      const row = holder.current;
      if (!row) return;
      const badges = [...row.querySelectorAll<HTMLElement>('[data-rule-badge]')];
      const next = after ? badges.find((b) => KINDS.findIndex((k) => k.kind === b.dataset.ruleBadge) > KINDS.findIndex((k) => k.kind === after)) ?? badges[0] : from?.isConnected ? from : undefined;
      (next ?? row.parentElement?.querySelector<HTMLElement>('[data-config-button]') ?? document.querySelector<HTMLElement>('[data-config-button]'))?.focus();
    }, 0);
  };
  return (
    <span ref={holder} className="dm-rule-badges">
      {KINDS.map(({ kind, icon: Icon, one, many }) => {
        const list = entries[kind];
        if (list.length === 0) return null;
        const open = menu === kind && !!anchor?.isConnected;
        return (
          <span key={kind} className="inline-flex">
            {/* The tooltip lists the rules, one per line; it stays shut while the badge's list is open. */}
            <Tooltip side="bottom" content={open ? null : <div className="flex flex-col">{list.map((e) => <span key={e.key}>{lineOf(kind, e)}</span>)}</div>}>
              <button type="button" className="dm-rule-badge" data-rule-badge={kind} aria-haspopup="menu" aria-expanded={open}
                onClick={(e) => { const a = e.currentTarget; if (open) setMenu(null); else { setAnchor(a); setMenu(kind); } }}>
                <Icon className="size-3" aria-hidden />{list.length} {list.length === 1 ? one : many}
              </button>
            </Tooltip>
            {open && <RuleListMenu kind={kind} entries={list} anchor={anchor!} onClose={() => { setMenu(null); focusBack(anchor); }} onDismiss={() => setMenu(null)}
              onRemove={() => { const a = anchor; setMenu(null); onRemove(kind); focusBack(a, kind); }} />}
          </span>
        );
      })}
    </span>
  );
}
