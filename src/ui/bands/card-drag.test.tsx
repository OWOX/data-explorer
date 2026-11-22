import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { martElementId } from './cards';

// Drag rules in the Grid: only a joined card is dragged, to rejoin it under the closest mart it can join. Making a mart main is the header's button.
function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const marts = () => document.getElementById('band-marts')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
const cards = () => [...marts().querySelectorAll<HTMLElement>('article')];
const el = (id: string, path?: string) => cards().find((a) => a.id === martElementId(id, path) && !a.hasAttribute('data-ghost')) ?? null;
const letGo = () => fireEvent.keyDown(document, { key: 'Escape' });
const bandCard = (id: string) => within(marts()).findByText(new RegExp(`^${id}$`)).then((t) => t.closest('article')!);
const pointer = (x: number, y: number, buttons = 1) => ({ clientX: x, clientY: y, button: 0, buttons, pointerId: 1 });
const paths = () => [...document.querySelectorAll<SVGPathElement>('svg#drag-line path')];
const joinedLines = () => paths().filter((p) => p.classList.contains('joined')).map((p) => p.dataset.target);
const dashedLines = () => paths().filter((p) => p.classList.contains('ghost')).map((p) => p.dataset.target).sort();
const closestLine = () => paths().filter((p) => p.classList.contains('closest')).map((p) => p.dataset.target);
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!);

// jsdom has no layout: each card gets a box of its own, so the drag can tell which one is closest.
const BOXES: Record<string, [number, number]> = { 'dm-orders': [0, 0], 'dm-customers@customers': [400, 0], 'dm-stores@stores': [800, 0], 'dm-countries@customers.countries': [400, 300] };
const place = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  const [x, y] = BOXES[this.id] ?? [0, 2000];
  return { left: x, top: y, right: x + 200, bottom: y + 100, width: 200, height: 100, x, y, toJSON: () => ({}) };
});
const centre = (id: string) => ({ x: BOXES[id]![0] + 100, y: BOXES[id]![1] + 50 });

/** Orders with Customers and Stores joined, and Countries under Customers. */
async function join() {
  await ready();
  fireEvent.click(await bandCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  letGo();
  fireEvent.click(await bandCard('Stores'));
  await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
  letGo();
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  letGo();
  place();
}
const held = () => el('countries', 'customers.countries')!;
const startDrag = () => {
  const c = centre('dm-countries@customers.countries');
  fireEvent.pointerDown(held(), pointer(c.x, c.y));
  fireEvent.pointerMove(window, pointer(c.x + 40, c.y));
};
const body = () => marts().querySelector<HTMLElement>('.dm-band-body')!;
const moveTo = (id: string) => fireEvent.pointerMove(body(), pointer(centre(id).x, centre(id).y));
const releaseAt = (id: string) => fireEvent.pointerUp(el(id.replace(/^dm-/, '').split('@')[0]!, id.split('@')[1])!, pointer(centre(id).x, centre(id).y, 0));

afterEach(() => vi.restoreAllMocks());

test('a card in the band, or the main card, is not dragged; a drop on the main card makes nothing main', async () => {
  setup();
  await ready();
  place();
  const customers = await bandCard('Customers');
  fireEvent.pointerDown(customers, pointer(0, 2000));
  fireEvent.pointerMove(window, pointer(40, 2000));
  fireEvent.pointerMove(window, pointer(centre('dm-orders').x, centre('dm-orders').y));
  expect(document.querySelector('.dm-drag-ghost')).toBeNull();
  expect(marts().querySelector('.dm-faded:not(.dm-offpath)')).toBeNull();
  fireEvent.pointerUp(el('orders')!, pointer(centre('dm-orders').x, centre('dm-orders').y, 0));
  fireEvent.click(customers);
  // The click still joins it: a plain click is a click.
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  letGo();
  // A joined card dropped on the main card stays under it: no mart became main.
  const c = centre('dm-customers@customers');
  fireEvent.pointerDown(el('customers', 'customers')!, pointer(c.x, c.y));
  fireEvent.pointerMove(window, pointer(c.x + 40, c.y));
  fireEvent.pointerUp(el('orders')!, pointer(centre('dm-orders').x, centre('dm-orders').y, 0));
  await new Promise((r) => setTimeout(r, 50));
  expect(groupTitles()).toEqual(['Orders', 'Customers']);
  expect(el('orders')).toHaveAttribute('aria-pressed', 'true');
});

test('a held joined card dims what it cannot join under, and draws a solid line to its parent and dashed ones to the other targets', async () => {
  setup();
  await join();
  startDrag();
  await waitFor(() => expect(paths().length).toBeGreaterThan(0));
  moveTo('dm-stores@stores');
  await waitFor(() => expect(closestLine()).toEqual(['stores']));
  // Targets and the held card stay at full strength; the rest drop to the shared half dim.
  expect(el('customers', 'customers')).not.toHaveClass('dm-faded');
  expect(el('stores', 'stores')).not.toHaveClass('dm-faded');
  expect(held()).not.toHaveClass('dm-faded');
  expect(el('orders')).toHaveClass('dm-faded');
  expect(marts().querySelector('article:not([data-path]):not(.dm-faded)')).toBeNull();
  // Solid to the mart it is joined under now, dashed to the other target.
  expect(joinedLines()).toEqual(['customers']);
  expect(dashedLines()).toEqual(['stores']);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(paths()).toHaveLength(0));
  expect(marts().querySelector('.dm-faded:not(.dm-offpath)')).toBeNull();
  fireEvent.pointerUp(window, pointer(0, 0, 0));
});

