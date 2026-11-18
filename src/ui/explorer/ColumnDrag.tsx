import { useEffect, useRef, useState, type RefObject } from 'react';

/** What the overlays draw, in the scroller's content coordinates (so they scroll with the grid). */
export type ColumnDragView = {
  column: string;
  /** Where the column stands: stays shaded. */
  shade: { left: number; width: number };
  /** Follows the pointer, kept inside the column's data mart. */
  ghost: { left: number; width: number };
  /** Where the column lands, or null when dropping it would change nothing. */
  drop: number | null;
  top: number;
  height: number;
  lineHeight: number;
};

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 4;
/** Within this distance of the scroller's left or right edge the grid scrolls sideways. */
const EDGE_PX = 40;
const MAX_STEP = 16;

type Col = { name: string; left: number; right: number };

type Options = {
  scroller: RefObject<HTMLElement | null>;
  head: RefObject<HTMLElement | null>;
  /** The data mart a column belongs to: a column only moves inside its own. */
  groupOf: (column: string) => string;
  onMove: (column: string, before: string | null) => void;
};

/**
 * Dragging a field header sideways moves its column, as in Google Sheets. The press must be on a `th.dm-th[data-column]` and not on
 * its controls (menu, info); past 4 px it becomes a drag, and the click the browser sends after it is swallowed so no sort toggles.
 * The drop slot is clamped to the column's own data mart. Escape or a cancelled pointer end the drag with no change.
 */
export function useColumnDrag({ scroller, head, groupOf, onMove }: Options): ColumnDragView | null {
  const [view, setView] = useState<ColumnDragView | null>(null);
  const latest = useRef({ groupOf, onMove });
  useEffect(() => { latest.current = { groupOf, onMove }; });
  useEffect(() => {
    const thead = head.current;
    const box = scroller.current;
    if (!thead || !box) return;
    let press: { column: string; x: number; y: number } | null = null;
    let drag: { column: string; cols: Col[]; at: number; grab: number; before: string | null; changes: boolean } | null = null;
    let last = { x: 0, y: 0 };
    let raf = 0;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    const swallowNextClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const contentX = (clientX: number) => clientX - box.getBoundingClientRect().left + box.scrollLeft;
    // The columns as measured on screen: the outputs of one aggregated column sit side by side and count as one.
    const measure = (): Col[] => {
      const origin = box.getBoundingClientRect().left - box.scrollLeft;
      const cols: Col[] = [];
      for (const th of thead.querySelectorAll<HTMLElement>('th.dm-th[data-column]')) {
        const r = th.getBoundingClientRect();
        const name = th.dataset.column!;
        const prev = cols[cols.length - 1];
        if (prev && prev.name === name) prev.right = r.right - origin;
        else cols.push({ name, left: r.left - origin, right: r.right - origin });
      }
      return cols;
    };
    const update = () => {
      if (!drag) return;
      const { cols, at } = drag;
      const me = cols[at]!;
      const px = contentX(last.x);
      const width = me.right - me.left;
      const lo = cols[0]!.left;
      const hi = cols[cols.length - 1]!.right;
      const ghost = Math.min(Math.max(px - drag.grab, lo), Math.max(lo, hi - width));
      // The slot is the gap before the first other column whose middle is right of the pointer.
      const others = cols.filter((_, i) => i !== at);
      let slot = 0;
      while (slot < others.length && px > (others[slot]!.left + others[slot]!.right) / 2) slot++;
      drag.before = others[slot]?.name ?? null;
      drag.changes = drag.before !== (cols[at + 1]?.name ?? null);
      const table = thead.parentElement;
      const bottom = Math.min(box.scrollTop + box.clientHeight, table ? table.offsetHeight : Infinity);
      setView({
        column: drag.column,
        shade: { left: me.left, width },
        ghost: { left: ghost, width },
        drop: drag.changes ? (others[slot]?.left ?? hi) : null,
        top: box.scrollTop,
        height: box.clientHeight,
        lineHeight: Math.max(0, bottom - box.scrollTop),
      });
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = box.getBoundingClientRect();
      const into = last.x < r.left + EDGE_PX ? (r.left + EDGE_PX - last.x) : last.x > r.right - EDGE_PX ? -(last.x - (r.right - EDGE_PX)) : 0;
      if (!into) return;
      const step = Math.min(MAX_STEP, Math.max(2, Math.abs(into) / 2)) * (into > 0 ? -1 : 1);
      const before = box.scrollLeft;
      box.scrollLeft += step;
      if (box.scrollLeft !== before) update();
    };
    const stop = () => {
      press = null;
      drag = null;
      cancelAnimationFrame(raf);
      setView(null);
      document.body.classList.remove('dm-col-dragging');
      box.removeEventListener('scroll', update);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
    };
    const start = (column: string): boolean => {
      const all = measure();
      const group = latest.current.groupOf(column);
      const cols = all.filter((c) => latest.current.groupOf(c.name) === group);
      const at = cols.findIndex((c) => c.name === column);
      // A column alone in its data mart has nowhere to go: the press stays a click.
      if (at < 0 || cols.length < 2) return false;
      drag = { column, cols, at, grab: contentX(press!.x) - cols[at]!.left, before: null, changes: false };
      document.body.classList.add('dm-col-dragging');
      window.getSelection()?.removeAllRanges();
      box.addEventListener('scroll', update);
      raf = requestAnimationFrame(tick);
      return true;
    };
    function move(e: PointerEvent) {
      if (!press) return;
      // The release happened out of our sight: let go of the drag.
      if (!(e.buttons & 1)) { stop(); return; }
      last = { x: e.clientX, y: e.clientY };
      if (!drag) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
        if (!start(press.column)) { press = null; return; }
      }
      e.preventDefault();
      update();
    }
    function up() {
      if (cancelled) { cancelled = false; swallowNextClick(); return; }
      const d = drag;
      const was = !!d;
      stop();
      if (was) swallowNextClick();
      if (d && d.changes) latest.current.onMove(d.column, d.before);
    }
    function cancel() { cancelled = false; stop(); }
    function key(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !press) return;
      cancelled = !!drag;
      if (drag) { e.preventDefault(); e.stopPropagation(); }
      stop();
    }
    const down = (e: PointerEvent) => {
      cancelled = false;
      // Touch keeps scrolling the grid.
      if (e.button !== 0 || e.pointerType === 'touch') return;
      const t = e.target instanceof Element ? e.target : null;
      const th = t?.closest<HTMLElement>('th.dm-th[data-column]');
      if (!t || !th || t.closest('.dm-hdr-controls, .dm-col-info')) return;
      press = { column: th.dataset.column!, x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    };
    thead.addEventListener('pointerdown', down);
    return () => { thead.removeEventListener('pointerdown', down); stop(); };
  }, [scroller, head]);
  return view;
}

/** The three overlays of a column drag: the shade where the column stands, the ghost under the pointer, and the drop line. */
export function ColumnDragOverlay({ view }: { view: ColumnDragView }) {
  return (
    <>
      <div aria-hidden data-drag-shade className="dm-drag-shade" style={{ left: view.shade.left, width: view.shade.width, top: view.top, height: view.height }} />
      <div aria-hidden data-drag-ghost className="dm-drag-ghost" style={{ left: view.ghost.left, width: view.ghost.width, top: view.top, height: view.height }} />
      {view.drop !== null && <div aria-hidden data-drop-indicator className="dm-drop-line" style={{ left: view.drop - 1.5, top: view.top, height: view.lineHeight }} />}
    </>
  );
}
