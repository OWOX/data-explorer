// One tooltip for the whole page: Data Flow's dark bubble. It is drawn in a portal on the body, so no
// card, line or band can paint over it, and it keeps 8px from the viewport edge.
import * as T from '@radix-ui/react-tooltip';
import { CircleHelp, Info } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One provider at the app root. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={200} disableHoverableContent>{children}</T.Provider>;
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side="top" sideOffset={6} collisionPadding={8} className="dm-hint-body">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** True when the element's content is wider than the element: its text ends in an ellipsis. */
const isTruncated = (el: Element | null | undefined): boolean => !!el && el.scrollWidth > el.clientWidth;

/**
 * The shared bubble for clipped text: it opens only when the trigger (or `measure`'s element inside it) is truncated,
 * or when `extra` has something to add. A truncated `text` comes first.
 */
export function OverflowTip({ text, extra, measure, children }: { text: string; extra?: string; measure?: (trigger: HTMLElement) => Element | null; children: ReactElement }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  return (
    <T.Root open={open} onOpenChange={(next) => {
      if (!next) { setOpen(false); return; }
      const el = trigger.current;
      const shown = [isTruncated(el && (measure ? measure(el) : el)) ? text : null, extra].filter((l): l is string => !!l);
      setLines(shown);
      setOpen(shown.length > 0);
    }}>
      <T.Trigger asChild ref={trigger}>{children}</T.Trigger>
      <T.Portal>
        <T.Content side="top" sideOffset={6} collisionPadding={8} className="dm-hint-body">
          <TipLines lines={lines} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** Several short lines in one bubble, the first one in weight (a status and what it means). */
export function TipLines({ lines }: { lines: ReactNode[] }) {
  return <span className="dm-tip-lines">{lines.map((line, i) => <span key={i}>{line}</span>)}</span>;
}

/** The (i), or the (?) for a field's description: a focusable glyph that opens the shared bubble. */
export function Hint({ text, label, kind = 'info', decorative = false }: { text: ReactNode; label: string; kind?: 'info' | 'help'; /** A pointer-only copy: hidden from assistive tech and not a Tab stop, for a row whose own element carries the description. */ decorative?: boolean }) {
  const Glyph = kind === 'help' ? CircleHelp : Info;
  return (
    <Tooltip content={text}>
      {decorative
        ? <span className="dm-hint" aria-hidden="true" aria-label={label}><Glyph size={14} /></span>
        : <span className="dm-hint" tabIndex={0} role="note" aria-label={label}><Glyph size={14} /></span>}
    </Tooltip>
  );
}

/** The same bubble at a point, for things a trigger element cannot wrap (the lines drawn between cards). */
export function PointerTip({ text, x, y }: { text: string; x: number; y: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = el.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const left = Math.min(Math.max(margin, x - box.width / 2), window.innerWidth - box.width - margin);
    const top = y - box.height - 14 >= margin ? y - box.height - 14 : y + 18;
    setAt({ left, top });
  }, [text, x, y]);
  return createPortal(<div ref={el} role="tooltip" className="dm-hint-body dm-tip-fixed" style={at}>{text}</div>, document.body);
}
