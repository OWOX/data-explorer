import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.querySelector('.truncate')!.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
const gridCard = (title: string) => within(marts()).getByText(title).closest('article')!;
const el = (id: string, path?: string) => [...marts().querySelectorAll<HTMLElement>('article')].find((a) => a.id === martElementId(id, path) && !a.hasAttribute('data-ghost')) ?? null;
const plusOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-join-plus]')!;
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

test('hovering the (+) of a card shows its ghosts; clicking a ghost adds that mart through that path', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(plusOf(el('orders')!));
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
  await userEvent.hover(plusOf(el('orders')!));
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
/** The solid lines as "From → To" by mart id, capitalised as the fixtures title them: a tip names only the join, not the two marts. */
const martOfEl = (id = '') => { const m = id.replace(/^dm-/, '').split('@')[0]!; return m[0]!.toUpperCase() + m.slice(1); };
const tips = () => [...marts().querySelectorAll<SVGPathElement>('#tree-wires path[data-tip]:not(.ghost)')].map((p) => `${martOfEl(p.dataset.from)} → ${martOfEl(p.dataset.to)}`);
const treeEl = () => marts().querySelector<HTMLElement>('.dm-tree')!;
const joinCountriesUnderCustomers = async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  vi.spyOn(marts().querySelector('.dm-tree')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  await userEvent.hover(plusOf(el('orders')!));
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  // The added card is pinned: let the pin go so the next ghost is looked up under the card hovered.
  await userEvent.keyboard('{Escape}');
  await userEvent.hover(plusOf(el('orders')!));
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="stores"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores']));
  await userEvent.keyboard('{Escape}');
  await userEvent.hover(plusOf(el('customers', 'customers')!));
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
  await userEvent.hover(plusOf(el('orders')!));
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
  await userEvent.hover(plusOf(el('orders')!));
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
  await userEvent.hover(plusOf(el('customers', 'customers')!));
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
  await userEvent.hover(plusOf(el('orders')!));
  await userEvent.click(await waitFor(() => { const g = marts().querySelector<HTMLElement>('article[data-ghost][data-mart-id="customers"]'); expect(g).not.toBeNull(); return g!; }));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('#wires path.source[data-to="dm-customers@customers"]')).not.toBeNull());
});

test('two copies of one mart read with their parent marts, and so do their remove buttons', async () => {
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
  await waitFor(() => expect(within(el('countries', 'customers.countries')!).getByText('Countries (Customers)')).toBeInTheDocument());
  expect(within(el('countries', 'stores.countries')!).getByRole('button', { name: 'Remove Countries (Stores) from the report' })).toBeInTheDocument();
});

const ghostEl = (id: string, path: string) => marts().querySelector<HTMLElement>(`article[data-ghost][id="${martElementId(id, path)}"]`);

test('a second click on the pinned card lets its ghosts go, though the pointer stays on it; the (+) shows them again once the pointer has left it', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.click(el('orders')!);
  await waitFor(() => expect(ghosts()).toEqual([]));
  await userEvent.unhover(el('orders')!);
  await userEvent.hover(plusOf(el('orders')!));
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
  await userEvent.hover(plusOf(el('orders')!));
  expect(ghostEl('products', 'products')).not.toBeNull();
  await userEvent.hover(plusOf(el('stores', 'stores')!));
  // No wait: the ghosts of the card just left are gone and the new card's are there.
  expect(ghostEl('products', 'products')).toBeNull();
});

