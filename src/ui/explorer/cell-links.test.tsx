import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const LINK = 'https://example.com/orders/1?tab=items';

/** The demo orders, with a URL in every status. */
async function setup(distinct = false) {
  const fixtures = demoFixtures();
  fixtures.marts.find((m) => m.id === 'orders')!.rows.forEach((r, i) => { r.status = distinct ? `${LINK}&n=${i}` : LINK; });
  const open = vi.fn(async () => {});
  const mock = createMockCtx(fixtures, { latencyMs: 0 });
  const ctx = { ...mock, ui: { ...mock.ui, openExternal: open } };
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(links().length).toBeGreaterThan(2));
  return open;
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const links = () => within(data()).queryAllByRole('link').filter((a) => a.classList.contains('dm-cell-link'));
const cellOf = (el: Element) => el.closest('td')!;

test('a click on a URL in the grid opens it and selects its cell, and opens no record', async () => {
  const open = await setup();
  const link = links()[0]!;
  fireEvent.mouseDown(link); fireEvent.mouseUp(link); fireEvent.click(link);
  expect(open).toHaveBeenCalledExactlyOnceWith(LINK);
  expect(cellOf(links()[0]!)).toHaveAttribute('data-selected');
  // A record loads asynchronously: the Row band gets time to fill before it is read.
  await new Promise((r) => setTimeout(r, 300));
  expect(within(row()).queryByRole('link', { name: LINK })).toBeNull();
});

test('a drag over URL cells selects a block and opens nothing', async () => {
  const open = await setup();
  const [a, b] = links() as [HTMLElement, HTMLElement];
  fireEvent.mouseDown(a);
  fireEvent.mouseEnter(cellOf(b), { buttons: 1 });
  expect(cellOf(links()[1]!)).toHaveAttribute('data-range');
  // Back to the cell it started in: the browser then fires a click on that very link.
  fireEvent.mouseEnter(cellOf(a), { buttons: 1 });
  fireEvent.mouseUp(a); fireEvent.click(a);
  expect(open).not.toHaveBeenCalled();
});

test('a shift-click on a URL stretches the block and opens nothing', async () => {
  const open = await setup();
  const cell = cellOf(links()[0]!);
  fireEvent.mouseDown(cell); fireEvent.mouseUp(cell); fireEvent.click(cell);
  fireEvent.click(links()[2]!, { shiftKey: true });
  expect(cellOf(links()[2]!)).toHaveAttribute('data-range');
  expect(open).not.toHaveBeenCalled();
});

test('a URL in the Row band opens', async () => {
  const open = await setup();
  fireEvent.click(cellOf(links()[0]!).closest('tr')!);
  fireEvent.click(await within(row()).findByRole('link', { name: LINK }));
  expect(open).toHaveBeenCalledExactlyOnceWith(LINK);
});

const selected = () => data().querySelector('td[data-selected]');
const press = (el: Element, key: string) => fireEvent.keyDown(el, { key });
const root = () => data().querySelector<HTMLElement>('.dm-grid-root')!;
const select = (cell: Element) => { fireEvent.mouseDown(cell); fireEvent.mouseUp(cell); fireEvent.click(cell); };

test('arrow keys move the selection from a link a right click focused', async () => {
  await setup();
  const link = links()[0]!;
  select(cellOf(link));
  link.focus();
  press(link, 'ArrowDown');
  expect(selected()).toBe(cellOf(links()[1]!));
});

test('Enter on a selected cell opens its URL once', async () => {
  const open = await setup();
  select(cellOf(links()[0]!));
  expect(fireEvent.keyDown(root(), { key: 'Enter' })).toBe(false);
  expect(open).toHaveBeenCalledExactlyOnceWith(LINK);
});

test('Enter on a link a right click focused is left to the browser, so it opens once', async () => {
  const open = await setup();
  const link = links()[0]!;
  select(cellOf(link));
  link.focus();
  expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

test('Enter on a button inside a cell does not open the selected cell URL', async () => {
  const open = await setup();
  const cell = cellOf(links()[0]!);
  select(cell);
  const button = document.createElement('button');
  cell.appendChild(button);
  press(button, 'Enter');
  expect(open).not.toHaveBeenCalled();
});

test('Enter with a modifier or as a key repeat opens nothing', async () => {
  const open = await setup();
  select(cellOf(links()[0]!));
  for (const mod of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) {
    expect(fireEvent.keyDown(root(), { key: 'Enter', ...mod })).toBe(true);
  }
  expect(open).not.toHaveBeenCalled();
});

test('Enter on a whole column or row opens nothing', async () => {
  const open = await setup();
  fireEvent.click(data().querySelector('th.dm-letter')!);
  expect(fireEvent.keyDown(root(), { key: 'Enter' })).toBe(true);
  fireEvent.click(data().querySelector('tbody th[aria-hidden]')!);
  expect(fireEvent.keyDown(root(), { key: 'Enter' })).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

test('after an arrow key from a focused link, the grid has focus and Enter opens the newly selected cell only', async () => {
  const open = await setup(true);
  select(cellOf(links()[0]!));
  links()[1]!.focus();
  press(links()[1]!, 'ArrowDown');
  expect(selected()).toBe(cellOf(links()[1]!));
  expect(document.activeElement).toBe(root());
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(open).toHaveBeenCalledExactlyOnceWith(links()[1]!.getAttribute('href'));
});

test('Shift+Arrow from a focused link leaves the grid focused, and Enter then opens nothing', async () => {
  const open = await setup(true);
  select(cellOf(links()[0]!));
  links()[0]!.focus();
  fireEvent.keyDown(links()[0]!, { key: 'ArrowDown', shiftKey: true });
  expect(document.activeElement).toBe(root());
  expect(fireEvent.keyDown(document.activeElement!, { key: 'Enter' })).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

test('Enter does nothing on a cell without a URL, a block, a column or a row', async () => {
  const open = await setup();
  const plain = [...data().querySelectorAll('tbody td:not([aria-hidden])')].find((td) => !td.querySelector('.dm-cell-link'))!;
  select(plain);
  expect(fireEvent.keyDown(root(), { key: 'Enter' })).toBe(true);
  const [a, b] = links() as [HTMLElement, HTMLElement];
  fireEvent.mouseDown(a);
  fireEvent.mouseEnter(cellOf(b), { buttons: 1 });
  fireEvent.mouseUp(a);
  expect(data().querySelector('td[data-range]')).not.toBeNull();
  expect(fireEvent.keyDown(root(), { key: 'Enter' })).toBe(true);
  expect(open).not.toHaveBeenCalled();
});
