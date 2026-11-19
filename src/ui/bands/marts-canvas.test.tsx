import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Mart, Model } from '../../model/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { TooltipProvider } from '../Tooltip';
import { MartsCanvas } from './MartsCanvas';

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const marts = () => document.getElementById('band-marts')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
const gridCard = (title: string) => within(marts()).getByText(title).closest('article')!;
const el = (id: string) => marts().querySelector<HTMLElement>(`article#dm-${id}`);
const ghosts = () => [...marts().querySelectorAll<HTMLElement>('article[data-ghost]')].map((a) => a.id);
const toCanvas = async () => {
  const group = within(marts()).getByRole('radiogroup', { name: 'Show data marts as' });
  await userEvent.click(within(group).getByRole('radio', { name: 'Canvas' }));
};

test('canvas shows the main mart and its joined marts as a tree', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  fireEvent.click(gridCard('Customers'));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await toCanvas();
  await waitFor(() => expect(el('customers')).not.toBeNull());
  expect(el('orders')).not.toBeNull();
  expect(el('products')).toBeNull();
  const left = (id: string) => parseFloat(el(id)!.parentElement!.style.left);
  expect(left('customers')).toBeGreaterThan(left('orders'));
  expect(marts().querySelector('[data-ghost]')).toBeNull();
});

test('hovering a card shows its ghosts; clicking a ghost adds that mart through that path', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghosts()).toEqual(expect.arrayContaining(['dm-customers', 'dm-products', 'dm-stores'])));
  await userEvent.click(marts().querySelector<HTMLElement>('article#dm-customers[data-ghost]')!);
  await waitFor(() => expect(el('customers')).not.toHaveAttribute('data-ghost'));
  expect(el('customers')).not.toBeNull();
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  expect(headers().length).toBeGreaterThan(5);
});

test('clicking a card pins its ghosts; Escape lets them go', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  expect(el('orders')).toHaveAttribute('aria-pressed', 'true');
  expect(groupTitles()).toEqual(['Orders']);
  await userEvent.unhover(el('orders')!);
  await new Promise((r) => setTimeout(r, 600));
  expect(ghosts().length).toBeGreaterThan(0);
  expect(groupTitles()).toEqual(['Orders']);
  expect(el('orders')).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(ghosts()).toEqual([]));
});

test('clicking the empty canvas lets the pinned ghosts go', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.unhover(el('orders')!);
  await userEvent.click(within(marts()).getByTestId('marts-canvas'));
  await waitFor(() => expect(ghosts()).toEqual([]));
});

test('with joined sources not loaded, the canvas shows the main card alone', async () => {
  const mart: Mart = { id: 'orders', title: 'Orders', description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null };
  const model = { marts: new Map([['orders', mart]]), sources: [], edges: [], contexts: [], failedStorages: [] } as unknown as Model;
  render(
    <TooltipProvider>
      <MartsCanvas model={model} mainId="orders" columns={['id']} sources={null} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} />
    </TooltipProvider>,
  );
  expect(document.querySelectorAll('article')).toHaveLength(1);
  await userEvent.hover(document.querySelector('article')!);
  expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(0);
});

const pointer = (clientX: number, clientY: number, buttons = 1) => ({ clientX, clientY, button: 0, buttons, pointerId: 1 });
const centre = (id: string) => {
  const w = el(id)!.parentElement!;
  return { x: parseFloat(w.style.left) + 112, y: parseFloat(w.style.top) + 56 };
};
const tips = () => [...marts().querySelectorAll<SVGPathElement>('#tree-wires path[data-tip]')].map((p) => p.dataset.tip);
const wrapper = (id: string) => el(id)!.parentElement!;
const joinCountriesUnderCustomers = async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  vi.spyOn(marts().querySelector('.dm-tree')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article#dm-customers[data-ghost]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article#dm-stores[data-ghost]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores']));
  await userEvent.hover(el('customers')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article#dm-countries[data-ghost]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores', 'Countries']));
};

test('dragging countries from customers onto stores moves its columns to the stores path', async () => {
  await joinCountriesUnderCustomers();
  await waitFor(() => expect(tips()).toContain('Customers → Countries'));
  const stores = () => centre('stores');
  const c = () => centre('countries');
  const storesClass = el('stores')!.className;
  fireEvent.pointerDown(el('countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(window, pointer(c().x + 40, c().y));
  fireEvent.pointerMove(window, pointer(stores().x, stores().y));
  await waitFor(() => expect(wrapper('orders')).toHaveClass('dm-dimmed'));
  expect(wrapper('stores')).not.toHaveClass('dm-dimmed');
  expect(wrapper('customers')).toHaveClass('dm-dimmed');
  expect(marts().querySelectorAll('svg#drag-line path')).toHaveLength(1);
  expect(el('stores')!.className).toBe(storesClass);
  fireEvent.pointerUp(el('stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
  expect(tips()).not.toContain('Customers → Countries');
  expect(marts().querySelector('svg#drag-line path')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /undo/i }));
  await waitFor(() => expect(tips()).toContain('Customers → Countries'));
});

test('Escape or a release away from any target changes nothing, and the next click still works', async () => {
  await joinCountriesUnderCustomers();
  const before = headers();
  const c = () => centre('countries');
  fireEvent.pointerDown(el('countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(window, pointer(c().x + 40, c().y));
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).toBeNull());
  fireEvent.pointerUp(window, pointer(c().x + 40, c().y, 0));
  expect(headers()).toEqual(before);
  fireEvent.pointerDown(el('countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(window, pointer(c().x + 40, c().y));
  fireEvent.pointerUp(document.body, pointer(5, 5, 0));
  await new Promise((r) => setTimeout(r, 20));
  expect(headers()).toEqual(before);
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
});
