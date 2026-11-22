import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createPreferences } from '../../api/preferences';
import type { Mart, Model } from '../../model/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { TooltipProvider } from '../Tooltip';
import { martElementId } from './cards';
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
const el = (id: string, path?: string) => [...marts().querySelectorAll<HTMLElement>('article')].find((a) => a.id === martElementId(id, path) && !a.hasAttribute('data-ghost')) ?? null;
const ghosts = () => [...marts().querySelectorAll<HTMLElement>('article[data-ghost]')].map((a) => a.id);
const toCanvas = async () => {
  const group = within(marts()).getByRole('radiogroup', { name: 'Show data marts as' });
  await userEvent.click(within(group).getByRole('radio', { name: 'Graph' }));
};

test('canvas shows the main mart and its joined marts as a tree', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  fireEvent.click(gridCard('Customers'));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await toCanvas();
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  expect(el('orders')).not.toBeNull();
  expect(el('products')).toBeNull();
  const left = (id: string, path?: string) => parseFloat(el(id, path)!.parentElement!.style.left);
  expect(left('customers', 'customers')).toBeGreaterThan(left('orders'));
  expect(marts().querySelector('[data-ghost]')).toBeNull();
});

test('hovering a card shows its ghosts; clicking a ghost adds that mart through that path', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghosts()).toEqual(expect.arrayContaining(['dm-customers@customers', 'dm-products@products', 'dm-stores@stores'])));
  await userEvent.click(marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]')!);
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  expect(el('customers', 'customers')).not.toBeNull();
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  expect(headers().length).toBeGreaterThan(5);
});

test('a ghost keeps its place while the pointer is in its tooltip', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  const ghost = await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; });
  await userEvent.hover(ghost.querySelector<HTMLElement>('.dm-node-title')!);
  const bubble = await waitFor(() => { const b = document.querySelector<HTMLElement>('.dm-hint-body'); expect(b).not.toBeNull(); return b!; });
  expect(marts().contains(bubble)).toBe(false);
  fireEvent.pointerOver(bubble);
  await new Promise((r) => setTimeout(r, 600));
  expect(ghosts()).toContain('dm-customers@customers');
  expect(document.querySelector('.dm-hint-body')).not.toBeNull();
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
const centre = (id: string, path?: string) => {
  const w = el(id, path)!.parentElement!;
  return { x: parseFloat(w.style.left) + 112, y: parseFloat(w.style.top) + 56 };
};
const tips = () => [...marts().querySelectorAll<SVGPathElement>('#tree-wires path[data-tip]:not(.ghost)')].map((p) => p.dataset.tip);
const treeEl = () => marts().querySelector<HTMLElement>('.dm-tree')!;
const joinCountriesUnderCustomers = async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  vi.spyOn(marts().querySelector('.dm-tree')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  // The added card is pinned: let the pin go so the next ghost is looked up under the card hovered.
  await userEvent.keyboard('{Escape}');
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="stores"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores']));
  await userEvent.keyboard('{Escape}');
  await userEvent.hover(el('customers', 'customers')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="countries"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores', 'Countries']));
  await userEvent.keyboard('{Escape}');
};

test('dragging countries from customers onto stores moves its columns to the stores path', async () => {
  await joinCountriesUnderCustomers();
  await waitFor(() => expect(tips()).toContain('Customers → Countries'));
  const stores = () => centre('stores', 'stores');
  const c = () => centre('countries', 'customers.countries');
  const storesClass = el('stores', 'stores')!.className;
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  // What the card cannot join under takes the shared half dim; every target stays at full strength.
  await waitFor(() => expect(el('orders')).toHaveClass('dm-faded'));
  expect(el('stores', 'stores')).not.toHaveClass('dm-faded');
  expect(el('customers', 'customers')).not.toHaveClass('dm-faded');
  expect(el('countries', 'customers.countries')).not.toHaveClass('dm-faded');
  // A dashed line runs to every target but the current parent, whose own tree wire stays the one solid line; the closest one is drawn stronger.
  const lines = [...marts().querySelectorAll('svg#drag-line path')];
  expect(lines.map((l) => l.getAttribute('data-target'))).toEqual(['stores']);
  expect(lines[0]).toHaveClass('ghost');
  expect(tips()).toContain('Customers → Countries');
  expect(lines.filter((l) => l.classList.contains('closest')).map((l) => l.getAttribute('data-target'))).toEqual(['stores']);
  expect(el('stores', 'stores')!.className).toBe(storesClass);
  fireEvent.pointerUp(el('stores', 'stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
  expect(tips()).not.toContain('Customers → Countries');
  expect(marts().querySelector('svg#drag-line path')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /undo/i }));
  await waitFor(() => expect(tips()).toContain('Customers → Countries'));
});

test('Escape or a release away from any target changes nothing, and the next click still works', async () => {
  await joinCountriesUnderCustomers();
  const before = headers();
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).toBeNull());
  fireEvent.pointerUp(window, pointer(c().x + 40, c().y, 0));
  fireEvent.click(el('orders')!);
  expect(ghosts()).toEqual([]);
  expect(headers()).toEqual(before);
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerUp(document.body, pointer(5, 5, 0));
  await new Promise((r) => setTimeout(r, 20));
  expect(headers()).toEqual(before);
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
});

