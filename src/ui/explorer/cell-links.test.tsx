import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const LINK = 'https://example.com/orders/1?tab=items';

/** The demo orders, with a URL in every status. */
async function setup() {
  const fixtures = demoFixtures();
  for (const r of fixtures.marts.find((m) => m.id === 'orders')!.rows) r.status = LINK;
  const open = vi.fn(async () => {});
  const mock = createMockCtx(fixtures, { latencyMs: 0 });
  const ctx = { ...mock, ui: { ...mock.ui, openExternal: open } };
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(links().length).toBeGreaterThan(2));
  return open;
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const links = () => within(data()).queryAllByRole('link', { name: LINK });
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

test('Enter on a button in the grid does not open the selected cell URL', async () => {
  const open = await setup();
  select(cellOf(links()[0]!));
  const button = data().querySelector('.dm-grid-root button')!;
  press(button, 'Enter');
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
