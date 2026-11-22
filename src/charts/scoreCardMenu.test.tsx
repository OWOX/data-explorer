import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../state/store';
import type { ChartMart } from './fields';
import { MartCards } from './Scorecards';
import type { Spark } from './settings';

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const amount = f('amount', 'number', 'NUMERIC');
const net = f('net_revenue', 'number', 'NUMERIC');
const created = f('created_at', 'date', 'TIMESTAMP');
const updated = f('updated_at', 'date', 'TIMESTAMP');
const mart = (metrics: Field[], dates: Field[]): ChartMart => ({ aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: false, metrics: metrics.map((field) => ({ field, fn: 'SUM' as const })), dates, dimensions: [] });
const spark = (date: Field): Spark => ({ hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date });

function show(shownMart: ChartMart, menuMart: ChartMart, handlers: { onMetric?: (id: string, m: string) => void; onDate?: (id: string, d: string) => void } = {}) {
  render(
    <AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider>
      <MartCards martId="orders" mart={shownMart} menuMart={menuMart} main spark={spark(created)} scores={{ rows: [{ amount: 1 }], error: null, loading: false, retry: () => {} }} bucket="MONTH" autoBucket={false}
        filter={[]} version={0} paused hasFilters={false} formatOf={() => ({} as never)} onHide={() => {}} {...handlers} />
    </StoreProvider></AppServices>,
  );
}
const open = () => userEvent.click(screen.getByRole('button', { name: /options$/ }));

test('the Metric list offers a column that is not shown', async () => {
  const onMetric = vi.fn();
  show(mart([amount], [created]), mart([amount, net], [created]), { onMetric });
  await open();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Net Revenue|net_revenue/ }));
  expect(onMetric).toHaveBeenCalledWith('amount', 'net_revenue');
});

test('the Date field row shows with two dates only', async () => {
  show(mart([amount], [created]), mart([amount], [created]));
  await open();
  expect(screen.queryByRole('menuitem', { name: 'Date field' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Hide' })).toBeInTheDocument();
});

test('a Date field pick is passed on', async () => {
  const onDate = vi.fn();
  show(mart([amount], [created]), mart([amount], [created, updated]), { onDate });
  await open();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Date field' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /updated_at/ }));
  await waitFor(() => expect(onDate).toHaveBeenCalledWith('amount', 'updated_at'));
});
