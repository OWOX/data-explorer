import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** How long a toast stays before it dismisses itself. */
export const TOAST_MS = 6000;

/**
 * A standard notification: fixed in the bottom-right corner of the plugin, announced as a status, dismissed by its button or after a few seconds.
 * `children` is the message; `action` is an optional button or link beside it.
 */
export function Toast({ children, action, onDismiss, ms = TOAST_MS }: { children: ReactNode; action?: ReactNode; onDismiss: () => void; ms?: number }) {
  // The latest callback is called, so a parent that re-renders does not restart the timer.
  const last = useRef(onDismiss);
  useEffect(() => { last.current = onDismiss; });
  useEffect(() => {
    const timer = setTimeout(() => last.current(), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return createPortal(
    <div role="status" className="dm-toast fixed bottom-4 right-4 z-[70] flex max-w-sm items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-lg">
      <span className="min-w-0 flex-1">{children}</span>
      {action}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"><X className="size-3.5" aria-hidden /></button>
    </div>,
    document.body,
  );
}