test('hovering the (+) of a ghost shows its own joinable marts to its right, wired from it; moving back trims the chain', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(plusOf(el('orders')!));
  await waitFor(() => expect(ghostEl('customers', 'customers')).not.toBeNull());
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await userEvent.hover(plusOf(ghostEl('customers', 'customers')!));
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  const left = (a: HTMLElement) => parseFloat(a.parentElement!.style.left);
  expect(left(ghostEl('countries', 'customers.countries')!)).toBeGreaterThan(left(ghostEl('customers', 'customers')!));
  await waitFor(() => expect(document.querySelector('#tree-wires path.ghost[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).not.toBeNull());
  // The (+) of a sibling ghost: the chain after the first link goes and the sibling's level shows.
  await userEvent.hover(plusOf(ghostEl('stores', 'stores')!));
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await waitFor(() => expect(ghostEl('countries', 'stores.countries')).not.toBeNull());
  // The card's own (+): its ghosts alone.
  await userEvent.hover(plusOf(el('orders')!));
  expect(ghostEl('countries', 'stores.countries')).toBeNull();
  expect(ghostEl('customers', 'customers')).not.toBeNull();
});

test('clicking a ghost at the end of a chain adds only that mart: the marts on the way stay as bare cards with no columns', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(plusOf(el('orders')!));
  await userEvent.hover(plusOf(await waitFor(() => { const g = ghostEl('customers', 'customers'); expect(g).not.toBeNull(); return g!; })));
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
  await userEvent.hover(plusOf(el('orders')!));
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
  // Hovering a (+) shows ghosts; grabbing drops them, which rebuilds the wires.
  await userEvent.hover(plusOf(el('orders')!));
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

test('Graph: three relationships from one mart to another each name their own line by Output Alias, and a dot sits on the described one', () => {
  const mk = (id: string, title: string): Mart => ({ id, title, description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
  const edge = (id: string, alias: string, description?: string) => ({ id, source: 'contact', target: 'session', joins: [], alias, ...(description ? { description } : {}) });
  const model = { marts: new Map([['contact', mk('contact', 'Contact')], ['session', mk('session', 'Session | Entity')]]), sources: [], contexts: [], failedStorages: [],
    edges: [edge('r1', 'first_session', 'How the contact first arrived'), edge('r2', 'last_session_before_mql'), edge('r3', 'session_entity')] } as unknown as Model;
  const path = (alias: string, rel: string) => ({ aliasPath: alias, martId: 'session', label: 'Session | Entity', depth: 1, relationshipId: rel, uniqueCount: true,
    fields: [{ name: `${alias}__x`, alias: 'x', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'session', label: 'Session | Entity', aliasPath: alias, originalName: 'x' } }] });
  const joined = [path('first_session', 'r1'), path('last_session_before_mql', 'r2'), path('session_entity', 'r3')] as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
  render(
    <TooltipProvider>
      <MartsCanvas model={model} mainId="contact" columns={['id', 'first_session__x', 'last_session_before_mql__x', 'session_entity__x']} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} />
    </TooltipProvider>,
  );
  const tip = (path: string) => document.querySelector<SVGPathElement>(`#tree-wires path[data-to="${martElementId('session', path)}"]`)!.dataset.tip!;
  const more = (path: string) => document.querySelector<SVGPathElement>(`#tree-wires path[data-to="${martElementId('session', path)}"]`)!.dataset.more;
  // No Output Alias is set, so each line says the Output Alias a join has by default (the mart's title), never the technical alias.
  expect(tip('first_session')).toBe('Session | Entity');
  expect(tip('last_session_before_mql')).toBe('Session | Entity');
  expect(more('first_session')).toBe('How the contact first arrived');
  expect(more('last_session_before_mql')).toBeUndefined();
  // Only the described line has something more to say, so only it has a dot.
  expect(document.querySelectorAll('#tree-wires circle.dm-wire-dot')).toHaveLength(1);
});

test('Graph: a line says the join\'s Output Alias, not the relationship\'s technical alias', () => {
  const mk = (id: string, title: string): Mart => ({ id, title, description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
  const edge = (id: string, alias: string) => ({ id, source: 'visitor', target: 'session', joins: [], alias });
  const model = { marts: new Map([['visitor', mk('visitor', 'Visitor')], ['session', mk('session', 'Session | Entity')]]), sources: [], contexts: [], failedStorages: [],
    edges: [edge('r1', 'first_session'), edge('r2', 'session_entity_new_sql')] } as unknown as Model;
  const path = (alias: string, rel: string, outputAlias: string) => ({ aliasPath: alias, martId: 'session', label: outputAlias, depth: 1, relationshipId: rel, outputAlias, uniqueCount: true,
    fields: [{ name: `${alias}__x`, alias: 'x', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'session', label: outputAlias, aliasPath: alias, originalName: 'x' } }] });
  const joined = [path('first_session', 'r1', 'First Session'), path('session_entity_new_sql', 'r2', 'Last Session')] as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
  render(
    <TooltipProvider>
      <MartsCanvas model={model} mainId="visitor" columns={['id', 'first_session__x', 'session_entity_new_sql__x']} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} />
    </TooltipProvider>,
  );
  const tip = (path: string) => document.querySelector<SVGPathElement>(`#tree-wires path[data-to="${martElementId('session', path)}"]`)!.dataset.tip!;
  expect(tip('first_session')).toBe('First Session');
  expect(tip('session_entity_new_sql')).toBe('Last Session');
});

test('Graph: a join under a joined mart is named by that mart\'s own Output Alias when the main mart names it nothing', () => {
  const mk = (id: string, title: string): Mart => ({ id, title, description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
  const model = { marts: new Map([['contact', mk('contact', 'Contact')], ['visitor', mk('visitor', 'Visitor')], ['session', mk('session', 'Session | Entity')]]), sources: [], contexts: [], failedStorages: [],
    edges: [{ id: 'r0', source: 'contact', target: 'visitor', joins: [], alias: 'visitor' }, { id: 'r2', source: 'visitor', target: 'session', joins: [], alias: 'session_entity_new_sql' }] } as unknown as Model;
  const src = (aliasPath: string, martId: string, label: string, rel: string, depth: number) => ({ aliasPath, martId, label, depth, relationshipId: rel, outputAlias: label, uniqueCount: true,
    fields: [{ name: `${aliasPath.replace('.', '__')}__x`, alias: 'x', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId, label, aliasPath, originalName: 'x' } }] });
  const joined = [src('visitor', 'visitor', 'Visitor', 'r0', 1), src('visitor.session_entity_new_sql', 'session', 'Session | Entity', 'r2', 2)] as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
  const own = (martId: string, path: string) => (martId === 'visitor' && path === 'session_entity_new_sql' ? 'Last Session' : undefined);
  render(
    <TooltipProvider>
      <MartsCanvas model={model} mainId="contact" columns={['id', 'visitor__x', 'visitor__session_entity_new_sql__x']} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} own={own} />
    </TooltipProvider>,
  );
  const tip = document.querySelector<SVGPathElement>(`#tree-wires path[data-to="${martElementId('session', 'visitor.session_entity_new_sql')}"]`)!.dataset.tip!;
  expect(tip).toBe('Last Session');
});

const mk = (id: string, accessible = true): Mart => ({ id, title: id.toUpperCase(), description: '', icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible, sourceKey: null });
const src = (id: string, aliasPath = id) => ({ aliasPath, martId: id, label: id.toUpperCase(), depth: aliasPath.split('.').length, uniqueCount: true, fields: [{ name: `${aliasPath}__x`, alias: 'x', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: id, label: id.toUpperCase(), aliasPath, originalName: 'x' } }] });
/** The first mart is the main one; every other joins directly under it, but for the paths given. */
const small = (marts: Mart[], click = vi.fn().mockResolvedValue(undefined), paths: Record<string, string> = {}, columns = ['id']) => {
  const model = { marts: new Map(marts.map((m) => [m.id, m])), sources: [], edges: [], contexts: [], failedStorages: [] } as unknown as Model;
  const joined = marts.slice(1).map((m) => src(m.id, paths[m.id] ?? m.id)) as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
  render(
    <TooltipProvider>
      <MartsCanvas model={model} mainId={marts[0]!.id} columns={columns} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={click} />
    </TooltipProvider>,
  );
  return click;
};
const later = (ms = 600) => new Promise((r) => setTimeout(r, ms));

test('a card has a (+) only when an accessible data mart can join under it', () => {
  small([mk('a'), mk('b')]);
  expect(document.querySelectorAll('[data-join-plus]')).toHaveLength(1);
  expect(plusOf(document.querySelector('article')!)).toHaveAttribute('aria-label', 'Show data marts A can join');
  expect(plusOf(document.querySelector('article')!)).toHaveAttribute('aria-expanded', 'false');
});

test('no (+) when what can join is not accessible', () => {
  small([mk('a'), mk('b', false)]);
  expect(document.querySelectorAll('[data-join-plus]')).toHaveLength(0);
});

test('hovering a card shows no ghost; its (+) does, and a ghost with nothing under it has no (+)', async () => {
  small([mk('a'), mk('b')]);
  const card = document.querySelector<HTMLElement>('article')!;
  await userEvent.hover(card);
  await later(100);
  expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(0);
  await userEvent.hover(plusOf(card));
  await waitFor(() => expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(1));
  expect(document.querySelector('article[data-ghost] [data-join-plus]')).toBeNull();
});

test('from the (+) to a ghost keeps the ghosts; to another card they go after the grace, and on the card itself they stay', async () => {
  await joinCountriesUnderCustomers();
  await userEvent.unhover(el('countries', 'customers.countries')!);
  await later();
  await userEvent.hover(plusOf(el('orders')!));
  await waitFor(() => expect(ghostEl('products', 'products')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await later();
  expect(ghostEl('products', 'products')).not.toBeNull();
  await userEvent.hover(ghostEl('products', 'products')!);
  await later();
  expect(ghostEl('products', 'products')).not.toBeNull();
  await userEvent.hover(el('stores', 'stores')!);
  await later();
  expect(ghostEl('products', 'products')).toBeNull();
  await userEvent.hover(plusOf(el('orders')!));
  await waitFor(() => expect(ghostEl('products', 'products')).not.toBeNull());
  await userEvent.unhover(el('orders')!);
  await waitFor(() => expect(ghostEl('products', 'products')).toBeNull());
});

test('clicking the (+) keeps the ghosts after the pointer leaves; a second click, Escape and the empty canvas let them go', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  const plus = () => plusOf(el('orders')!);
  await userEvent.click(plus());
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  expect(plus()).toHaveAttribute('aria-expanded', 'true');
  await userEvent.unhover(plus());
  await later();
  expect(ghosts().length).toBeGreaterThan(0);
  await userEvent.click(plus());
  await waitFor(() => expect(ghosts()).toEqual([]));
  expect(plus()).toHaveAttribute('aria-expanded', 'false');
  // The same hover does not bring them back; leaving and coming back does.
  fireEvent.pointerOver(plus());
  await later(100);
  expect(ghosts()).toEqual([]);
  await userEvent.unhover(plus());
  await userEvent.hover(plus());
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.click(plus());
  await waitFor(() => expect(plus()).toHaveAttribute('aria-expanded', 'true'));
  await userEvent.keyboard('{Escape}');
  await userEvent.unhover(plus());
  await waitFor(() => expect(ghosts()).toEqual([]));
  await userEvent.click(plus());
  await userEvent.unhover(plus());
  await later();
  expect(ghosts().length).toBeGreaterThan(0);
  await userEvent.click(within(marts()).getByTestId('marts-canvas'));
  await waitFor(() => expect(ghosts()).toEqual([]));
});

test('the (+) of a ghost adds the next level on hover, the ghost itself does not, and a click keeps the whole chain', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(plusOf(el('orders')!));
  await waitFor(() => expect(ghostEl('customers', 'customers')).not.toBeNull());
  await userEvent.hover(ghostEl('customers', 'customers')!);
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await userEvent.hover(plusOf(ghostEl('customers', 'customers')!));
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  await userEvent.click(plusOf(ghostEl('customers', 'customers')!));
  expect(plusOf(ghostEl('customers', 'customers')!)).toHaveAttribute('aria-expanded', 'true');
  await userEvent.unhover(ghostEl('customers', 'customers')!);
  await later();
  expect(ghostEl('countries', 'customers.countries')).not.toBeNull();
  expect(ghostEl('customers', 'customers')).not.toBeNull();
  // A second click on it takes its level away again.
  await userEvent.click(plusOf(ghostEl('customers', 'customers')!));
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).toBeNull());
  expect(ghostEl('customers', 'customers')).not.toBeNull();
});

