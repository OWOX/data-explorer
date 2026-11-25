// One tooltip for the whole page: Data Flow's dark bubble. It is drawn in a portal on the body, so no
// card, line or band can paint over it, and it keeps 8px from the viewport edge.
import * as T from '@radix-ui/react-tooltip';
import { Check, CircleHelp, Copy, Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyText as writeClipboard } from './explorer/clipboard';

/** One provider at the app root. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={200} disableHoverableContent>{children}</T.Provider>;
}

/**
 * `side` is where the bubble opens (Radix flips it when there is no room). With `copyText` the bubble can be entered with the pointer and has a copy button
 * in its corner: the pointer may leave the trigger for the bubble, the text in it can be selected, and the hidden tooltip text for screen readers stays the plain `copyText`.
 */
export function Tooltip({ content, children, side = 'top', copyText }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; copyText?: string }) {
  // Nothing to say: the tooltip stays shut, so the trigger gets no dangling aria-describedby.
  // Always controlled: content that turns empty and back (a badge's tip) must not leave Radix's own open state stale.
  const empty = content == null || content === '' || content === false;
  const [open, setOpen] = useState(false);
  const hoverable = copyText !== undefined;
  return (
    // Radix keeps a hoverable bubble open while the pointer crosses the gap to it, and ignores the other triggers on the way.
    <T.Root open={!empty && open} onOpenChange={setOpen} disableHoverableContent={hoverable ? false : undefined}>
      {/* While shut by `empty`, Radix sees no change on leave, blur or press and would not report one, so they close it here. A hoverable bubble is closed by Radix once the pointer leaves both. */}
      <T.Trigger asChild onPointerLeave={hoverable ? undefined : () => setOpen(false)} onBlur={() => setOpen(false)} onPointerDown={() => setOpen(false)}>{children}</T.Trigger>
      {!empty && (
        <T.Portal>
          <T.Content side={side} sideOffset={6} collisionPadding={8} className={hoverable ? 'dm-hint-body dm-hint-hoverable' : 'dm-hint-body'} aria-label={copyText}>
            {hoverable ? <span className="dm-tip-copyrow"><span>{content}</span><CopyButton text={copyText} /></span> : content}
          </T.Content>
        </T.Portal>
      )}
    </T.Root>
  );
}

const COPIED_MS = 1500;

/** The corner button of a hoverable bubble: copies `text` (the clipboard API, then the textarea fallback), shows a check for a moment, or says the copy failed. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'ok' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await writeClipboard(text);
    setState(ok ? 'ok' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), COPIED_MS);
  };
  return (
    <span className="dm-tip-copy">
      {state === 'failed' && <span role="alert" className="dm-tip-copy-failed">Copy failed</span>}
      {/* A press must not move focus off the trigger (that would close the bubble) nor reach what is under the bubble. */}
      <button type="button" aria-label="Copy to clipboard" data-copied={state === 'ok' ? '' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); void copy(); }}>
        {state === 'ok' ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
    </span>
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

/**
 * The same bubble at a point, for things a trigger element cannot wrap (the lines drawn between cards).
 * With `more`, the bubble takes the pointer: a "More" link on the next line opens the text in its place. Key it by its line, so another line starts closed.
 */
export function PointerTip({ text, more, x, y }: { text: string; more?: string; x: number; y: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const box = el.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const left = Math.min(Math.max(margin, x - box.width / 2), window.innerWidth - box.width - margin);
    // Opened, the bubble grows downward from where it stood, so the link the pointer is on stays under it; it moves up only to stay on screen.
    const top = open
      ? Math.max(margin, Math.min(at.top, window.innerHeight - box.height - margin))
      : y - box.height - 14 >= margin ? y - box.height - 14 : y + 18;
    setAt({ left: open ? Math.max(margin, Math.min(at.left, window.innerWidth - box.width - margin)) : left, top });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, more, x, y, open]);
  return createPortal(
    <div ref={el} role={more ? 'dialog' : 'tooltip'} aria-label={more ? text : undefined} className={`dm-hint-body dm-tip-fixed${more ? ' dm-tip-interactive' : ''}`} style={at}>
      {text}
      {more && !open && <button type="button" className="dm-tip-more" onClick={() => setOpen(true)}>More</button>}
      {more && open && <span className="dm-tip-about">{more}</span>}
    </div>,
    document.body,
  );
}
