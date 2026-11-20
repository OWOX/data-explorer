import { Check, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeBeside, placeBelow, type Place } from './menuPlacement';

/** How long the pointer rests on another row before its submenu replaces the open one. */
export const HOVER_MS = 120;
/** One pending hover switch: a new one replaces the last, and `clear` drops it. */
export class HoverIntent {
  private timer: ReturnType<typeof setTimeout> | undefined;
  after(ms: number, fn: () => void) { this.clear(); this.timer = setTimeout(fn, ms); }
  clear() { clearTimeout(this.timer); this.timer = undefined; }
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const boxOf = (el: HTMLElement) => el.getBoundingClientRect();
export const ITEM = '[role="menuitem"], [role="menuitemradio"]';

/**
 * One floating panel of the menu, drawn in a portal on the body and kept inside the viewport (flipped left or up when it has no room).
 * Escape, and for a submenu Left, are handled here: the deepest open panel takes the key, so Escape closes the submenu first, then the menu.
 */
export function Panel({ anchor, mode, role, label, onEscape, onLeave, onTab, onPlaced, returnTo, focusSeq, form, className = '', children }: { anchor: HTMLElement; mode: 'below' | 'beside'; role: 'menu' | 'dialog'; label: string; onEscape: () => void; onLeave?: () => void; /** Tab in a menu closes it (the editors keep their own Tab order). */ onTab?: () => void; /** Called once the panel has its place, so a submenu can be measured from its rows. */ onPlaced?: () => void; /** A submenu in a dialog keeps Tab inside the dialog's order: Tab past its last control, or Shift+Tab before its first, returns focus to this row. */ returnTo?: HTMLElement; focusSeq: number; /** The panel holds a form: a click or a focus in it counts as an edit, so hover intent leaves it open. */ form?: boolean; className?: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Place | null>(null);
  const place = useCallback(() => {
    const node = el.current;
    if (!node) return;
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const next = (mode === 'below' ? placeBelow : placeBeside)(boxOf(anchor), size, viewport());
    setPos((cur) => (cur && cur.left === next.left && cur.top === next.top && cur.side === next.side ? cur : next));
  }, [anchor, mode]);
  useLayoutEffect(() => { place(); });
  const placedNow = pos !== null;
  useLayoutEffect(() => { if (placedNow) onPlaced?.(); }, [placedNow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !el.current) return;
    const ro = new ResizeObserver(place);
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [place]);
  useEffect(() => {
    if (!focusSeq || !pos) return;
    const first = el.current?.querySelector<HTMLElement>(`${ITEM}, input, select, button:not(:disabled)`);
    (first ?? el.current)?.focus({ preventScroll: true });
  }, [focusSeq, pos !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    if (e.key === 'Tab' && returnTo && (e.target as HTMLElement).closest('[data-column-menu]') === e.currentTarget) {
      const tabbable = [...e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button')].filter((n) => !(n as HTMLButtonElement).disabled && n.tabIndex >= 0);
      const at = tabbable.indexOf(e.target as HTMLElement);
      if (e.shiftKey ? at <= 0 : at === -1 ? tabbable.length === 0 : at === tabbable.length - 1) { e.preventDefault(); e.stopPropagation(); returnTo.focus(); }
      return;
    }
    if (e.key === 'Tab' && role === 'menu' && onTab && (e.target as HTMLElement).closest('[data-column-menu]') === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onTab(); return; }
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
    // Arrow keys move through this panel's own rows; a field inside a form keeps its keys.
    // A dialog panel may hold a role="menu" list of rows (the date filter's presets): its arrows work the same.
    const list = item?.closest<HTMLElement>('[role="menu"]');
    if (!item || !list || (role === 'menu' ? list !== e.currentTarget : !e.currentTarget.contains(list))) return;
    const items = [...list.querySelectorAll<HTMLElement>(ITEM)].filter((n) => n.closest('[role="menu"]') === list && !(n as HTMLButtonElement).disabled);
    const at = items.indexOf(item);
    const go = (to: number) => { e.preventDefault(); e.stopPropagation(); items[(to + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'ArrowLeft' && onLeave && role === 'menu') { e.preventDefault(); e.stopPropagation(); onLeave(); }
  };
  return createPortal(
    <div ref={el} role={role} aria-label={label} tabIndex={-1} data-column-menu="" data-form={form ? '' : undefined} data-side={pos?.side} onKeyDown={onKeyDown} onInput={() => { if (el.current) el.current.dataset.edited = ''; }} onChange={() => { if (el.current) el.current.dataset.edited = ''; }}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className={`dm-menu ${className}`}>
      {children}
    </div>,
    document.body,
  );
}

export function Row({ label, icon, active, check, checkbox, slot, checked, sub, expanded, haspopup, disabled, tabbable, onLeaveRow, rowRef, onActivate, onOpen, onHover }: {
  label: string; /** A first-level glyph in its own slot: outlined, or filled when the member has set this on the column. */ icon?: ReactNode; active?: boolean; check?: boolean; /** A check row that is its own choice, not one of a radio group: announced as a checkbox. */ checkbox?: boolean; /** Keeps the check column's room without being a choice row. */ slot?: boolean; checked?: boolean; sub?: boolean; expanded?: boolean; haspopup?: 'menu' | 'dialog'; disabled?: boolean; /** In the date filter's dialog the rows are reached with Tab; in a menu they are reached with the arrow keys. */ tabbable?: boolean;
  onLeaveRow?: () => void; rowRef?: (el: HTMLElement | null) => void; onActivate: (row: HTMLElement) => void; onOpen?: (row: HTMLElement) => void; onHover?: (row: HTMLElement) => void;
}) {
  return (
    <button type="button" role={check ? (checkbox ? 'menuitemcheckbox' : 'menuitemradio') : 'menuitem'} aria-checked={check ? !!checked : undefined} aria-haspopup={sub ? haspopup ?? 'menu' : undefined} aria-expanded={sub ? !!expanded : undefined}
      aria-description={icon && active ? 'Active' : undefined} data-active={icon && active ? '' : undefined}
      disabled={disabled} tabIndex={tabbable ? 0 : -1} ref={rowRef} className="dm-menu-row"
      onClick={(e) => onActivate(e.currentTarget)}
      onMouseEnter={(e) => onHover?.(e.currentTarget)} onMouseLeave={onLeaveRow}
      onKeyDown={(e) => { if (sub && e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onOpen?.(e.currentTarget); } }}>
      {icon && <span className="dm-menu-icon" data-on={active ? '' : undefined} aria-hidden>{icon}</span>}
      {(check || slot) && <span className="dm-menu-check" aria-hidden>{checked && <Check className="size-4" />}</span>}
      <span className="dm-menu-label">{label}</span>
      {sub && <ChevronRight aria-hidden className="dm-menu-arrow size-4" />}
    </button>
  );
}
