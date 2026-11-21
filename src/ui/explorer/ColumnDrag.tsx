import { useEffect, useState, type RefObject } from 'react';
import { useLatest } from '../useLatest';

/**
 * What the overlays draw. The layer is the part of the scroller's content that is on screen right of the row-number gutter (so nothing
 * paints over the gutter, and it scrolls with the grid); the other numbers are relative to the layer's left edge.
 */
type ColumnDragView = {
  layer: { left: number; top: number; width: number; height: number };
  /** Where the column stands: stays shaded. */
  shade: { left: number; width: number };
  /** Follows the pointer, kept inside the column's data mart. */
  ghost: { left: number; width: number };
  /** Where the column lands, or null when dropping it would change nothing. */
  drop: number | null;
};

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 4;
/** Within this distance of the scroller's left or right edge the grid scrolls sideways. */
const EDGE_PX = 40;
const MAX_STEP = 16;

type Col = { name: string; left: number; right: number };

/** The ghost's left edge: follows the pointer, but stays between the group's first and last edge. */
export function clampGhost(pointer: number, grab: number, width: number, lo: number, hi: number): number {
  return Math.min(Math.max(pointer - grab, lo), Math.max(lo, hi - width));
}

/** The gap the pointer is over, as an index into the group's other columns: before the first one whose middle is right of it. */
export function dropSlot(others: { left: number; right: number }[], pointer: number): number {
  let slot = 0;
  while (slot < others.length && pointer > (others[slot]!.left + others[slot]!.right) / 2) slot++;
  return slot;
}

type Options = {
  scroller: RefObject<HTMLElement | null>;
  head: RefObject<HTMLElement | null>;
  /** The data mart a column belongs to: a column only moves inside its own. */
  groupOf: (column: string) => string;
  onMove: (column: string, before: string | null) => void;
};

/** The overlay state lives here, not in the grid: every pointer move re-renders this small layer and nothing else. */
export function ColumnDragLayer(props: Options) {
  const view = useColumnDrag(props);
  return view ? <ColumnDragOverlay view={view} /> : null;
}

/**
 * Dragging a field header or a column letter sideways moves its column, as in Google Sheets. The press must be on a `th.dm-th[data-column]` or `th.dm-letter[data-letter-column]` and not on
 * its controls (menu, info); past 4 px it becomes a drag, and the click the browser sends after it is swallowed so no sort toggles.
 * The drop slot is clamped to the column's own data mart. Escape or a cancelled pointer end the drag with no change.
 */
