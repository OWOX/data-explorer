import { useEffect, useRef, useState, type RefObject } from 'react';
import { martElementId } from './cards';

export type CardDrag = { id: string; title: string; x: number; y: number; overMain: boolean };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a data mart card onto the main card. A press on any card but the main one (not on its buttons, not on a ghost)
 * becomes a drag past 5 px; a release over the main card calls `onDrop`. A release elsewhere, Escape or a cancelled pointer
 * end the drag with no change. The click the browser sends after a drag is swallowed, so it does not also toggle the card.
 */
export function useCardDrag(canvas: RefObject<HTMLElement | null>, mainId: string | null, titleOf: (id: string) => string, onDrop: (id: string) => void): CardDrag | null {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const latest = useRef({ mainId, titleOf, onDrop });
  useEffect(() => { latest.current = { mainId, titleOf, onDrop }; });
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let press: { id: string; x: number; y: number } | null = null;
    let dragging = false;
    const overMain = (x: number, y: number) => {
      const main = latest.current.mainId;
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
      return !!main && !!hit?.closest(`#${CSS.escape(martElementId(main))}`);
    };
    const end = () => { press = null; dragging = false; setDrag(null); };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !latest.current.mainId) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const id = t.closest<HTMLElement>('[data-mart-id]')?.dataset.martId;
      if (!id || id === latest.current.mainId) return;
      press = { id, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!press) return;
      if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
      dragging = true;
      e.preventDefault();
      setDrag({ id: press.id, title: latest.current.titleOf(press.id), x: e.clientX, y: e.clientY, overMain: overMain(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      if (!press) return;
      const { id } = press;
      const wasDrag = dragging;
      const dropped = wasDrag && overMain(e.clientX, e.clientY);
      end();
      if (wasDrag) {
        const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      if (dropped) latest.current.onDrop(id);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && press) end(); };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    document.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', end);
      document.removeEventListener('keydown', key);
    };
  }, [canvas]);
  return drag;
}
