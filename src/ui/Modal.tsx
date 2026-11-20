import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ActionForm } from './ActionForm';
import { useLatest } from './useLatest';

const FOCUSABLE = 'input, button, select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * What Tab reaches inside `root`, in order. A radio group is one stop (its checked radio, else its first enabled one), as in the browser.
 * Disabled controls and everything inside a closed <details> but its own summary are skipped.
 */
function tabStops(root: HTMLElement): HTMLElement[] {
  const seen = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if ((el as HTMLInputElement).disabled) return false;
    if (el.tagName !== 'SUMMARY' && el.closest('details:not([open])')) return false;
    const r = el as HTMLInputElement;
    if (r.type !== 'radio' || !r.name) return true;
    if (seen.has(r.name)) return false;
    const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((x) => x.name === r.name && !x.disabled);
    if (group.some((x) => x.checked) ? !r.checked : group[0] !== r) return false;
    seen.add(r.name);
    return true;
  });
}

type Props = {
  /** The dialog's accessible name. */ label: string;
  onClose: () => void;
  /** False while the dialog must stay open (a run is in flight): Escape and a click on the backdrop do nothing. */ canClose?: boolean;
  /** Tailwind width class of the dialog. */ width: string;
  /** Runs when the dialog goes away, however that happens; it hands focus back to whatever opened it. */ returnFocus?: () => void;
  /** Runs when Enter is pressed in a text field of the dialog. */ onAction?: () => void;
  /** The dialog's element, for a body that looks things up in it. */ dialogRef?: Ref<HTMLDivElement>;
  children: ReactNode;
};

/**
 * A modal dialog over the page: a portal with a backdrop, Escape and a click outside to close, Tab kept inside, and focus handed back on close.
 * The body takes focus where it wants on open (an effect or an autofocus of its own).
 */
export function Modal({ label, onClose, canClose = true, width, returnFocus, onAction, dialogRef, children }: Props) {
  const latest = useLatest({ onClose, canClose, returnFocus });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && latest.current.canClose) latest.current.onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [latest]);
  useEffect(() => () => latest.current.returnFocus?.(), [latest]);
  // Tab cycles inside the dialog: focus never leaves it behind the backdrop.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = tabStops(e.currentTarget);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
    e.preventDefault();
    items[next]?.focus();
  };
  // Focus that fell out of the dialog (onto the page body, for instance when the focused radio was disabled) is pulled back on the next Tab.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = (e: KeyboardEvent) => {
      const root = box.current;
      if (e.key !== 'Tab' || !root || root.contains(document.activeElement)) return;
      e.preventDefault();
      const stops = tabStops(root);
      (e.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    };
    document.addEventListener('keydown', back);
    return () => document.removeEventListener('keydown', back);
  }, [box]);
  return createPortal(
    <div ref={box} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (canClose) onClose(); }} onKeyDown={trap}>
      <ActionForm ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} onAction={onAction ?? noop} onClick={(e) => e.stopPropagation()} className={`flex ${width} max-w-[92vw] flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg`}>
        {children}
      </ActionForm>
    </div>,
    document.body,
  );
}

const noop = () => {};