test('keyboard: focusing the (+) shows the ghosts and Enter keeps them', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  plusOf(el('orders')!).focus();
  await waitFor(() => expect(ghosts().length).toBeGreaterThan(0));
  await userEvent.keyboard('{Enter}');
  expect(plusOf(el('orders')!)).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerLeave(treeEl());
  await later();
  expect(ghosts().length).toBeGreaterThan(0);
});

test('pressing the (+) and moving does not start a drag, and a click on it does not run the card select', async () => {
  // B is joined (it has columns) and so can be dragged; C can join under it.
  small([mk('a'), mk('b'), mk('c')], undefined, { c: 'b.c' }, ['id', 'b__x']);
  const card = document.querySelector<HTMLElement>('article[data-mart-id="b"]')!;
  const plus = plusOf(card);
  fireEvent.pointerDown(plus, pointer(100, 100));
  fireEvent.pointerMove(card.closest('.dm-tree')!, pointer(120, 100));
  await later(50);
  expect(document.querySelector('.dm-drag-ghost')).toBeNull();
  fireEvent.pointerUp(plus, pointer(120, 100, 0));
  // Were the card select to run as well, the second toggle would let the pin go again.
  await userEvent.click(plus);
  await waitFor(() => expect(document.querySelectorAll('article[data-ghost]')).toHaveLength(1));
  expect(plus).toHaveAttribute('aria-expanded', 'true');
  // The same press on the card itself does start a drag.
  fireEvent.pointerDown(card, pointer(100, 100));
  fireEvent.pointerMove(card.closest('.dm-tree')!, pointer(120, 100));
  await waitFor(() => expect(document.querySelector('.dm-drag-ghost')).not.toBeNull());
  fireEvent.pointerUp(card, pointer(120, 100, 0));
});

