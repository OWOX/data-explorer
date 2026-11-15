import * as P from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

export function Popover({ trigger, children, align = 'start', open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={4} className="z-50 w-64 rounded-md border bg-background p-3 text-sm shadow-md">{children}</P.Content>
      </P.Portal>
    </P.Root>
  );
}
