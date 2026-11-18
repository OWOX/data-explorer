import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** How long a toast stays before it hides itself. */
export const TOAST_MS = 6000;

/** Every toast portals into this one top-center stack, so two shown together sit one above the other and neither covers the other. */
function toastStack(): HTMLElement {
  let el = document.getElementById('dm-toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dm-toast-stack';
    el.className = 'pointer-events-none fixed left-1/2 top-4 z-[70] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * A standard notification: fixed at the top center of the plugin (stacked with any other toast).
 * Only its text is the status region, so a screen reader announces the message and not the buttons; the region is always mounted,
 * so the text is heard being swapped in. With no `children` the region is empty.
 * `children` is the message; `action` is an optional button or link beside it. `stamp` names the message and is required: a new stamp shows it
 * again after it hid itself, restarts the timer and clears a pause left by the previous one (keep it stable between renders).
 * The timer only hides the toast (`onDismiss` is for the Dismiss button alone). It waits while the toast is hovered or focused and while `hold` is set
 * (a dialog opened from the toast), and `persistent` turns it off. Dismiss hands focus back to where it was before it entered the toast, else to `returnTo()`.
 */
export function Toast({ children, action, onDismiss, ms = TOAST_MS, persistent = false, hold = false, stamp, returnTo, tone }: {
  children?: ReactNode; action?: ReactNode; onDismiss: () => void; ms?: number; persistent?: boolean; hold?: boolean; stamp: unknown; returnTo?: () => HTMLElement | null | undefined;
  /** Colours the card: success, error or info. Without it the card is neutral. */
  tone?: 'success' | 'error' | 'info';
}) {
  const has = children !== null && children !== undefined && children !== false;
  const [hidden, setHidden] = useState<unknown>(null);
  const [over, setOver] = useState(false);
  const [inside, setInside] = useState(false);
  const [seen, setSeen] = useState(stamp);
  // A new message starts unpaused: the pointer or focus that held the last one may be gone with it (no mouseleave or blur reaches an unmounted card).
  if (seen !== stamp) { setSeen(stamp); setOver(false); setInside(false); }
  const before = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const waiting = over || inside || hold;
  useEffect(() => {
    if (!has || persistent || waiting) return;
    const timer = setTimeout(() => { setHidden(stamp); setOver(false); setInside(false); }, ms);
    return () => clearTimeout(timer);
  }, [has, persistent, waiting, ms, stamp]);
  const shown = has && hidden !== stamp;
  const dismiss = () => {
    const focused = card.current?.contains(document.activeElement);
    const back = [before.current, returnTo?.()].find((el) => el && el.isConnected);
    setOver(false);
    setInside(false);
    onDismiss();
    if (focused) back?.focus({ preventScroll: true });
  };
  return createPortal(
    <div
      ref={card}
      data-tone={shown ? tone : undefined}
      className={shown ? 'dm-toast-card pointer-events-auto mt-2 flex items-center gap-3' : 'sr-only'}
      onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}
      onFocus={(e) => { setInside(true); const from = e.relatedTarget as HTMLElement | null; if (from && !e.currentTarget.contains(from)) before.current = from; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false); }}
    >
      <span role="status" className="dm-toast min-w-0 flex-1">{shown ? children : null}</span>
      {shown && action}
      {shown && <button type="button" aria-label="Dismiss" onClick={dismiss} className="shrink-0 rounded p-1 hover:bg-black/10 dark:hover:bg-white/10"><X className="size-3.5" aria-hidden /></button>}
    </div>,
    toastStack(),
  );
}
