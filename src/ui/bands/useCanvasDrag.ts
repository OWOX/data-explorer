import { useEffect, useRef, useState, type RefObject } from 'react';

/** The pointer in canvas coordinates (x, y) and in client coordinates (clientX, clientY, for the title chip); `inside` is whether it is over the scroll box, where a release counts. */
export type CanvasDrag = { path: string; x: number; y: number; clientX: number; clientY: number; inside: boolean };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a joined card on the canvas. A press on a tree card (not the main one, not its buttons, not a ghost) becomes a
 * drag past 5 px; a release over the canvas (its scroll box) calls `onDrop` with the pointer in canvas coordinates. A release outside it,
 * Escape or a cancelled pointer end the drag with no change. The click after a drag is swallowed.
 */
export function useCanvasDrag(root: RefObject<HTMLElement | null>, canDrag: (path: string) => boolean, onDrop: (path: string, x: number, y: number) => void, active: unknown = null): CanvasDrag | null {
  const [drag, setDrag] = useState<CanvasDrag | null>(null);
  const latest = useRef({ canDrag, onDrop });
  useEffect(() => { latest.current = { canDrag, onDrop }; });
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
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // The whole scroll box counts as the canvas, so the margin around the tree is not a dead zone.
    const over = (e: PointerEvent) => e.target instanceof Node && (el.parentElement ?? el).contains(e.target);
    const end = () => { press = null; dragging = false; setDrag(null); };
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
      setDrag({ path: press.path, ...local(e), clientX: e.clientX, clientY: e.clientY, inside: over(e) });
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
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || !press) return; cancelled = dragging; end(); };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    return () => {
      setDrag(null);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
    };
    // `active` re-attaches the listeners when the root element appears later.
  }, [root, active]);
  return drag;
}