test('releasing near the current parent changes nothing and leaves the wires alone', async () => {
  await joinCountriesUnderCustomers();
  const before = headers();
  await waitFor(() => expect(tips()).toContain('Customers → Countries'));
  const tipsBefore = tips();
  const c = () => centre('countries', 'customers.countries');
  const cu = () => centre('customers', 'customers');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(cu().x, cu().y));
  await waitFor(() => expect(marts().querySelectorAll('svg#drag-line path')).toHaveLength(1));
  fireEvent.pointerUp(el('customers', 'customers')!, pointer(cu().x, cu().y, 0));
  await new Promise((r) => setTimeout(r, 50));
  expect(headers()).toEqual(before);
  expect(tips()).toEqual(tipsBefore);
});

test('a saved Graph preference is read back on load', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  createPreferences(ctx).saveMartsView('canvas');
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await ready();
  expect(await within(marts()).findByTestId('marts-canvas')).toBeInTheDocument();
  const group = within(marts()).getByRole('radiogroup', { name: 'Show data marts as' });
  expect(within(group).getByRole('radio', { name: 'Graph' })).toHaveAttribute('aria-checked', 'true');
});

test('scrolling the tree box re-lays out the page wires; scrolling elsewhere in the canvas does not', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  const spy = vi.spyOn(el('orders')!, 'getBoundingClientRect');
  const frame = () => new Promise((r) => setTimeout(r, 60));
  await frame();
  const base = spy.mock.calls.length;
  fireEvent.scroll(data().querySelector('.dm-band-grid, [data-band] div')!);
  await frame();
  expect(spy.mock.calls.length).toBe(base);
  fireEvent.scroll(within(marts()).getByTestId('marts-canvas'));
  await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(base));
});

test('a pin on a card whose path moved away does not hold the ghosts back', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.click(el('countries', 'customers.countries')!);
  const stores = () => centre('stores', 'stores');
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  fireEvent.pointerUp(el('stores', 'stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
  await userEvent.unhover(el('countries', 'stores.countries')!);
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
});

test('the line and the release both count the whole scroll box, and neither counts what is outside it', async () => {
  await joinCountriesUnderCustomers();
  const stores = () => centre('stores', 'stores');
  const c = () => centre('countries', 'customers.countries');
  const box = within(marts()).getByTestId('marts-canvas');
  const line = () => marts().querySelector('svg#drag-line path');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(box, pointer(stores().x, stores().y));
  await waitFor(() => expect(line()).not.toBeNull());
  fireEvent.pointerMove(document.body, pointer(stores().x, stores().y));
  // Outside the box the target lines stay, none is closest, and a release does nothing.
  await waitFor(() => expect(marts().querySelector('svg#drag-line path.closest')).toBeNull());
  expect(marts().querySelectorAll('svg#drag-line path')).toHaveLength(1);
  fireEvent.pointerMove(box, pointer(stores().x, stores().y));
  await waitFor(() => expect(line()).not.toBeNull());
  fireEvent.pointerUp(box, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
  expect(line()).toBeNull();
});

test('adding a mart with Enter on a ghost moves focus to its new card', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  const ghost = await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; });
  ghost.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(el('customers', 'customers')));
});

