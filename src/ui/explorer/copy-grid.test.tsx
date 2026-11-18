import { fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const dataRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const ready = () => waitFor(() => expect(dataRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));
const cellsOf = (r: HTMLElement) => Array.from(r.querySelectorAll(':scope > td:not([aria-hidden])')) as HTMLElement[];
const scroller = () => data().querySelector<HTMLElement>('.dm-grid-root')!;

/** Fires a copy event at the target and returns what the grid put on the clipboard (null: it left the copy alone). */
function copy(target: Element) {
  const setData = vi.fn();
  const notCancelled = fireEvent.copy(target, { clipboardData: { setData } });
  return setData.mock.calls.length ? { type: setData.mock.calls[0]![0], text: setData.mock.calls[0]![1] as string, cancelled: !notCancelled } : null;
}

test('a clicked cell is copied as its displayed text', async () => {
  setup(); await ready();
  const cell = cellsOf(dataRows()[1]!)[0]!;
  await userEvent.click(cell);
  const out = copy(scroller());
  expect(out).toEqual({ type: 'text/plain', text: cell.textContent, cancelled: true });
});

test('a shift-clicked block is rows by newline and cells by tab', async () => {
  setup(); await ready();
  const rows = dataRows();
  await userEvent.click(cellsOf(rows[0]!)[0]!);
  await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowRight}{/Shift}');
  const expected = [0, 1].map((r) => cellsOf(rows[r]!).slice(0, 2).map((c) => c.textContent).join('\t')).join('\n');
  expect(copy(scroller())!.text).toBe(expected);
});

test('a whole column is its title and every value', async () => {
  setup(); await ready();
  const th = within(data()).getAllByText('A')[0]!.closest('th')!;
  await userEvent.click(th);
  // The visible title is the first labelled column header (the letter header above it is not a title).
  const label = within(data()).getAllByRole('columnheader').find((h) => h.querySelector('.dm-hdr'))!.querySelector('.dm-hdr')!.textContent!.trim();
  const lines = copy(scroller())!.text.split('\n');
  expect(lines).toHaveLength(dataRows().length + 1);
  expect(lines.slice(1)).toEqual(dataRows().map((r) => cellsOf(r)[0]!.textContent));
  expect(lines[0]).toBe(label);
});

test('a whole row is that row\'s cells', async () => {
  setup(); await ready();
  const rows = dataRows();
  await userEvent.click(rows[2]!.querySelector('th')!);
  expect(copy(scroller())!.text).toBe(cellsOf(rows[2]!).map((c) => c.textContent).join('\t'));
});

test('a click on the data mart title drops a whole column or row selection', async () => {
  setup(); await ready();
  const title = () => data().querySelector<HTMLElement>('th[data-group] .truncate')!;
  await userEvent.click(within(data()).getAllByText('A')[0]!.closest('th')!);
  expect(data().querySelector('thead .dm-letter[data-selected]')).not.toBeNull();
  await userEvent.click(title());
  expect(data().querySelector('[data-selected]')).toBeNull();
  await userEvent.click(dataRows()[2]!.querySelector('th')!);
  expect(data().querySelector('[data-selected]')).not.toBeNull();
  await userEvent.click(title());
  expect(data().querySelector('[data-selected]')).toBeNull();
  // The Fields button in the same cell is not the title: the selection stays.
  await userEvent.click(within(data()).getAllByText('A')[0]!.closest('th')!);
  await userEvent.click(within(data()).getByRole('button', { name: /^Fields of / }));
  expect(data().querySelector('thead .dm-letter[data-selected]')).not.toBeNull();
});

test('nothing is selected: the browser copies as usual', async () => {
  setup(); await ready();
  expect(copy(scroller())).toBeNull();
});

test('a copy from a field or a text range inside a cell is left alone', async () => {
  setup(); await ready();
  const cell = cellsOf(dataRows()[0]!)[0]!;
  await userEvent.click(cell);
  const box = document.createElement('input');
  scroller().appendChild(box);
  expect(copy(box)).toBeNull();
  box.remove();
  const range = document.createRange();
  range.selectNodeContents(cell);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  expect(copy(scroller())).toBeNull();
  window.getSelection()!.removeAllRanges();
});

test('dragging from one cell to another selects the block and opens no record', async () => {
  setup(); await ready();
  const rows = dataRows();
  const from = cellsOf(rows[0]!)[0]!;
  const to = cellsOf(rows[2]!)[1]!;
  const down = fireEvent.mouseDown(from, { button: 0 });
  // Native text selection is cancelled.
  expect(down).toBe(false);
  fireEvent.mouseEnter(cellsOf(rows[1]!)[1]!, { buttons: 1 });
  fireEvent.mouseEnter(to, { buttons: 1 });
  fireEvent.mouseUp(to);
  fireEvent.click(to);
  const expected = [0, 1, 2].map((r) => cellsOf(rows[r]!).slice(0, 2).map((c) => c.textContent).join('\t')).join('\n');
  expect(copy(scroller())!.text).toBe(expected);
  expect(document.querySelector('[data-range]')).not.toBeNull();
  expect(document.querySelectorAll('td[data-range]')).toHaveLength(6);
});

test('a drag that comes back to its first cell is a plain cell', async () => {
  setup(); await ready();
  const rows = dataRows();
  const from = cellsOf(rows[0]!)[0]!;
  fireEvent.mouseDown(from, { button: 0 });
  fireEvent.mouseEnter(cellsOf(rows[1]!)[0]!, { buttons: 1 });
  fireEvent.mouseEnter(from, { buttons: 1 });
  fireEvent.mouseUp(from);
  expect(document.querySelectorAll('td[data-range]')).toHaveLength(0);
  expect(document.querySelectorAll('td[data-selected]')).toHaveLength(1);
});

test('a button released outside the frame ends the drag: hovering on no longer extends it and the next click is a plain click', async () => {
  setup(); await ready();
  const rows = dataRows();
  const from = cellsOf(rows[0]!)[0]!;
  fireEvent.mouseDown(from, { button: 0 });
  fireEvent.mouseEnter(cellsOf(rows[1]!)[1]!, { buttons: 1 });
  expect(document.querySelectorAll('td[data-range]')).toHaveLength(4);
  // No mouseup reaches the window; the next hover reports no button held.
  fireEvent.mouseEnter(cellsOf(rows[2]!)[1]!, { buttons: 0 });
  fireEvent.mouseEnter(cellsOf(rows[3]!)[1]!, { buttons: 0 });
  expect(document.querySelectorAll('td[data-range]')).toHaveLength(4);
  // dragMoved is cleared after a tick, so the click on a cell selects it instead of being swallowed.
  await new Promise((r) => setTimeout(r, 5));
  const target = cellsOf(rows[3]!)[0]!;
  fireEvent.click(target);
  expect(document.querySelectorAll('td[data-range]')).toHaveLength(0);
  expect(target).toHaveAttribute('data-selected');
});
