import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, Row, useSubmenu } from '../ui/explorer/MenuParts';
import { useOutsidePress } from '../ui/outsidePress';

/** A tick row (stays open: several can be changed in a row), an action row (closes the menu, then runs) or a row opening a submenu of radio choices (closes on a choice). */
export type MenuItem =
  | { kind: 'check'; label: string; icon?: LucideIcon; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; value: string; options: { value: string; label: string; icon?: LucideIcon }[]; onPick: (value: string) => void }
  | { kind: 'action'; label: string; onPick: () => void };

/** How long after the panel last changed size a scroll is still taken to come from the resize. */
const RESIZE_GRACE_MS = 150;

/** The ⋮ button of a chart and its menu, built from the same panel and rows as the column menu. */
export function ChartMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss } = useSubmenu<number>();
  const [placed, setPlaced] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const close = useCallback((refocus = true) => { dismiss(); setAnchor(null); setPlaced(false); if (refocus) button.current?.focus(); }, [dismiss]);
  // The chart panel animates its size after a setting change (a reopened menu meets it mid-way): the menu follows its button instead of closing.
  const [, follow] = useState(0);
  useEffect(() => {
    if (!anchor) return;
    const panel = holder.current?.closest('[data-chart-kind]') ?? null;
    // The scroll that follows the last frame of a resize arrives a frame after the transition has ended: it still counts as the resize's.
    let lastSize = Number.NEGATIVE_INFINITY;
    const resizing = () => performance.now() - lastSize < RESIZE_GRACE_MS || (!!panel && typeof panel.getAnimations === 'function' && panel.getAnimations({ subtree: true }).some((a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && a.playState === 'running'));
    // Where everything that holds the button was scrolled to when the menu opened: a scroll event that arrives with the same offset is the echo of a
    // change made just before (a panel that shrank clamped its box), not the member scrolling.
    const offsets = new Map<Node, string>();
    const at = (n: Node) => (n === document ? `${window.scrollX},${window.scrollY}` : `${(n as Element).scrollLeft},${(n as Element).scrollTop}`);
    for (let n: Node | null = holder.current; n; n = n.parentNode) offsets.set(n, at(n));
    // A scroll of anything that holds the button closes it too (a fixed menu would be left behind), as the column menu does.
    // A scroll that only comes from the panel changing size (the box it scrolls in is clamped as it shrinks) is not the member scrolling.
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.('[data-column-menu]')) return;
      const h = holder.current;
      if (t === document || (t instanceof Node && h && t.contains(h))) { if (resizing() || (t !== null && offsets.get(t as Node) === at(t as Node))) follow((n) => n + 1); else close(false); }
    };
    window.addEventListener('scroll', away, true);
    // Each frame of the resize moves the button: the menu is placed again from it.
    // The first callback comes on observe, not from a resize: it must not make a real scroll right after opening look like the resize's echo.
    let seen = false;
    const ro = panel && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!seen) { seen = true; return; } lastSize = performance.now(); follow((n) => n + 1); }) : null;
    if (panel) ro?.observe(panel);
    return () => { window.removeEventListener('scroll', away, true); ro?.disconnect(); };
  }, [anchor, close]);
  // A press outside the menu only closes it, as the column menu does.
  useOutsidePress(!!anchor, (t) => !!t.closest('[data-column-menu]') || !!holder.current?.contains(t), () => close(false));
  const picked = sub ? items[sub.key] : undefined;
  return (
    <span ref={holder} className="inline-flex">
      <button ref={button} type="button" aria-label={`${name} options`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => (anchor ? close(false) : setAnchor(e.currentTarget))}
        className="dm-menu-dots inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
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
