import { Check, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useLatest } from '../useLatest';
import { rovingTarget } from '../roving';
import { Hint } from '../Tooltip';
import { placeBeside, placeBelow, type Place } from './menuPlacement';

/** How long the pointer rests on another row before its submenu replaces the open one. */
export const HOVER_MS = 120;
/** One pending hover switch: a new one replaces the last, and `clear` drops it. */
class HoverIntent {
  private timer: ReturnType<typeof setTimeout> | undefined;
  after(ms: number, fn: () => void) { this.clear(); this.timer = setTimeout(fn, ms); }
  clear() { clearTimeout(this.timer); this.timer = undefined; }
}

/** Whether a field in one of the panels matching `selector` has been edited or holds focus: hover intent then leaves it open. */
export const panelBeingEdited = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].some((p) => 'edited' in p.dataset || (p.contains(document.activeElement) && !!document.activeElement?.matches('input, select, textarea')));

type SubOpen<K> = { key: K; row: HTMLElement; seq: number };

/**
 * The open submenu of a menu and the hover intent that switches it. A submenu is replaced only after the pointer has rested on
 * another row for HOVER_MS, and never while `isEditing` says a field in the open one is being edited. A click or a key switches at once.
 * `onReset` runs whenever the open submenu is replaced or closed, so a menu can drop state that hangs off it. With `holdClosed`, a
 * submenu closed by the keyboard stays closed until the pointer has left its row.
 */