function useColumnDrag({ scroller, head, groupOf, onMove }: Options): ColumnDragView | null {
  const [view, setView] = useState<ColumnDragView | null>(null);
  const latest = useLatest({ groupOf, onMove });
  useEffect(() => {
    const thead = head.current;
    const box = scroller.current;
    if (!thead || !box) return;
    let press: { column: string; x: number; y: number } | null = null;
    let drag: { column: string; grab: number; before: string | null; changes: boolean } | null = null;
    let last = { x: 0, y: 0 };
    let raf = 0;
    const swallowNextClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    // After a drag that ended without a drop (Escape, a column with nowhere to go) the release still sends a click: swallow it.
    // Armed only until the next pointer event: a release that never comes (the window lost focus) must not eat a later, unrelated click.
    let disarm: () => void = () => undefined;
    const swallowAfterRelease = () => {
      disarm();
      const off = () => {
        window.removeEventListener('pointerup', done, true);
        window.removeEventListener('pointercancel', done, true);
        window.removeEventListener('pointerdown', done, true);
        disarm = () => undefined;
      };
      const done = (ev: Event) => { off(); if (ev.type === 'pointerup') swallowNextClick(); };
      window.addEventListener('pointerup', done, true);
      window.addEventListener('pointercancel', done, true);
      window.addEventListener('pointerdown', done, true);
      disarm = off;
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
      // Measured on every update: rows arriving mid-drag change the auto-layout widths. The dragged column is found again by name.
      const group = latest.current.groupOf(drag.column);
      const cols = measure().filter((c) => latest.current.groupOf(c.name) === group);
      const at = cols.findIndex((c) => c.name === drag!.column);
      if (at < 0) return;
      const me = cols[at]!;
      const px = contentX(last.x);
      const width = me.right - me.left;
      const lo = cols[0]!.left;
      const hi = cols[cols.length - 1]!.right;
      const ghost = clampGhost(px, drag.grab, width, lo, hi);
      // The slot is the gap before the first other column whose middle is right of the pointer.
      const others = cols.filter((_, i) => i !== at);
      const slot = dropSlot(others, px);
      drag.before = others[slot]?.name ?? null;
      drag.changes = drag.before !== (cols[at + 1]?.name ?? null);
      // Right of the sticky row-number gutter, and no lower than the last row (not onto Load more).
      const gutter = thead.querySelector<HTMLElement>('.dm-corner')?.getBoundingClientRect().width ?? 0;
      const table = thead.parentElement;
      const layerLeft = box.scrollLeft + gutter;
      const height = Math.max(0, Math.min(box.clientHeight, table ? table.offsetHeight - box.scrollTop : Infinity));
      const layerWidth = Math.max(0, box.clientWidth - gutter);
      // The gap's place in the layer; a gap scrolled out of it (under the gutter, or past the right edge) has no bar.
      const gap = drag.changes ? (others[slot]?.left ?? hi) - layerLeft : null;
      setView({
        layer: { left: layerLeft, top: box.scrollTop, width: layerWidth, height },
        shade: { left: me.left - layerLeft, width },
        ghost: { left: ghost - layerLeft, width },
        // The 3px bar is centred on the gap, and kept whole at either edge of the layer.
        drop: gap === null || gap < -1 || gap > layerWidth + 1 ? null : Math.min(Math.max(0, gap - 1.5), Math.max(0, layerWidth - 3)),
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
      drag = { column, grab: contentX(press!.x) - cols[at]!.left, before: null, changes: false };
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
        // Past the threshold the press is no click, even when the column has nowhere to go.
        if (!start(press.column)) { stop(); swallowAfterRelease(); return; }
      }
      e.preventDefault();
      update();
    }
    function up() {
      const d = drag;
      const was = !!d;
      stop();
      if (was) swallowNextClick();
      if (d && d.changes) latest.current.onMove(d.column, d.before);
    }
    function cancel() { stop(); }
    function key(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !press) return;
      const was = !!drag;
      if (was) { e.preventDefault(); e.stopPropagation(); }
      stop();
      if (was) swallowAfterRelease();
    }
    const down = (e: PointerEvent) => {
      // Touch keeps scrolling the grid.
      if (e.button !== 0 || e.pointerType === 'touch') return;
      const t = e.target instanceof Element ? e.target : null;
      // A field header, or its column letter above it: both start the same drag.
      const th = t?.closest<HTMLElement>('th.dm-th[data-column], th.dm-letter[data-letter-column]');
      if (!t || !th || t.closest('.dm-hdr-controls, .dm-col-info')) return;
      press = { column: (th.dataset.column ?? th.dataset.letterColumn)!, x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    };
    thead.addEventListener('pointerdown', down);
    return () => { thead.removeEventListener('pointerdown', down); stop(); disarm(); };
  }, [scroller, head, latest]);
  return view;
}

/** The three overlays of a column drag: the shade where the column stands, the ghost under the pointer, and the drop line. */
function ColumnDragOverlay({ view }: { view: ColumnDragView }) {
  return (
    <div aria-hidden className="dm-col-layer" style={view.layer}>
      <div data-drag-shade className="dm-col-shade" style={view.shade} />
      <div data-drag-ghost className="dm-col-ghost" style={view.ghost} />
      {view.drop !== null && <div data-drop-indicator className="dm-col-drop" style={{ left: view.drop }} />}
    </div>
  );
}
