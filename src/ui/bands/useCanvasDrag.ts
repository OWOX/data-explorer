import { useEffect, useState, type RefObject } from 'react';
import { useLatest } from '../useLatest';
import { scrollBoxOf } from './canvas-zoom';

/** The pointer in canvas coordinates (x, y) and in client coordinates (clientX, clientY, for the title chip); `inside` is whether it is over the scroll box, where a release counts. */
type CanvasDrag = { path: string; x: number; y: number; clientX: number; clientY: number; inside: boolean };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a joined card on the canvas. A press on a tree card (not the main one, not its buttons, not a ghost) becomes a
 * drag past 5 px; a release over the canvas (its scroll box) calls `onDrop` with the pointer in canvas coordinates. A release outside it,
 * Escape or a cancelled pointer end the drag with no change. The click after a drag is swallowed.
 */
export function useCanvasDrag(root: RefObject<HTMLElement | null>, canDrag: (path: string) => boolean, onDrop: (path: string, x: number, y: number) => void, active: unknown = null, scale = 1): CanvasDrag | null {
  const [drag, setDrag] = useState<CanvasDrag | null>(null);
  const latest = useLatest({ canDrag, onDrop, scale });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let press: { path: string; x: number; y: number } | null = null;
    let dragging = false;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    const swallowNextClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    // The tree sits inside the scroll box, so its own rectangle already carries the scroll offset.
    // The tree is drawn scaled, so the client offset is divided by the scale to get layout pixels.
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const k = latest.current.scale;
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };
    // The whole scroll box counts as the canvas, so the margin around the tree is not a dead zone.
    const over = (e: PointerEvent) => e.target instanceof Node && scrollBoxOf(el).contains(e.target);
    // The move work (a re-render) runs once per animation frame, with the latest pointer.
    let frame = 0;
    let latestMove: PointerEvent | null = null;
    const end = () => { cancelAnimationFrame(frame); frame = 0; latestMove = null; press = null; dragging = false; setDrag(null); };
    const flush = () => {
      frame = 0;
      const e = latestMove;
      if (e && press) setDrag({ path: press.path, ...local(e), clientX: e.clientX, clientY: e.clientY, inside: over(e) });
    };
    const down = (e: PointerEvent) => {
      cancelled = false;
      if (e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const path = t.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath;
      if (!path || !latest.current.canDrag(path)) return;
      dragging = false;
      press = { path, x: e.clientX, y: e.clientY };
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
      const { path } = press;
      const wasDrag = dragging;
      const inside = over(e);
      end();
      if (!wasDrag) return;
      swallowNextClick();
      if (inside) { const p = local(e); latest.current.onDrop(path, p.x, p.y); }
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
    // `active` re-attaches the listeners when the root element appears later.
  }, [root, active, latest]);
  return drag;
}