export function useSubmenu<K extends string | number>({ isEditing = () => false, onReset, holdClosed = false }: { isEditing?: () => boolean; onReset?: () => void; holdClosed?: boolean } = {}) {
  const [sub, setSub] = useState<SubOpen<K> | null>(null);
  const [intent] = useState(() => new HoverIntent());
  useEffect(() => () => intent.clear(), [intent]);
  const closedRow = useRef<HTMLElement | null>(null);
  // The callbacks that must keep one identity read the latest sub and reset through refs.
  const subRef = useLatest(sub);
  const onResetRef = useLatest(onReset);
  const open = (key: K, row: HTMLElement, focus: boolean) => {
    intent.clear();
    closedRow.current = null;
    onReset?.();
    setSub((cur) => ({ key, row, seq: focus ? (cur?.key === key ? cur.seq : 0) + 1 : cur?.key === key ? cur.seq : 0 }));
  };
  const later = (apply: () => void) => intent.after(HOVER_MS, () => { if (!isEditing()) apply(); });
  const hoverRow = (key: K, row: HTMLElement) => {
    if (holdClosed && closedRow.current === row) return;
    if (sub?.key === key) intent.clear();
    else if (!sub) open(key, row, false);
    else later(() => open(key, row, false));
  };
  const hoverOther = () => { if (sub) later(() => { onReset?.(); setSub(null); }); };
  const leaveRow = () => { intent.clear(); closedRow.current = null; };
  const closeSub = useCallback(() => {
    const row = subRef.current?.row;
    if (holdClosed) closedRow.current = row ?? null;
    onResetRef.current?.();
    setSub(null);
    row?.focus();
  }, [holdClosed, subRef, onResetRef]);
  /** Drops the open submenu and any pending hover without moving focus. */
  const dismiss = useCallback(() => { intent.clear(); closedRow.current = null; setSub(null); }, [intent]);
  return { sub, setSub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss };
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const boxOf = (el: HTMLElement) => el.getBoundingClientRect();
const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * One floating panel of the menu, drawn in a portal on the body and kept inside the viewport (flipped left or up when it has no room).
 * Escape, and for a submenu Left, are handled here: the deepest open panel takes the key, so Escape closes the submenu first, then the menu.
 */
export function Panel({ anchor, mode, role, label, onEscape, onLeave, onTab, onPlaced, pinned, returnTo, focusSeq, form, config, matchWidth, className = '', children }: { anchor: HTMLElement; mode: 'below' | 'beside'; /** None for a plain container (a suggestion list holds its own listbox); it then takes no label either. */ role?: 'menu' | 'dialog'; label?: string; onEscape: () => void; onLeave?: () => void; /** Tab in a menu closes it (the editors keep their own Tab order). */ onTab?: () => void; /** Called once the panel has its place, so a submenu can be measured from its rows. */ onPlaced?: () => void; /** The panel keeps the place its anchor had when it opened (a band above may grow and push the anchor down); a window resize takes it afresh. */ pinned?: boolean; /** A submenu in a dialog keeps Tab inside the dialog's order: Tab past its last control, or Shift+Tab before its first, returns focus to this row. */ returnTo?: HTMLElement; focusSeq: number; /** The panel holds a form: a click or a focus in it counts as an edit, so hover intent leaves it open. */ form?: boolean; /** A panel of the config menu: its controls and edits are its own, not those of a column menu opened from one of its rows. */ config?: boolean; /** The panel is as wide as its anchor (a suggestion list under its input). */ matchWidth?: boolean; className?: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Place | null>(null);
  const held = useRef<DOMRect | null>(null);
  const place = useCallback((fresh = false) => {
    const node = el.current;
    if (!node) return;
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const box = pinned && !fresh && held.current ? held.current : boxOf(anchor);
    held.current = box;
    const next = (mode === 'below' ? placeBelow : placeBeside)(box, size, viewport());
    setPos((cur) => (cur && cur.left === next.left && cur.top === next.top && cur.side === next.side ? cur : next));
  }, [anchor, mode, pinned]);
  useLayoutEffect(() => { place(); });
  const placedNow = pos !== null;
  useLayoutEffect(() => { if (placedNow) onPlaced?.(); }, [placedNow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // The listeners run root first (a submenu mounts after its parent), and each commits its place at once: a submenu measures its row, which has moved by then.
    const onResize = () => flushSync(() => place(true));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [place]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !el.current) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [place]);
  useEffect(() => {
    if (!focusSeq || !pos) return;
    // The first row that can take focus; a panel with nothing focusable takes it itself, so focus never falls back to the page.
    const first = [...(el.current?.querySelectorAll<HTMLElement>(`${ITEM}, input, select, button`) ?? [])].find((n) => !(n as HTMLButtonElement).disabled);
    (first ?? el.current)?.focus({ preventScroll: true });
  }, [focusSeq, pos !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    if (e.key === 'Tab' && returnTo && (e.target as HTMLElement).closest('[data-column-menu]') === e.currentTarget) {
      const tabbable = [...e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex="0"]')].filter((n) => !(n as HTMLButtonElement).disabled && n.tabIndex >= 0);
      // A control that is not a Tab stop (a field's menu icon, reached with Arrow Right) sits where it is in the page order.
      const t = e.target as HTMLElement;
      const at = tabbable.indexOf(t);
      const before = at >= 0 ? at : tabbable.filter((n) => t.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING).length;
      const after = at >= 0 ? tabbable.length - 1 - at : tabbable.filter((n) => t.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING).length;
      if (e.shiftKey ? before === 0 : after === 0) { e.preventDefault(); e.stopPropagation(); returnTo.focus(); }
      return;
    }
    if (e.key === 'Tab' && role === 'menu' && onTab && (e.target as HTMLElement).closest('[data-column-menu]') === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onTab(); return; }
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
    // A submenu with no row to focus has the focus itself: Left still goes back.
    if (!item && e.key === 'ArrowLeft' && onLeave && role === 'menu' && e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onLeave(); return; }
    // Arrow keys move through this panel's own rows; a field inside a form keeps its keys.
    // A dialog panel may hold a role="menu" list of rows (the date filter's presets): its arrows work the same.
    const list = item?.closest<HTMLElement>('[role="menu"]');
    if (!item || !list || (role === 'menu' ? list !== e.currentTarget : !e.currentTarget.contains(list))) return;
    const items = [...list.querySelectorAll<HTMLElement>(ITEM)].filter((n) => n.closest('[role="menu"]') === list && !(n as HTMLButtonElement).disabled);
    const at = items.indexOf(item);
    const to = rovingTarget(e.key, at, items.length);
    if (to !== null) { e.preventDefault(); e.stopPropagation(); items[to]?.focus(); }
    else if (e.key === 'ArrowLeft' && onLeave && role === 'menu') { e.preventDefault(); e.stopPropagation(); onLeave(); }
  };
  return createPortal(
    <div ref={el} role={role} aria-label={role ? label : undefined} tabIndex={-1} data-column-menu="" data-form={form ? '' : undefined} data-config-panel={config ? '' : undefined} data-side={pos?.side} onKeyDown={onKeyDown} onInput={() => { if (el.current) el.current.dataset.edited = ''; }} onChange={() => { if (el.current) el.current.dataset.edited = ''; }}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', ...(matchWidth ? { width: boxOf(anchor).width } : {}) }}
      className={`dm-menu ${className}`}>
      {children}
    </div>,
    document.body,
  );
}

export function Row({ label, attrs, hint, description, style, marks, icon, glyph, active, check, checkbox, slot, tick, checked, sub, expanded, haspopup, disabled, note, tabbable, onLeaveRow, rowRef, onActivate, onOpen, onHover }: {
  label: string; /** Extra data attributes for the row's button (what the end-to-end specs select it by). */ attrs?: Record<`data-${string}`, string>; /** Read after the label as the row's description, not shown (a key hint). */ description?: string; style?: CSSProperties; /** Small icons between the (?) and the arrow, one per rule on the row's data (a filter, a slice, an aggregation). They are decorative: each `note` is read in the row's description. */ marks?: { icon: ReactNode; note: string }[]; /** A description shown as a (?) while the row is hovered or focused. It is decorative for assistive tech: the row carries it as its description. */ hint?: string; /** A muted glyph between the tick column and the label (a chart's type). */ glyph?: ReactNode; /** A first-level glyph in its own slot: outlined, or filled when the member has set this on the column. */ icon?: ReactNode; active?: boolean; check?: boolean; /** A check row that is its own choice, not one of a radio group: announced as a checkbox. */ checkbox?: boolean; /** Keeps the check column's room without being a choice row. */ slot?: boolean; /** A submenu row that holds the current choice: the tick sits before its chevron, and the row stays a plain menu item. */ tick?: boolean; checked?: boolean; sub?: boolean; expanded?: boolean; haspopup?: 'menu' | 'dialog'; disabled?: boolean; /** A row that is the panel's text (why there is nothing to pick): aria-disabled, at full colour, and it stays focusable so assistive tech reaches it. Activating it does nothing. */ note?: boolean; /** In the date filter's dialog the rows are reached with Tab; in a menu they are reached with the arrow keys. */ tabbable?: boolean;
  onLeaveRow?: () => void; rowRef?: (el: HTMLElement | null) => void; onActivate: (row: HTMLElement) => void; onOpen?: (row: HTMLElement) => void; onHover?: (row: HTMLElement) => void;
}) {
  return (
    <button type="button" role={check ? (checkbox ? 'menuitemcheckbox' : 'menuitemradio') : 'menuitem'} aria-checked={check ? !!checked : undefined} aria-haspopup={sub ? haspopup ?? 'menu' : undefined} aria-expanded={sub ? !!expanded : undefined} aria-disabled={note ? true : undefined}
      aria-description={[icon && active ? 'Active' : '', hint ?? '', description ?? '', ...(marks ?? []).map((m) => m.note)].filter(Boolean).join('. ') || undefined} data-active={icon && active ? '' : undefined}
      disabled={disabled} style={style} {...attrs} tabIndex={tabbable ? 0 : -1} ref={rowRef} className={hint ? 'dm-menu-row dm-reveal-host' : note ? 'dm-menu-row dm-menu-note' : 'dm-menu-row'}
      onClick={(e) => onActivate(e.currentTarget)}
      onMouseEnter={(e) => onHover?.(e.currentTarget)} onMouseLeave={onLeaveRow}
      onKeyDown={(e) => { if (sub && e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onOpen?.(e.currentTarget); } }}>
      {icon && <span className="dm-menu-icon" data-on={active ? '' : undefined} aria-hidden>{icon}</span>}
      {(check || slot) && <span className="dm-menu-check" aria-hidden>{checked && <Check className="size-4" />}</span>}
      {glyph && <span className="dm-menu-glyph" aria-hidden>{glyph}</span>}
      <span className="dm-menu-label">{label}</span>
      {hint && <span className="dm-hint-slot"><Hint kind="help" text={hint} label={`About ${label}`} decorative /></span>}
      {marks && marks.length > 0 && <span className="dm-menu-marks" aria-hidden>{marks.map((m) => <span key={m.note} className="inline-flex">{m.icon}</span>)}</span>}
      {tick && <span className="dm-menu-tick" aria-hidden>{checked && <Check className="size-4" />}</span>}
      {sub && <ChevronRight aria-hidden className="dm-menu-arrow size-4" />}
    </button>
  );
}
