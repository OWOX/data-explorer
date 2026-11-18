import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** How long a toast stays before it hides itself. */
export const TOAST_MS = 6000;

/**
 * A standard notification: fixed in the bottom-right corner of the plugin and announced as a status.
 * The status region is always mounted, so a screen reader hears the text swapped in; with no `children` the region is empty.
 * `children` is the message; `action` is an optional button or link beside it. `stamp` names the message: a new stamp shows it again after it hid itself.
 * The timer only hides the toast (`onDismiss` is for the Dismiss button alone). It waits while the toast is hovered or focused and while `hold` is set
 * (a dialog opened from the toast), and `persistent` turns it off.
 */
export function Toast({ children, action, onDismiss, ms = TOAST_MS, persistent = false, hold = false, stamp = children }: {
  children?: ReactNode; action?: ReactNode; onDismiss: () => void; ms?: number; persistent?: boolean; hold?: boolean; stamp?: unknown;
}) {
  const has = children !== null && children !== undefined && children !== false;
  const [hidden, setHidden] = useState<unknown>(null);
  const [over, setOver] = useState(false);
  const [inside, setInside] = useState(false);
  const waiting = over || inside || hold;
  useEffect(() => {
    if (!has || persistent || waiting) return;
    const timer = setTimeout(() => { setHidden(stamp); setOver(false); setInside(false); }, ms);
    return () => clearTimeout(timer);
  }, [has, persistent, waiting, ms, stamp]);
  const shown = has && hidden !== stamp;
  return createPortal(
    <div role="status" className="dm-toast pointer-events-none fixed bottom-4 right-4 z-[70] max-w-sm">
      {shown && (
        <div
          className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-lg"
          onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}
          onFocus={() => setInside(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false); }}
        >
          <span className="min-w-0 flex-1">{children}</span>
          {action}
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"><X className="size-3.5" aria-hidden /></button>
        </div>
      )}
    </div>,
    document.body,
  );
}
