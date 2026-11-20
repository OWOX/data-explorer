import { useEffect, useState, type RefObject } from 'react';
import { martElementId } from './cards';
import { useLatest } from '../useLatest';

type CardDrag = { id: string; title: string; x: number; y: number; overMain: boolean };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a data mart card onto the main card. A press on any card but the main one (not on its buttons, not on a ghost)
 * becomes a drag past 5 px; a release over the main card calls `onDrop`. A release elsewhere, Escape or a cancelled pointer
 * end the drag with no change. The click the browser sends after a drag is swallowed, so it does not also toggle the card.
 */
export function useCardDrag(canvas: RefObject<HTMLElement | null>, mainId: string | null, titleOf: (id: string) => string, onDrop: (id: string) => void, canDrag: (id: string) => boolean): CardDrag | null {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const latest = useLatest({ mainId, titleOf, onDrop, canDrag });
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let press: { id: string; x: number; y: number } | null = null;
    let dragging = false;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    const swallowNextClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const overMain = (x: number, y: number) => {
      const main = latest.current.mainId;
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
      return !!main && !!hit?.closest(`#${CSS.escape(martElementId(main))}`);
    };
    const end = () => { press = null; dragging = false; setDrag(null); };
    const cancel = () => { cancelled = false; end(); };
    const down = (e: PointerEvent) => {
      cancelled = false;
      if (e.button !== 0 || !latest.current.mainId) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const id = t.closest<HTMLElement>('[data-mart-id]')?.dataset.martId;
      if (!id || id === latest.current.mainId || !latest.current.canDrag(id)) return;
      dragging = false;
      press = { id, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!press) return;
      // The release happened out of our sight: let go of the drag.
      if (!(e.buttons & 1)) { end(); return; }
      if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
      dragging = true;
      e.preventDefault();
      setDrag({ id: press.id, title: latest.current.titleOf(press.id), x: e.clientX, y: e.clientY, overMain: overMain(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      if (cancelled) { cancelled = false; swallowNextClick(); return; }
      if (!press) return;
      const { id } = press;
      const wasDrag = dragging;
      const dropped = wasDrag && overMain(e.clientX, e.clientY);
      end();
      if (wasDrag) swallowNextClick();
      if (dropped) latest.current.onDrop(id);
    };
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || !press) return; cancelled = dragging; end(); };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
    };
  }, [canvas, latest]);
  return drag;
}
