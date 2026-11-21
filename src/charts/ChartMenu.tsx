import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, Row, useSubmenu } from '../ui/explorer/MenuParts';
import { useOutsidePress } from '../ui/outsidePress';

/** A tick row (stays open: several can be changed in a row), an action row (closes the menu, then runs) or a row opening a submenu of radio choices (closes on a choice). */
export type MenuItem =
  | { kind: 'check'; label: string; icon?: LucideIcon; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; value: string; options: { value: string; label: string; icon?: LucideIcon }[]; onPick: (value: string) => void }
  | { kind: 'action'; label: string; onPick: () => void };

/** The ⋮ button of a chart and its menu, built from the same panel and rows as the column menu. */
export function ChartMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss } = useSubmenu<number>();
  const [placed, setPlaced] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const close = useCallback((refocus = true) => { dismiss(); setAnchor(null); setPlaced(false); if (refocus) button.current?.focus(); }, [dismiss]);
  useEffect(() => {
    if (!anchor) return;
    // A scroll of anything that holds the button closes it too (a fixed menu would be left behind), as the column menu does.
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.('[data-column-menu]')) return;
      const h = holder.current;
      if (t === document || (t instanceof Node && h && t.contains(h))) close(false);
    };
    window.addEventListener('scroll', away, true);
    return () => window.removeEventListener('scroll', away, true);
  }, [anchor, close]);
  // A press outside the menu only closes it, as the column menu does.
  useOutsidePress(!!anchor, (t) => !!t.closest('[data-column-menu]') || !!holder.current?.contains(t), () => close(false));
  const picked = sub ? items[sub.key] : undefined;
  return (
    <span ref={holder} className="inline-flex">
      <button ref={button} type="button" aria-label={`${name} options`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => (anchor ? close(false) : setAnchor(e.currentTarget))}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
        <EllipsisVertical className="size-4" aria-hidden />
      </button>
      {anchor && (
        <Panel anchor={anchor} mode="below" role="menu" label={`${name} menu`} onEscape={() => (sub ? closeSub() : close())} onTab={() => close()} onPlaced={() => setPlaced(true)} focusSeq={1} className="dm-menu-root">
          {items.map((it, i) => it.kind === 'check' ? (
            <Row key={i} check checkbox checked={it.checked} label={it.label} glyph={it.icon && <it.icon className="size-4" />} onActivate={it.onToggle} onHover={hoverOther} onLeaveRow={leaveRow} />
          ) : it.kind === 'action' ? (
            <Row key={i} label={it.label} onActivate={() => { close(); it.onPick(); }} onHover={hoverOther} onLeaveRow={leaveRow} />
          ) : (
            <Row key={i} sub expanded={sub?.key === i} label={it.label} onActivate={(r) => open(i, r, true)} onOpen={(r) => open(i, r, true)}
              onHover={(r) => hoverRow(i, r)} onLeaveRow={leaveRow} />
          ))}
        </Panel>
      )}
      {anchor && placed && sub && picked?.kind === 'radio' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={picked.label} onEscape={closeSub} onLeave={closeSub} onTab={() => close()} focusSeq={sub.seq}>
          {picked.options.map((o) => <Row key={o.value} check checked={o.value === picked.value} label={o.label} glyph={o.icon && <o.icon className="size-4" />} onActivate={() => { picked.onPick(o.value); close(); }} />)}
        </Panel>
      )}
    </span>
  );
}
