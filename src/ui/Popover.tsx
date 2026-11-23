import * as P from '@radix-ui/react-popover';
import * as T from '@radix-ui/react-tooltip';
import { useId, useState, type ReactNode } from 'react';
import { useOutsidePress } from './outsidePress';

/**
 * At most 20rem tall, and never taller than the room left on screen: the body scrolls inside.
 * A `.dm-popover-title` at the top of the body stays pinned while the rest scrolls.
 */
export function Popover({ trigger, children, align = 'start', open, onOpenChange, tip, label, onCloseAutoFocus }: { /** Runs when the popover closes and focus is about to return to the trigger; `preventDefault` takes that over. */ onCloseAutoFocus?: (e: Event) => void; /** The standard tooltip on the trigger. */ tip?: string; /** The dialog's accessible name. */ label?: string; trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  // Held here so a press outside can close it without reaching the page: the press is swallowed before Radix sees it.
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const set = (o: boolean) => { setOwn(o); onOpenChange?.(o); };
  const id = useId();
  // Inside is the trigger, the content, and any other popper layer (a Select or a tooltip opened from it), or a column menu opened from a row.
  useOutsidePress(shown, (t) => !!t.closest(`[data-popover-trigger="${id}"], [data-radix-popper-content-wrapper], [data-column-menu]`), () => set(false));
  // A column menu is another layer on top: its focus, its pointer and its Escape are its own and leave this popover open.
  const inMenu = (e: Event) => { if ((e.target as Element | null)?.closest?.('[data-column-menu]')) e.preventDefault(); };
  return (
    <P.Root open={shown} onOpenChange={set}>
      {tip ? (
        <T.Root>
          <T.Trigger asChild><P.Trigger asChild data-popover-trigger={id}>{trigger}</P.Trigger></T.Trigger>
          <T.Portal><T.Content side="top" sideOffset={6} collisionPadding={8} className="dm-hint-body">{tip}</T.Content></T.Portal>
        </T.Root>
      ) : <P.Trigger asChild data-popover-trigger={id}>{trigger}</P.Trigger>}
      <P.Portal>
        <P.Content aria-label={label} onCloseAutoFocus={onCloseAutoFocus} onInteractOutside={inMenu} onEscapeKeyDown={inMenu} align={align} sideOffset={4} collisionPadding={8} className="z-50 flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-64 flex-col overflow-hidden rounded-md border bg-background text-sm shadow-md">
          <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">{children}</div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