const countriesUnderBoth = async () => {
  await joinCountriesUnderCustomers();
  const stores = () => centre('stores', 'stores');
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  fireEvent.pointerUp(el('stores', 'stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  expect(el('countries', 'customers.countries')).toBeNull();
  await userEvent.hover(el('customers', 'customers')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="countries"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
};

test('a mart already under another parent is still offered as a ghost, and adding it gives two cards', async () => {
  await countriesUnderBoth();
  expect(marts().querySelectorAll('article[data-mart-id="countries"]:not([data-ghost])')).toHaveLength(2);
});

test('x on a middle card takes only its own columns: it stays as a bare card with its leaf, which keeps its columns; Undo restores them', async () => {
  await countriesUnderBoth();
  expect(el('orders')!.querySelector('.dm-card-remove')).toBeNull();
  await userEvent.click(within(el('stores', 'stores')!).getByRole('button', { name: /remove stores/i }));
  await waitFor(() => expect(groupTitles()).not.toContain('Stores'));
  expect(el('stores', 'stores')).not.toBeNull();
  expect(el('countries', 'stores.countries')).not.toBeNull();
  expect(el('countries', 'customers.countries')).not.toBeNull();
  // The × on the bare card takes the whole subtree, in one Undo step.
  await userEvent.click(within(el('stores', 'stores')!).getByRole('button', { name: /remove stores/i }));
  await waitFor(() => expect(el('stores', 'stores')).toBeNull());
  expect(el('countries', 'stores.countries')).toBeNull();
  expect(el('countries', 'customers.countries')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /undo/i }));
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  expect(el('stores', 'stores')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /undo/i }));
  await waitFor(() => expect(groupTitles()).toContain('Stores'));
});

test('the x moves focus to the parent card', async () => {
  await countriesUnderBoth();
  const remove = within(el('countries', 'customers.countries')!).getByRole('button', { name: /remove countries/i });
  remove.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(el('countries', 'customers.countries')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(el('customers', 'customers')));
});

test('with Customers joined, the source line reaches its path card', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('#wires path.source[data-to="dm-customers@customers"]')).not.toBeNull());
});

test('two copies of one mart read with their paths, and so do their remove buttons', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  fireEvent.click(gridCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(gridCard('Stores'));
  await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(gridCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(marts().querySelector('article[data-ghost][id="dm-countries@stores.countries"]')).not.toBeNull());
  fireEvent.click(marts().querySelector<HTMLElement>('article[data-ghost][id="dm-countries@stores.countries"]')!);
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  await toCanvas();
  await waitFor(() => expect(within(el('countries', 'customers.countries')!).getByText('Countries (customers.countries)')).toBeInTheDocument());
  expect(within(el('countries', 'stores.countries')!).getByRole('button', { name: 'Remove Countries (stores.countries) from the report' })).toBeInTheDocument();
});

const ghostEl = (id: string, path: string) => marts().querySelector<HTMLElement>(`article[data-ghost][id="${martElementId(id, path)}"]`);

test('a second click on the pinned card lets its ghosts go, though the pointer stays on it; leaving and coming back shows them again', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts()).toEqual([]));
  await userEvent.unhover(el('orders')!);
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
});

