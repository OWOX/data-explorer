import { useEffect, useState, type RefObject } from 'react';
import { swallowNextClick } from '../outsidePress';
import { useLatest } from '../useLatest';

export type Press = { path: string; martId?: string };
export type PressDragOptions<D> = {
  /** The card a press landed on, or null when the target is not a draggable card. */
  pick: (target: Element) => Press | null;
  canDrag: (path: string) => boolean;
  /** Whether the pointer is where a release counts. */
  over: (e: PointerEvent, root: HTMLElement) => boolean;
  /** The drag state for one pointer move. */
  view: (press: Press, e: PointerEvent, inside: boolean, root: HTMLElement) => D;
  /** A release where it counts. */
  drop: (press: Press, e: PointerEvent, root: HTMLElement) => void;
};

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a card. A press on a card (not on its buttons, links, inputs or a ghost) becomes a drag past 5 px; a release where `over` says it
 * counts calls `drop`. A release elsewhere, Escape or a cancelled pointer end the drag with no change. The click the browser sends after a
 * drag is swallowed. `active` re-attaches the listeners when the root element appears later.
 */
export function usePressDrag<D>(root: RefObject<HTMLElement | null>, options: PressDragOptions<D>, active: unknown = null): D | null {
  const [drag, setDrag] = useState<D | null>(null);
  const latest = useLatest(options);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let press: (Press & { x: number; y: number }) | null = null;
    let dragging = false;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    // The move work (measuring, a re-render) runs once per animation frame, with the latest pointer.
    let frame = 0;
    let latestMove: PointerEvent | null = null;
    const end = () => { cancelAnimationFrame(frame); frame = 0; latestMove = null; press = null; dragging = false; setDrag(null); };
    const flush = () => {
      frame = 0;
      const e = latestMove;
      if (e && press) setDrag(latest.current.view(press, e, latest.current.over(e, el), el));
    };
    const down = (e: PointerEvent) => {
      cancelled = false;
      if (e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const picked = latest.current.pick(t);
      if (!picked || !latest.current.canDrag(picked.path)) return;
      dragging = false;
      press = { ...picked, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      // A move with no button down means the release was lost: forget a pending swallow.
      if (!(e.buttons & 1)) cancelled = false;
      if (!press) return;
      // The release happened out of our sight: let go of the drag.
      if (!(e.buttons & 1)) { end(); return; }
      if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
      dragging = true;
      e.preventDefault();
      latestMove = e;
      frame ||= requestAnimationFrame(flush);
    };
    const up = (e: PointerEvent) => {
      if (cancelled) { cancelled = false; swallowNextClick(); return; }
      if (!press) return;
      const held = press;
      const wasDrag = dragging;
      const inside = latest.current.over(e, el);
      end();
      if (!wasDrag) return;
      swallowNextClick();
      if (inside) latest.current.drop(held, e, el);
    };
    const cancel = () => { cancelled = false; end(); };
    // Escape in a drag only ends the drag: the capture phase and stopImmediatePropagation keep it from the focus and pin handlers.
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || !press) return; if (dragging) e.stopImmediatePropagation(); cancelled = dragging; end(); };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      setDrag(null);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, { capture: true });
    };
  }, [root, active, latest]);
  return drag;
}
