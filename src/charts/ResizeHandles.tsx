import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CELL, dragged, type ChartFrame, type ChartSize, type Edge } from './resize';

const EDGES: { edge: Edge; what: string }[] = [{ edge: 'e', what: 'width' }, { edge: 's', what: 'height' }, { edge: 'se', what: 'width and height' }];
const KEYS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The right edge, bottom edge and corner of a panel in resize mode. A drag moves the size cell by cell and saves it once, on release; an arrow key moves and saves one cell. */
export function ResizeHandles({ title, section, frame, onDraft }: { title: string; section: HTMLElement; frame: ChartFrame; onDraft: (size: ChartSize | null) => void }) {
  const stop = useRef<(() => void) | null>(null);
  // Leaving resize mode or the chart mid-drag drops the drag.
  useEffect(() => () => stop.current?.(), []);
  /** The band's content box: what a width may fill, and the point a drag is measured from (it moves with a scroll, not when the panel wraps onto another row). */
  const band = () => {
    const el = section.closest<HTMLElement>('[data-chart-panels]');
    const box = el?.getBoundingClientRect();
    const css = el ? getComputedStyle(el) : null;
    return { x: box?.left ?? 0, y: box?.top ?? 0, room: el && css && el.clientWidth > 0 ? el.clientWidth - parseFloat(css.paddingLeft || '0') - parseFloat(css.paddingRight || '0') : Number.POSITIVE_INFINITY };
  };
  const down = (edge: Edge) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop.current?.();
    const handle = e.currentTarget;
    const { pointerId: id, clientX, clientY } = e;
    const box = section.getBoundingClientRect();
    const from = band();
    let last: ChartSize | null = null;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const now = band();
      const next = dragged(frame.size, edge, { w: box.width, h: box.height }, ev.clientX - clientX - (now.x - from.x), ev.clientY - clientY - (now.y - from.y), from.room);
      if (last ? next.cols === last.cols && next.rows === last.rows : Math.abs(ev.clientX - clientX) + Math.abs(ev.clientY - clientY) < 3) return;
      last = next;
      onDraft(next);
    };
    const end = (save: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      stop.current = null;
      frame.cancelDrag.current = null;
      if (save && last && (last.cols !== frame.size.cols || last.rows !== frame.size.rows)) frame.onResize(last);
      onDraft(null);
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) end(true); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) end(false); };
    // Capture keeps the resize cursor and the moves while the pointer is off the handle; jsdom has none.
    handle.setPointerCapture?.(id);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    stop.current = () => end(false);
    frame.cancelDrag.current = () => end(false);
  };
  const key = (edge: Edge) => (e: KeyboardEvent) => {
    const step = KEYS[e.key];
    if (!step || (edge === 'e' && step[0] === 0) || (edge === 's' && step[1] === 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const box = section.getBoundingClientRect();
    const moved: Edge = step[0] !== 0 ? 'e' : 's';
    frame.onResize(dragged(frame.size, moved, { w: box.width, h: box.height }, step[0] * CELL, step[1] * CELL, band().room), true);
  };
  return EDGES.map(({ edge, what }) => <button key={edge} type="button" className="dm-resize" data-edge={edge} aria-label={`Resize ${title}: ${what}`} onPointerDown={down(edge)} onKeyDown={key(edge)} />);
}
