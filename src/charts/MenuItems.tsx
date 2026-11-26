import { type LucideIcon } from 'lucide-react';
import { EllipsisVertical } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DEFAULT_MART_ICON, PickedIcon } from '../ui/bands/picked';
import { swallowPress } from '../ui/outsidePress';
import { Panel, Row, useSubmenu } from '../ui/explorer/MenuParts';

/** One choice of a submenu. */
export type MenuOption = { value: string; label: string; icon?: LucideIcon; /** A column's description, shown as a (?) after the label. */ hint?: string };
/** The choices that belong to one data mart: a header with the mart's icon and title, then the options. */
export type MenuGroup = { title: string; /** The mart's picked icon; the default mart icon when none. */ icon?: string | null; options: MenuOption[] };

/**
 * A tick row (stays open: several can be changed in a row), an action row (closes the menu, then runs), a row opening a submenu of radio choices (closes on a choice)
 * or a row opening a submenu of other rows (a group: its check rows keep the menu open).
 * Every row has an icon. A radio's `options` come first without a header (Off, No stacking); its `groups` follow, each under its data mart's header.
 */
export type MenuItem =
  | { kind: 'check'; label: string; icon: LucideIcon; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; icon: LucideIcon; value: string; options: MenuOption[]; groups?: MenuGroup[]; onPick: (value: string) => void }
  | { kind: 'action'; label: string; icon: LucideIcon; /** A row that says why there is nothing to pick: read at full colour, reachable, and it does nothing. */ note?: boolean; onPick: () => void }
  | { kind: 'group'; label: string; icon: LucideIcon; items: MenuItem[]; /** Rows can be reordered: dragged by their ⋮, or moved with Alt+Up and Alt+Down. */ onReorder?: (from: number, to: number) => void; /** How many leading rows can be moved (the rest show a muted ⋮); all of them when unset. */ draggable?: number };

/** A menu with a check row gives every row the check column, so labels line up. */
export const hasCheck = (items: MenuItem[]) => items.some((it) => it.kind === 'check');

/** One row of a menu level. A submenu row opens its panel through `onOpen` (a click or Right) and `onHover`; the other rows only tell the level that the pointer left the open row. */
export function ItemRow({ item, slot, expanded, close, onOpen, onHover, hoverOther, leaveRow, glyph: own, style, description }: {
  item: MenuItem;
  /** Replaces the row's icon (a drag handle). */
  glyph?: ReactNode;
  style?: CSSProperties;
  description?: string;
  slot: boolean;
  expanded: boolean;
  /** Closes the whole menu. */
  close: () => void;
  onOpen: (row: HTMLElement) => void;
  onHover: (row: HTMLElement) => void;
  hoverOther: () => void;
  leaveRow: () => void;
}) {
  const glyph = own ?? <item.icon className="size-4" />;
  if (item.kind === 'check') return <Row check checkbox checked={item.checked} label={item.label} glyph={glyph} onActivate={item.onToggle} onHover={hoverOther} onLeaveRow={leaveRow} />;
  if (item.kind === 'action') return <Row slot={slot} label={item.label} glyph={glyph} note={item.note} onActivate={() => { if (item.note) return; close(); item.onPick(); }} onHover={hoverOther} onLeaveRow={leaveRow} />;
  return <Row sub slot={slot} expanded={expanded} label={item.label} description={description} style={style} glyph={glyph} onActivate={onOpen} onOpen={onOpen} onHover={onHover} onLeaveRow={leaveRow} />;
}