test('dropping on a closer target rejoins the card under it, in one Undo step', async () => {
  setup();
  await join();
  startDrag();
  moveTo('dm-stores@stores');
  await waitFor(() => expect(closestLine()).toEqual(['stores']));
  releaseAt('dm-stores@stores');
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  expect(el('countries', 'customers.countries')).toBeNull();
  expect(paths()).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: /undo/i }));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  expect(el('countries', 'stores.countries')).toBeNull();
});

test('dropping nearest to the current parent changes nothing', async () => {
  setup();
  await join();
  const before = headers();
  startDrag();
  moveTo('dm-customers@customers');
  await waitFor(() => expect(closestLine()).toEqual(['customers']));
  expect(joinedLines()).toEqual(['customers']);
  releaseAt('dm-customers@customers');
  await new Promise((r) => setTimeout(r, 50));
  expect(el('countries', 'customers.countries')).not.toBeNull();
  expect(headers()).toEqual(before);
  expect(paths()).toHaveLength(0);
});

test('a release over another band does nothing; a release over the Data Marts band counts', async () => {
  setup();
  await join();
  startDrag();
  moveTo('dm-stores@stores');
  await waitFor(() => expect(closestLine()).toEqual(['stores']));
  fireEvent.pointerMove(data(), pointer(centre('dm-stores@stores').x, centre('dm-stores@stores').y));
  await waitFor(() => expect(closestLine()).toEqual([]));
  fireEvent.pointerUp(data(), pointer(centre('dm-stores@stores').x, centre('dm-stores@stores').y, 0));
  await new Promise((r) => setTimeout(r, 50));
  expect(el('countries', 'customers.countries')).not.toBeNull();
  expect(el('countries', 'stores.countries')).toBeNull();
});

test('Escape in a drag only cancels the drag: the Grid focus stays', async () => {
  setup();
  await join();
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
  startDrag();
  await waitFor(() => expect(paths().length).toBeGreaterThan(0));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(paths()).toHaveLength(0));
  expect(el('customers', 'customers')).toHaveAttribute('data-focused');
  fireEvent.pointerUp(window, pointer(0, 0, 0));
  // The next Escape lets the focus go.
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(el('customers', 'customers')).not.toHaveAttribute('data-focused'));
});

test('hovering during a drag lights nothing', async () => {
  setup();
  await join();
  startDrag();
  await waitFor(() => expect(paths().length).toBeGreaterThan(0));
  fireEvent.pointerOver(el('orders')!);
  await new Promise((r) => setTimeout(r, 50));
  expect(document.querySelectorAll('#wires path.lit')).toHaveLength(0);
  fireEvent.keyDown(document, { key: 'Escape' });
});
