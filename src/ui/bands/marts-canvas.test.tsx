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
  await userEvent.keyboard('{Escape}');
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