test('on a ghost, a click on the (+) does not add the mart', async () => {
  const click = small([mk('a'), mk('b'), mk('c')], undefined, { c: 'b.c' });
  await userEvent.click(plusOf(document.querySelector<HTMLElement>('article')!));
  const ghost = await waitFor(() => { const g = document.querySelector<HTMLElement>('article[data-ghost][data-mart-id="b"]'); expect(g).not.toBeNull(); return g!; });
  await userEvent.click(plusOf(ghost));
  expect(click).not.toHaveBeenCalled();
  await waitFor(() => expect(document.querySelector('article[data-ghost][data-mart-id="c"]')).not.toBeNull());
});

test('the Grid cards have no (+)', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  expect(marts().querySelectorAll('[data-join-plus]')).toHaveLength(0);
});

/** A main mart A with B under it, and C already in the report: the cards are A and C, and B is the ghost of A's (+). */
const twoCards = () => small([mk('a'), mk('b'), mk('c')], undefined, {}, ['id', 'c__x']);
/** B and C are both in the report under A, and D can join under B: B's (+) shows D, and C is not near B so it dims. */
const dimmed = () => small([mk('a'), mk('b'), mk('c'), mk('d')], undefined, { d: 'b.d' }, ['id', 'b__x', 'c__x']);
const card = (id: string) => document.querySelector<HTMLElement>(`article[data-mart-id="${id}"]:not([data-ghost])`)!;
const ghostCount = () => document.querySelectorAll('article[data-ghost]').length;
const fadedCount = () => document.querySelectorAll('article.dm-faded').length;
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('on fake timers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.querySelectorAll('[data-outside]').forEach((n) => n.remove()); });

  test('the ghosts go GHOST_GRACE_MS after the pointer left them, however much it moves over another card', () => {
    twoCards();
    fireEvent.pointerOver(plusOf(card('a')));
    expect(ghostCount()).toBe(1);
    fireEvent.pointerOver(card('c'));
    tick(250);
    fireEvent.pointerOver(card('c').querySelector('.dm-node-title')!);
    tick(100);
    fireEvent.pointerOver(card('c'));
    tick(40);
    // 390 ms after the first crossing: still there, 20 ms later gone.
    expect(ghostCount()).toBe(1);
    tick(20);
    expect(ghostCount()).toBe(0);
  });

  test('focusing a (+) shows and dims, and tabbing out of the graph undoes both; tabbing to a ghost keeps them', () => {
    dimmed();
    const outside = document.createElement('button');
    outside.setAttribute('data-outside', '');
    document.body.append(outside);
    act(() => plusOf(card('b')).focus());
    expect(ghostCount()).toBe(1);
    expect(fadedCount()).toBeGreaterThan(0);
    act(() => document.querySelector<HTMLElement>('article[data-ghost]')!.focus());
    tick(600);
    expect(ghostCount()).toBe(1);
    act(() => plusOf(card('b')).focus());
    act(() => outside.focus());
    tick(600);
    expect(ghostCount()).toBe(0);
    expect(fadedCount()).toBe(0);
  });

  test('a click on the empty canvas clears the ghosts that focus showed', () => {
    twoCards();
    act(() => plusOf(card('a')).focus());
    expect(ghostCount()).toBe(1);
    fireEvent.click(document.querySelector('.dm-tree-sizer')!);
    expect(ghostCount()).toBe(0);
  });

  test('a (+) closed with Enter shows its ghosts again once focus has left and returned', () => {
    twoCards();
    const plus = plusOf(card('a'));
    act(() => plus.focus());
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(ghostCount()).toBe(0);
    act(() => plus.blur());
    tick(600);
    act(() => plus.focus());
    expect(ghostCount()).toBe(1);
  });

  test('returning to the window does not bring the ghosts or the dimming back while the pointer is elsewhere', () => {
    dimmed();
    const plus = plusOf(card('b'));
    act(() => plus.focus());
    expect(ghostCount()).toBe(1);
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    act(() => plus.blur());
    tick(600);
    expect(ghostCount()).toBe(0);
    // The window comes back: the browser focuses the element it left on.
    act(() => plus.focus());
    hasFocus.mockReturnValue(true);
    expect(ghostCount()).toBe(0);
    expect(fadedCount()).toBe(0);
    // A deliberate focus afterwards works again.
    act(() => plus.blur());
    act(() => plus.focus());
    expect(ghostCount()).toBe(1);
  });

  test('a press on a (+) released on the card body does not select the card or add the ghost', () => {
    const click = small([mk('a'), mk('b'), mk('c')], undefined, { c: 'b.c' });
    fireEvent.click(plusOf(card('a')));
    const ghost = document.querySelector<HTMLElement>('article[data-ghost][data-mart-id="b"]')!;
    fireEvent.pointerDown(plusOf(ghost), pointer(10, 10));
    fireEvent.click(ghost);
    expect(click).not.toHaveBeenCalled();
    // The next plain click does add it.
    fireEvent.click(ghost);
    expect(click).toHaveBeenCalledTimes(1);
  });

  test('on a touch screen, the second tap on a (+) leaves nothing dimmed', () => {
    dimmed();
    const plus = plusOf(card('b'));
    fireEvent.pointerOver(plus);
    fireEvent.click(plus);
    fireEvent.pointerLeave(document.querySelector('.dm-tree')!);
    fireEvent.click(plus);
    tick(600);
    expect(ghostCount()).toBe(0);
    expect(fadedCount()).toBe(0);
  });
  test('hovering a card keeps its dimming when the pointer came from another card across the gap, with or without a pin', () => {
    for (const pinFirst of [false, true]) {
      cleanup();
      dimmed();
      if (pinFirst) fireEvent.click(card('a'));
      fireEvent.pointerOver(card('b'));
      fireEvent.pointerOver(document.querySelector('.dm-tree')!);
      tick(100);
      fireEvent.pointerOver(card('c'));
      tick(600);
      expect(card('b')).toHaveClass('dm-faded');
    }
  });

  test('the dimming is held a full grace after the pointer leaves the cards, whatever the ghosts were doing', () => {
    dimmed();
    fireEvent.pointerOver(plusOf(card('b')));
    fireEvent.pointerOver(card('c'));
    tick(390);
    expect(ghostCount()).toBe(1);
    fireEvent.pointerOver(document.querySelector('.dm-tree')!);
    tick(15);
    expect(ghostCount()).toBe(0);
    tick(380);
    expect(fadedCount()).toBeGreaterThan(0);
    tick(10);
    expect(fadedCount()).toBe(0);
  });

  test('a blur lets go of what focus showed, not of what the pointer holds', () => {
    dimmed();
    act(() => plusOf(card('b')).focus());
    expect(ghostCount()).toBe(1);
    // The pointer is on C, and a click there moves focus to it.
    fireEvent.pointerOver(card('c'));
    act(() => card('c').focus());
    fireEvent.click(card('c'));
    tick(600);
    expect(ghostCount()).toBe(0);
    expect(card('b')).toHaveClass('dm-faded');
  });

  test('switching windows with the pointer on the anchor card keeps its ghosts', () => {
    dimmed();
    const plus = plusOf(card('b'));
    fireEvent.pointerOver(card('b'));
    act(() => plus.focus());
    expect(ghostCount()).toBe(1);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    act(() => plus.blur());
    tick(600);
    expect(ghostCount()).toBe(1);
    expect(card('c')).toHaveClass('dm-faded');
  });

  test('a ghost the pointer is on keeps its ghosts when the window is switched', () => {
    dimmed();
    const plus = plusOf(card('b'));
    fireEvent.pointerOver(plus);
    act(() => plus.focus());
    const ghost = document.querySelector<HTMLElement>('article[data-ghost]')!;
    fireEvent.pointerOver(ghost);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    act(() => plus.blur());
    tick(600);
    expect(ghostCount()).toBe(1);
  });

  test('letting go of a pin with the pointer gone leaves nothing dimmed', () => {
    dimmed();
    fireEvent.pointerOver(card('b'));
    fireEvent.click(card('b'));
    fireEvent.pointerOver(document.querySelector('.dm-tree')!);
    expect(fadedCount()).toBeGreaterThan(0);
    fireEvent.click(card('b'));
    expect(fadedCount()).toBe(0);
  });

  test('an anchor that left the tree does not hide the pin\'s ghosts', () => {
    const model = { marts: new Map(['a', 'b', 'c', 'd'].map((id) => [id, mk(id)])), sources: [], edges: [], contexts: [], failedStorages: [] } as unknown as Model;
    const joined = [src('b'), src('c'), src('d', 'b.d')] as unknown as Parameters<typeof MartsCanvas>[0]['sources'];
    const view = (columns: string[]) => (
      <TooltipProvider>
        <MartsCanvas model={model} mainId="a" columns={columns} sources={joined} counts={new Map()} dq={new Map()} onOpenApp={vi.fn()} onRetryCount={vi.fn()} onRequestCount={vi.fn()} click={vi.fn().mockResolvedValue(undefined)} />
      </TooltipProvider>
    );
    const { rerender } = render(view(['id', 'b__x']));
    fireEvent.click(card('a'));
    act(() => plusOf(card('b')).focus());
    expect(ghostCount()).toBe(1);
    // B is taken out of the report while focus holds its ghosts.
    rerender(view(['id']));
    expect(ghostCount()).toBe(2);
  });
});

