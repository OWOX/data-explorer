import { useEffect, useRef, type RefObject } from 'react';
import type { Output } from '../../model/aggregation';
import type { Field } from '../../model/types';
import type { Row } from '../../sdk/types';
import { blockOf, selectionTsv, type GridSelection } from './copySelection';
import { outputLabel, type RowMarks } from './GridParts';

/**
 * The grid's selection, as Google Sheets has it: the cell, block, column and row selection, drag-select, the arrow keys and the copy.
 * The state itself stays with the grid, which drops it when the columns change.
 */
export function useGridSelection(
  rows: Row[] | null | undefined,
  outputs: Output[],
  charts: boolean,
  selected: GridSelection | null,
  setSelected: (next: GridSelection | null | ((cur: GridSelection | null) => GridSelection | null)) => void,
  scroller: RefObject<HTMLDivElement | null>,
  head: RefObject<HTMLTableSectionElement | null>,
  fieldOf: (o: Output) => Field,
) {
  // The selection, as Google Sheets has it: a cell (a frame and a fill handle), a block of cells (shift-click or Shift+Arrow: `to` is
  // the far end, the cell stays active), or whole columns or rows (a tint and a frame around the block); its column letters and row
  // numbers are lit. `from` is where a shift-click on a header extends from.
  type Cell = { row: number; col: number };
  const rowCount = rows?.length ?? 0;
  const inside = (c: Cell) => c.row < rowCount && c.col < outputs.length;
  // Charts has no cells to select: nothing stays lit from the table (it is cleared below too, so Table opens without it).
  const sel = !charts && selected && (selected.kind === 'cell' ? inside(selected) && (!selected.to || inside(selected.to)) : selected.kind === 'col' ? Math.max(selected.from, selected.to) < outputs.length && rowCount > 0 : Math.max(selected.from, selected.to) < rowCount) ? selected : null;
  if (charts && selected) setSelected(null);
  const cellSel = sel?.kind === 'cell' ? sel : null;
  // The cells the selection covers, from the same geometry the copy uses. A single cell has no block of its own: it has the plain frame.
  const covered = sel ? blockOf(sel, rowCount, outputs.length) : null;
  const block = covered && !(cellSel && covered.r0 === covered.r1 && covered.c0 === covered.c1) ? covered : null;
  const inCols = (i: number) => !!covered && sel!.kind !== 'row' && i >= covered.c0 && i <= covered.c1;
  const inRows = (i: number) => !!covered && sel!.kind !== 'col' && i >= covered.r0 && i <= covered.r1;
  // A header is lit light when a cell (or a block crossing it) is selected, and strong when it is itself fully selected.
  const colMark = (i: number) => (sel?.kind === 'col' ? (inCols(i) ? 'full' : undefined) : sel?.kind === 'row' ? '' : inCols(i) ? '' : undefined);
  const rowMark = (i: number) => (sel?.kind === 'row' ? (inRows(i) ? 'full' : undefined) : sel?.kind === 'col' ? '' : inRows(i) ? '' : undefined);
  // In a block, as in Sheets: the active cell is where the selection started (the clicked column's first row, the clicked
  // row's first column, or the first cell of a shift-selected block) and gets the 2px frame; the fill handle sits at the block's far corner.
  const anchor: Cell | null = sel && sel.kind !== 'cell' ? (sel.kind === 'col' ? { row: 0, col: sel.from } : { row: sel.from, col: 0 }) : block && cellSel ? { row: cellSel.row, col: cellSel.col } : null;
  const corner: Cell | null = block ? { row: block.r1, col: block.c1 } : null;
  // The selection's state in one row, as a short string: a row the selection does not change gets the same string, so it does not render.
  const marksOf = (ri: number): string => {
    const m: RowMarks = {};
    const head = rowMark(ri);
    if (head !== undefined) m.head = head;
    if (cellSel && !block && cellSel.row === ri) m.cell = cellSel.col;
    if (block && ri >= block.r0 && ri <= block.r1) m.block = [block.c0, block.c1, ri === block.r0, ri === block.r1];
    if (block && cellSel?.to?.row === ri) m.moving = cellSel.to.col;
    if (anchor?.row === ri) m.active = anchor.col;
    if (corner?.row === ri) m.handle = corner.col;
    return Object.keys(m).length ? JSON.stringify(m) : '';
  };
  const pickHeader = (kind: 'col' | 'row', i: number, extend: boolean) => setSelected((cur) => (extend && cur && cur.kind === kind ? { kind, from: cur.from, to: i } : { kind, from: i, to: i }));
  // A click selects the cell; a shift-click stretches a block from the active cell (the one a click or a header selected) to this one,
  // and does not open another record.
  // Drag-select: a press on a cell starts a block, moving over other cells stretches it, a release anywhere ends it.
  const drag = useRef<Cell | null>(null);
  const dragMoved = useRef(false);
  const endDrag = () => {
    drag.current = null;
    // The click after a drag comes right after the release; a drag that ended elsewhere gets none, so the flag is cleared after it.
    if (dragMoved.current) setTimeout(() => { dragMoved.current = false; }, 0);
  };
  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);
  const startDrag = (row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey) { e.preventDefault(); scroller.current?.focus({ preventScroll: true }); return; }
    // A cell's URL fills its cell, so a press on it starts a drag like any other press on the cell; its click opens it.
    if ((e.target as HTMLElement).closest('a:not(.dm-cell-link), button, input, textarea, select')) return;
    // No native text selection: the cells are what the drag selects.
    e.preventDefault();
    scroller.current?.focus({ preventScroll: true });
    drag.current = { row, col };
    dragMoved.current = false;
  };
  const dragOver = (row: number, col: number, e: React.MouseEvent) => {
    const from = drag.current;
    if (!from) return;
    // The button was let go outside the frame (no mouseup reached the window): the drag is over.
    if ((e.buttons & 1) === 0) { endDrag(); return; }
    if (from.row === row && from.col === col && !dragMoved.current) return;
    dragMoved.current = true;
    setSelected(from.row === row && from.col === col ? { kind: 'cell', ...from } : { kind: 'cell', ...from, to: { row, col } });
  };
  // The click that ends a drag is cancelled before it reaches a cell's URL, so it opens nothing.
  const cancelDragClick = (e: React.MouseEvent) => { if (dragMoved.current) e.preventDefault(); };
  const pickCell = (row: number, col: number, e: React.MouseEvent) => {
    // The click that ends a drag is no click on a cell: the block stays and no record opens.
    if (dragMoved.current) { e.stopPropagation(); dragMoved.current = false; return; }
    if (e.shiftKey && sel) {
      e.stopPropagation();
      const from: Cell = sel.kind === 'cell' ? { row: sel.row, col: sel.col } : sel.kind === 'col' ? { row: 0, col: sel.from } : { row: sel.from, col: 0 };
      setSelected(from.row === row && from.col === col ? { kind: 'cell', ...from } : { kind: 'cell', ...from, to: { row, col } });
      return;
    }
    setSelected({ kind: 'cell', row, col });
    // A click on a URL opens the URL only: the row's record stays closed.
    if ((e.target as HTMLElement).closest('.dm-cell-link')) e.stopPropagation();
  };
  useEffect(() => {
    const box = scroller.current;
    const cell = box?.querySelector<HTMLElement>('td[data-selected], td[data-moving]');
    if (!box || !cell) return;
    // The sticky header and number column cover the box's edges: the cell is kept clear of them.
    // The header's height is only known after layout, so it is written to the element here (a ref's style, not state).
    // eslint-disable-next-line react-hooks/immutability
    box.style.scrollPaddingTop = `${head.current?.offsetHeight ?? 0}px`;
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [scroller, head, cellSel?.row, cellSel?.col, cellSel?.to?.row, cellSel?.to?.col]);
  // A right click on a link selects its text (macOS). When the grid's selection moves on, that range goes: onCopy leaves a range inside the grid to the browser,
  // so Cmd+C would copy the old text. A range outside the grid or inside a field stays, and so does one when the selection is dropped (the click that ends a drag over the data mart title).
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;
    if (!selected) return;
    const range = window.getSelection();
    const at = range?.anchorNode;
    if (!range || range.isCollapsed || !at || !scroller.current?.contains(at)) return;
    if (!(at instanceof Element ? at : at.parentElement)?.closest('input, textarea, select, [contenteditable]')) range.removeAllRanges();
  }, [selected, scroller]);
  // Ctrl/Cmd+C: the selection goes to the clipboard as tab-separated text, as it is displayed. The copy event needs no clipboard permission,
  // so it works in the plugin's sandboxed frame. Fields, menus and a text range the reader selected inside a cell keep the browser's own copy.
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!sel || !e.currentTarget.contains(target) || target.closest('thead, input, textarea, select, [role=menu], [role=dialog]')) return;
    const range = window.getSelection();
    if (range && !range.isCollapsed && range.anchorNode && e.currentTarget.contains(range.anchorNode)) return;
    const body = e.currentTarget.querySelectorAll<HTMLTableRowElement>('tbody > tr');
    const text = selectionTsv(sel, { rows: rowCount, cols: outputs.length }, {
      cell: (r, c) => body[r]?.querySelectorAll(':scope > td:not([aria-hidden])')[c]?.textContent ?? '',
      header: (c) => { const o = outputs[c]!; return outputLabel(fieldOf(o), o); },
    });
    if (text === null) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Popovers render outside the grid but their events bubble here; fields and the header keep their own keys.
    if (!e.currentTarget.contains(target) || target.closest('thead, input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { if (sel) { e.preventDefault(); setSelected(null); } return; }
    if (e.key === 'Enter') {
      // A single selected cell opens its URL. A focused link or button (a right click leaves the link focused) keeps its own Enter.
      if (e.repeat || e.shiftKey || sel?.kind !== 'cell' || sel.to || target.closest('button, a, [role=button]')) return;
      const link = e.currentTarget.querySelector<HTMLElement>('td[data-selected] .dm-cell-link');
      if (link) { e.preventDefault(); link.click(); }
      return;
    }
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step || rowCount === 0 || outputs.length === 0) return;
    // Keys on a button or link inside a cell are theirs; the grid itself and a cell move the selection.
    if (target !== e.currentTarget && target.closest('button, a:not(.dm-cell-link), [role=button]')) return;
    e.preventDefault();
    // The selection moves on, so a link a right click focused must not keep the focus: Enter would open it, not the new cell.
    if (target.closest('.dm-cell-link')) scroller.current?.focus({ preventScroll: true });
    // From a whole column or row the keys land on a single cell: the first one of the block's last column or row.
    const at: Cell | null = !sel ? null : sel.kind === 'cell' ? { row: sel.row, col: sel.col } : sel.kind === 'col' ? { row: 0, col: sel.to } : { row: sel.to, col: 0 };
    const move = (c: Cell): Cell => ({ row: Math.min(rowCount - 1, Math.max(0, c.row + step[0]!)), col: Math.min(outputs.length - 1, Math.max(0, c.col + step[1]!)) });
    if (e.shiftKey && sel?.kind === 'cell') {
      // Shift+Arrow moves the far end of the block; the first cell stays active, and a block shrunk to that cell is a plain cell again.
      const far = move(sel.to ?? sel);
      setSelected(far.row === sel.row && far.col === sel.col ? { kind: 'cell', row: sel.row, col: sel.col } : { kind: 'cell', row: sel.row, col: sel.col, to: far });
      return;
    }
    setSelected({ kind: 'cell', ...(at ? move(at) : { row: 0, col: 0 }) });
  };
  return { marksOf, colMark, pickHeader, startDrag, dragOver, pickCell, cancelDragClick, onCopy, onGridKey, dragMoved };
}