/** The submenu a radio or group row opens, beside its row. `onBack` closes just this level (Escape, Left); `close` closes the whole menu. */
export function ItemSubmenu({ item, anchor, seq, close, onBack }: { item: MenuItem; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  if (item.kind === 'radio') return <RadioSubmenu item={item} anchor={anchor} seq={seq} close={close} onBack={onBack} />;
  if (item.kind === 'group') return <GroupSubmenu item={item} anchor={anchor} seq={seq} close={close} onBack={onBack} />;
  return null;
}

function RadioSubmenu({ item, anchor, seq, close, onBack }: { item: Extract<MenuItem, { kind: 'radio' }>; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  // The data marts of the submenu: one mart's options on a level of their own (the third, or the fourth under a group). It closes with the submenu it hangs off.
  const marts = useSubmenu<number>();
  const groups = item.groups ?? [];
  const choice = (o: MenuOption, hover?: () => void) => (
    <Row key={o.value} check checked={o.value === item.value} label={o.label} hint={o.hint} glyph={o.icon && <o.icon className="size-4" />} onActivate={() => { item.onPick(o.value); close(); }} onHover={hover} onLeaveRow={hover && marts.leaveRow} />
  );
  return (
    <>
      <Panel anchor={anchor} mode="beside" role="menu" label={item.label} onEscape={() => (marts.sub ? marts.closeSub() : onBack())} onLeave={onBack} onTab={close} focusSeq={seq}>
        {item.options.map((o) => choice(o, marts.hoverOther))}
        {/* One mart with options needs no level of its own: its options are listed here. */}
        {groups.length === 1 && groups[0]!.options.map((o) => choice(o, marts.hoverOther))}
        {groups.length > 1 && groups.map((g, gi) => (
          <Row key={gi} sub tick checked={g.options.some((o) => o.value === item.value)} expanded={marts.sub?.key === gi} label={g.title}
            glyph={<PickedIcon icon={g.icon} fallback={DEFAULT_MART_ICON} size={16} />}
            onActivate={(r) => marts.open(gi, r, true)} onOpen={(r) => marts.open(gi, r, true)} onHover={(r) => marts.hoverRow(gi, r)} onLeaveRow={marts.leaveRow} />
        ))}
      </Panel>
      {marts.sub && groups.length > 1 && groups[marts.sub.key] && (
        <Panel anchor={marts.sub.row} mode="beside" role="menu" label={groups[marts.sub.key]!.title} onEscape={marts.closeSub} onLeave={marts.closeSub} onTab={close} focusSeq={marts.sub.seq}>
          {groups[marts.sub.key]!.options.map((o) => choice(o))}
        </Panel>
      )}
    </>
  );
}

/** How far the pointer moves before a press on a row's ⋮ becomes a drag. */
const DRAG_PX = 4;
const ROW_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
const MOVE_HINT = 'Alt+Up or Alt+Down to move';
type Press = { from: number; startY: number; started: boolean; to: number; dy: number; rows: HTMLElement[]; menu: HTMLElement; grip: HTMLElement; pointerId: number };
type Drag = { from: number; dy: number; to: number; line: number };

function GroupSubmenu({ item, anchor, seq, close, onBack }: { item: Extract<MenuItem, { kind: 'group' }>; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss } = useSubmenu<number>();
  const [placed, setPlaced] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<Press | null>(null);
  // The row a drop ended on: its hover opens nothing until the pointer has left it.
  const held = useRef<number | null>(null);
  const slot = hasCheck(item.items);
  const picked = sub ? item.items[sub.key] : undefined;
  const { onReorder } = item;
  const movable = Math.min(item.draggable ?? item.items.length, item.items.length);
  const dragging = drag !== null;
  const stop = () => {
    const p = press.current;
    press.current = null;
    try { p?.grip.releasePointerCapture?.(p.pointerId); } catch { /* the pointer is already released */ }
    setDrag(null);
  };
  // Escape cancels the drag and keeps the menu open: the menu's own Escape (close) must not see it.
  // The press is still down: its release and click are swallowed, or they would land on the row under the pointer.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); swallowPress(); if (press.current) held.current = press.current.to; stop(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging]);
  const onDown = (i: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const menu = e.currentTarget.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const rows = [...menu.querySelectorAll<HTMLElement>(ROW_ITEM)].filter((r) => r.closest('[role="menu"]') === menu).slice(0, movable);
    const grip = e.currentTarget;
    try { grip.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    press.current = { from: i, startY: e.clientY, started: false, to: i, dy: 0, rows, menu, grip, pointerId: e.pointerId };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    // The button was let go where this grip could not see it.
    if (e.buttons === 0) { stop(); return; }
    const raw = e.clientY - p.startY;
    if (!p.started) {
      if (Math.abs(raw) < DRAG_PX) return;
      p.started = true;
      // Hover intent is ignored for the drag, and an open Column submenu closes.
      dismiss();
    }
    // Measured on every move: the menu can scroll or move under the pointer.
    // The dragged row's box includes the shift it was given last move: take that out, or the offset counts twice.
    const rects = p.rows.map((r, k) => { const b = r.getBoundingClientRect(); return k === p.from ? { top: b.top - p.dy, bottom: b.bottom - p.dy } : b; });
    const here = rects[p.from]!;
    const dy = Math.min(Math.max(raw, rects[0]!.top - here.top), rects[rects.length - 1]!.bottom - here.bottom);
    // The slot follows the pointer, not the clamped row: dragging past the last row lands in the last place.
    const centre = (here.top + here.bottom) / 2 + raw;
    const to = rects.filter((r, k) => k !== p.from && (r.top + r.bottom) / 2 < centre).length;
    p.to = to;
    p.dy = dy;
    const edge = to <= p.from ? rects[to]!.top : rects[to]!.bottom;
    setDrag({ from: p.from, dy, to, line: edge - p.menu.getBoundingClientRect().top + p.menu.scrollTop });
  };
  const onUp = () => {
    const p = press.current;
    if (!p) return;
    // The slot is read from the press, not from state: a release right after a move has not re-rendered yet.
    const { from, to, started } = p;
    // The dragged column lands at `to`, under the pointer.
    if (started) held.current = to;
    stop();
    if (started && to !== from) onReorder?.(from, to);
  };
  const onKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!onReorder || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(ROW_ITEM);
    const menu = row?.closest<HTMLElement>('[role="menu"]');
    if (!row || !menu) return;
    const rows = [...menu.querySelectorAll<HTMLElement>(ROW_ITEM)].filter((r) => r.closest('[role="menu"]') === menu);
    const from = rows.indexOf(row);
    if (from < 0 || from >= movable) return;
    e.preventDefault();
    e.stopPropagation();
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= movable) return;
    onReorder(from, to);
    // The rows keep their places, so focus follows the moved column to its new row.
    rows[to]?.focus();
  };
  const grip = (it: MenuItem, i: number) => {
    const on = i < movable;
    return (
      <span data-grip="" data-off={on ? undefined : ''} className="dm-menu-grip" onMouseDown={on ? (e) => e.preventDefault() : undefined}
        onPointerDown={on ? onDown(i) : undefined} onPointerMove={on ? onMove : undefined} onPointerUp={on ? onUp : undefined} onPointerCancel={on ? stop : undefined} onLostPointerCapture={on ? stop : undefined}
        onClick={on ? (e) => e.stopPropagation() : undefined}>
        <EllipsisVertical className="size-4" />
      </span>
    );
  };
  return (
    <>
      <Panel anchor={anchor} mode="beside" role="menu" label={item.label} onEscape={() => (sub ? closeSub() : onBack())} onLeave={onBack} onTab={close} onPlaced={() => setPlaced(true)} focusSeq={seq} className={dragging ? 'dm-menu-dragging' : ''}>
        {/* One wrapper, so the group's own keys (Alt+Up and Alt+Down) are read before the panel's arrow keys. It has no box of its own. */}
        <div style={{ display: 'contents' }} onKeyDownCapture={onReorder ? onKeys : undefined}>
          {item.items.map((it, i) => {
            const moving = drag?.from === i;
            return (
              <ItemRow key={i} item={it} slot={slot} expanded={sub?.key === i} close={close} onOpen={(r) => open(i, r, true)}
                onHover={(r) => { if (!press.current?.started && held.current !== i) hoverRow(i, r); }} hoverOther={() => { if (!press.current?.started) hoverOther(); }} leaveRow={() => { if (held.current === i) held.current = null; leaveRow(); }}
                glyph={onReorder ? grip(it, i) : undefined} description={onReorder && i < movable ? MOVE_HINT : undefined}
                style={moving ? { transform: `translateY(${drag!.dy}px)`, position: 'relative', zIndex: 1, background: 'var(--menu-hover)', boxShadow: '0 1px 3px rgba(60, 64, 67, .3)' } : undefined} />
            );
          })}
        </div>
        {drag && <div data-drop-line="" aria-hidden className="dm-menu-drop" style={{ top: drag.line }} />}
      </Panel>
      {placed && sub && picked && <ItemSubmenu key={sub.key} item={picked} anchor={sub.row} seq={sub.seq} close={close} onBack={closeSub} />}
    </>
  );
}