test('while a card is pinned, another card\'s (+) shows its ghosts and the pin\'s come back after it; its body changes nothing; a click moves the pin', async () => {
  setup();
  await ready();
  await toCanvas();
  await waitFor(() => expect(el('orders')).not.toBeNull());
  await userEvent.hover(plusOf(el('orders')!));
  await userEvent.click(await waitFor(() => { const g = ghostEl('customers', 'customers'); expect(g).not.toBeNull(); return g!; }));
  // The added card is pinned and shows its own ghosts.
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  await userEvent.hover(el('orders')!);
  await later();
  expect(ghostEl('countries', 'customers.countries')).not.toBeNull();
  await userEvent.hover(plusOf(el('orders')!));
  await waitFor(() => expect(ghostEl('products', 'products')).not.toBeNull());
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
  await userEvent.unhover(el('orders')!);
  await waitFor(() => expect(ghostEl('countries', 'customers.countries')).not.toBeNull());
  expect(ghostEl('products', 'products')).toBeNull();
  await userEvent.click(plusOf(el('orders')!));
  await waitFor(() => expect(el('orders')).toHaveAttribute('data-focused'));
  await userEvent.unhover(el('orders')!);
  await later();
  expect(ghostEl('products', 'products')).not.toBeNull();
  expect(ghostEl('countries', 'customers.countries')).toBeNull();
});
