import * as P from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

/**
 * At most 20rem tall, and never taller than the room left on screen: the body scrolls inside.
 * A `.dm-popover-title` at the top of the body stays pinned while the rest scrolls.
 */
export function Popover({ trigger, children, align = 'start', open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={4} collisionPadding={8} className="z-50 flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-64 flex-col overflow-hidden rounded-md border bg-background text-sm shadow-md">
          <div data-popover-body="" className="min-h-0 overflow-y-auto p-3">{children}</div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