test('only the pinned card is tinted: nothing is before a click, the pinned card after, the other cards stay plain', async () => {
  setup();
  await ready();
  fireEvent.click(gridCard('Customers'));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await toCanvas();
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  expect(marts().querySelectorAll('article[data-focused]')).toHaveLength(0);
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(el('orders')).toHaveAttribute('data-focused'));
  expect(el('customers', 'customers')).not.toHaveAttribute('data-focused');
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(marts().querySelectorAll('article[data-focused]')).toHaveLength(0));
});

test('clicking another card moves the pin', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghostEl('products', 'products')).not.toBeNull());
  await userEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).toBeNull());
  await userEvent.unhover(el('customers', 'customers')!);
  await new Promise((r) => setTimeout(r, 500));
  expect(ghostEl('products', 'products')).toBeNull();
});

test('hover shows the ghosts at once, also when the pointer moves from one card to another', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.unhover(el('countries', 'customers.countries')!);
  await new Promise((r) => setTimeout(r, 500));
  await userEvent.hover(el('orders')!);
  expect(ghostEl('products', 'products')).not.toBeNull();
  await userEvent.hover(el('stores', 'stores')!);
  // No wait: the ghosts of the card just left are gone and the new card's are there.
  expect(ghostEl('products', 'products')).toBeNull();
});

test('hovering a ghost shows its own joinable marts to its right, wired from it; moving back trims the chain', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghostEl('customers', 'customers')).not.toBeNull());
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await userEvent.hover(ghostEl('customers', 'customers')!);
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  const left = (a: HTMLElement) => parseFloat(a.parentElement!.style.left);
  expect(left(ghostEl('countries', 'customers.countries')!)).toBeGreaterThan(left(ghostEl('customers', 'customers')!));
  await waitFor(() => expect(document.querySelector('#tree-wires path.ghost[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).not.toBeNull());
  // Back to a sibling ghost: the chain after the first link goes.
  await userEvent.hover(ghostEl('products', 'products')!);
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  expect(ghostEl('customers', 'customers')).not.toBeNull();
});

test('clicking a ghost at the end of a chain adds only that mart: the marts on the way stay as bare cards with no columns', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await userEvent.hover(await waitFor(() => { const g = ghostEl('customers', 'customers'); expect(g).not.toBeNull(); return g!; }));
  await userEvent.hover(await waitFor(() => { const g = ghostEl('countries', 'customers.countries'); expect(g).not.toBeNull(); return g!; }));
  await userEvent.click(ghostEl('countries', 'customers.countries')!);
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  expect(el('customers', 'customers')).not.toBeNull();
  expect(groupTitles()).toEqual(['Orders', 'Countries']);
  expect(el('customers', 'customers')!.querySelector('.dm-card-remove')).not.toBeNull();
  await waitFor(() => expect(document.querySelector('#tree-wires path[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).not.toBeNull());
});

test('parity with the Grid: only the x takes a mart out; clicks, Enter and Space on a card never do', async () => {
  await joinCountriesUnderCustomers();
  const before = headers();
  for (const card of [el('orders')!, el('customers', 'customers')!, el('countries', 'customers.countries')!]) {
    await userEvent.click(card);
    await userEvent.dblClick(card);
    card.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
  }
  await new Promise((r) => setTimeout(r, 100));
  expect(headers()).toEqual(before);
  expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores', 'Countries']);
  await userEvent.click(within(el('countries', 'customers.countries')!).getByRole('button', { name: /remove countries/i }));
  await waitFor(() => expect(el('countries', 'customers.countries')).toBeNull());
});

test('while a card is pinned, hovering another card keeps the pinned card ghosts, and a ghost of the pin still shows its next level', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghostEl('products', 'products')).not.toBeNull());
  await userEvent.hover(el('customers', 'customers')!);
  expect(ghostEl('products', 'products')).not.toBeNull();
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await userEvent.hover(ghostEl('products', 'products')!);
  expect(ghostEl('products', 'products')).not.toBeNull();
});

