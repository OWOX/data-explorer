import { useEffect, useState, type RefObject } from 'react';
import { useLatest } from '../useLatest';

/** The pointer is in client coordinates; `inside` is whether it is over the canvas, where a release counts; `view` is what `measure` said for this move. */
export type CardDrag<V> = { path: string; martId: string; title: string; x: number; y: number; inside: boolean; view: V };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a joined card in the Grid to rejoin it under another mart. A press on a joined card (one with an alias path; not the
 * main one, not its buttons, not a ghost) becomes a drag past 5 px; a release over the canvas calls `onDrop` with the pointer.
 * A release outside it, Escape or a cancelled pointer end the drag with no change. The click the browser sends after a drag is
 * swallowed, so it does not also toggle the card. `measure` reads the page on each move (where the targets are), so the view can draw from it.
 */
export function useCardDrag<V>(canvas: RefObject<HTMLElement | null>, titleOf: (martId: string) => string, onDrop: (path: string, x: number, y: number) => void, canDrag: (path: string) => boolean, measure: (path: string, x: number, y: number, inside: boolean) => V): CardDrag<V> | null {
  const [drag, setDrag] = useState<CardDrag<V> | null>(null);
  const latest = useLatest({ titleOf, onDrop, canDrag, measure });
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let press: { path: string; martId: string; x: number; y: number } | null = null;
    let dragging = false;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    const swallowNextClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const over = (e: PointerEvent) => e.target instanceof Node && root.contains(e.target);
    // The move work (measuring the targets, a re-render) runs once per animation frame, with the latest pointer.
    let frame = 0;
    let latestMove: PointerEvent | null = null;
    const end = () => { cancelAnimationFrame(frame); frame = 0; latestMove = null; press = null; dragging = false; setDrag(null); };
    const flush = () => {
      frame = 0;
      const e = latestMove;
      if (!e || !press) return;
      const inside = over(e);
      setDrag({ path: press.path, martId: press.martId, title: latest.current.titleOf(press.martId), x: e.clientX, y: e.clientY, inside, view: latest.current.measure(press.path, e.clientX, e.clientY, inside) });
    };
    const cancel = () => { cancelled = false; end(); };
    const down = (e: PointerEvent) => {
      cancelled = false;
      if (e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const card = t.closest<HTMLElement>('[data-mart-id][data-path]');
      const path = card?.dataset.path;
      if (!card || !path || !latest.current.canDrag(path)) return;
      dragging = false;
      press = { path, martId: card.dataset.martId!, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
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
      const { path } = press;
      const wasDrag = dragging;
      const inside = over(e);
      end();
      if (!wasDrag) return;
      swallowNextClick();
      if (inside) latest.current.onDrop(path, e.clientX, e.clientY);
    };
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || !press) return; cancelled = dragging; end(); };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
    };
  }, [canvas, latest]);
  return drag;
}
