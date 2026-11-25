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