test('a pin does not come back when the main mart goes away and returns', async () => {
  const mk = (id: string): Mart => ({ id, title: id.toUpperCase(), description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
  const model = { marts: new Map([['a', mk('a')], ['b', mk('b')], ['c', mk('c')]]), sources: [], edges: [], contexts: [], failedStorages: [] } as unknown as Model;
  const joined = [{ aliasPath: 'b', martId: 'b', label: 'B', depth: 1, fields: [{ name: 'b__x', alias: 'x', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'b', label: 'B', aliasPath: 'b', originalName: 'x' } }], uniqueCount: true }] as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
  const view = (mainId: string) => (
    <TooltipProvider>
      <MartsCanvas model={model} mainId={mainId} columns={['id']} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} />
    </TooltipProvider>
  );
  const { rerender } = render(view('a'));
  await userEvent.click(document.querySelector('article:not([data-ghost])')!);
  await waitFor(() => expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(1));
  rerender(view('c'));
  rerender(view('a'));
  await userEvent.unhover(document.querySelector('article')!);
  await new Promise((r) => setTimeout(r, 500));
  expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(0);
});

const zoomBox = () => within(marts()).getByTestId('marts-canvas');
const treeScale = () => { const m = /scale\(([\d.]+)\)/.exec(treeEl().style.transform); return m ? parseFloat(m[1]!) : 1; };

test('ctrl+wheel and cmd+wheel zoom the graph within 0.5 to 2; a plain wheel does not', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  expect(treeScale()).toBe(1);
  expect(fireEvent.wheel(zoomBox(), { deltaY: -50 })).toBe(true);
  expect(treeScale()).toBe(1);
  // preventDefault is called on a zoom wheel event, so fireEvent reports it as cancelled.
  expect(fireEvent.wheel(zoomBox(), { deltaY: -50, ctrlKey: true })).toBe(false);
  expect(treeScale()).toBeGreaterThan(1);
  const sizer = treeEl().parentElement!;
  expect(parseFloat(sizer.style.width)).toBeCloseTo(parseFloat(treeEl().style.width) * treeScale(), 0);
  for (let i = 0; i < 40; i++) fireEvent.wheel(zoomBox(), { deltaY: -100, metaKey: true });
  expect(treeScale()).toBe(2);
  for (let i = 0; i < 80; i++) fireEvent.wheel(zoomBox(), { deltaY: 100, ctrlKey: true });
  expect(treeScale()).toBe(0.5);
});

