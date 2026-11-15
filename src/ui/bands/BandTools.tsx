// The slot a band's header offers its content: controls whose state lives below render into the
// header through a portal, so there is one source of truth and they still fold with the band.
import { createContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const BandToolsSlot = createContext<HTMLElement | null>(null);

/** Renders its children in the enclosing band's header; inline when there is no band around it. */
export function BandTools({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return slot ? createPortal(children, slot) : <>{children}</>;
}