test('at another scale the drag line and the drop pick use layout pixels', async () => {
  await joinCountriesUnderCustomers();
  fireEvent.wheel(zoomBox(), { deltaY: 100, ctrlKey: true });
  const k = treeScale();
  expect(k).toBeLessThan(1);
  // The tree's box is mocked at the origin, so a client point is the layout point times the scale.
  const stores = () => { const c = centre('stores', 'stores'); return { x: c.x * k, y: c.y * k }; };
  const c = () => { const p = centre('countries', 'customers.countries'); return { x: p.x * k, y: p.y * k }; };
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  // The closest line ends on the stores card's edge in layout pixels, whatever the scale.
  await waitFor(() => expect(marts().querySelector('svg#drag-line path.closest')).not.toBeNull());
  const d = marts().querySelector('svg#drag-line path.closest')!.getAttribute('d')!;
  const end = d.match(/ ([\d.]+) ([\d.]+)$/)!;
  expect(Math.abs(parseFloat(end[1]!) - centre('stores', 'stores').x)).toBe(112);
  expect(parseFloat(end[2]!)).toBeCloseTo(centre('stores', 'stores').y, 0);
  fireEvent.pointerUp(el('stores', 'stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
});

test('a click on a ghost adds it and pins it, its own ghosts show; a second click lets them go', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await userEvent.click(await waitFor(() => { const g = ghostEl('customers', 'customers'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  await userEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).toBeNull());
});

test('Data Sources cards are lit and dimmed by the same rule in Grid and in Graph', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  fireEvent.click(gridCard('Customers'));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  const sources = () => document.getElementById('band-sources')!;
  const lit = () => [...sources().querySelectorAll('.dm-node')].map((n) => `${n.id}:${n.classList.contains('lit')}`);
  const root = () => marts().closest('.dm-canvas')!;
  await waitFor(() => expect(lit().some((s) => s.endsWith(':true'))).toBe(true));
  expect(root()).toHaveClass('sources-focused');
  const inGrid = lit();
  expect(inGrid.some((s) => s.endsWith(':true'))).toBe(true);
  await toCanvas();
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  // Both views dim the Sources band the same way, and the lit cards are the same.
  expect(root()).toHaveClass('sources-focused');
  expect(document.querySelectorAll('.dm-faded')).toHaveLength(0);
  expect(lit()).toEqual(inGrid);
});

test('while a Graph card is held, every other target gets a dashed line, every target stays lit, and the drop joins under the closest', async () => {
  await joinCountriesUnderCustomers();
  const stores = () => centre('stores', 'stores');
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  await waitFor(() => expect(marts().querySelectorAll('svg#drag-line path')).toHaveLength(1));
  const lit = [...marts().querySelectorAll('.dm-tree-node:has(article:not(.dm-faded))')].map((n) => n.getAttribute('data-tree-path'));
  expect(lit.sort()).toEqual(['customers', 'customers.countries', 'stores']);
  // Moving next to the current parent: its tree wire is the stronger line, and no dashed line is.
  const cu = centre('customers', 'customers');
  fireEvent.pointerMove(treeEl(), pointer(cu.x, cu.y));
  await waitFor(() => expect(marts().querySelector('svg#drag-line path.closest')).toBeNull());
  await waitFor(() => expect(marts().querySelector('#tree-wires path.closest')?.getAttribute('data-to')).toBe('dm-countries@customers.countries'));
  fireEvent.pointerMove(treeEl(), pointer(stores().x, stores().y));
  await waitFor(() => expect(marts().querySelector('svg#drag-line path.closest')?.getAttribute('data-target')).toBe('stores'));
  expect(marts().querySelector('#tree-wires path.closest')).toBeNull();
  fireEvent.pointerUp(el('stores', 'stores')!, pointer(stores().x, stores().y, 0));
  await waitFor(() => expect(tips()).toContain('Stores → Countries'));
});

test('a zoom step applies the new sizer height with no transition, and the transition returns after a frame', async () => {
  await joinCountriesUnderCustomers();
  const sizer = marts().querySelector<HTMLElement>('.dm-tree-sizer')!;
  const before = sizer.style.height;
  fireEvent.wheel(zoomBox(), { deltaY: 100, ctrlKey: true });
  expect(sizer.style.height).not.toBe(before);
  expect(sizer.style.transition).toBe('none');
  await waitFor(() => expect(sizer.style.transition).toBe(''));
});

test('hover first, then grab: the parent tree wire is still the stronger line when the parent is the closest target', async () => {
  await joinCountriesUnderCustomers();
  // Hovering a card shows ghosts; grabbing drops them, which rebuilds the wires.
  await userEvent.hover(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  const cu = centre('customers', 'customers');
  fireEvent.pointerMove(treeEl(), pointer(cu.x, cu.y));
  await waitFor(() => expect(ghosts()).toEqual([]));
  await waitFor(() => expect(marts().querySelector('#tree-wires path.closest')?.getAttribute('data-to')).toBe('dm-countries@customers.countries'));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(marts().querySelector('#tree-wires path.closest')).toBeNull());
  fireEvent.pointerUp(window, pointer(cu.x, cu.y, 0));
});

test('Escape in a drag only cancels the drag: the pinned card stays pinned', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.unhover(el('orders')!);
  const c = () => centre('countries', 'customers.countries');
  fireEvent.pointerDown(el('countries', 'customers.countries')!, pointer(c().x, c().y));
  fireEvent.pointerMove(treeEl(), pointer(c().x + 40, c().y));
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(marts().querySelector('svg#drag-line path')).toBeNull());
  fireEvent.pointerUp(window, pointer(c().x + 40, c().y, 0));
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
});
