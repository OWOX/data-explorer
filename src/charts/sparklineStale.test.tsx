import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseFilter, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { TooltipProvider } from '../ui/Tooltip';
import type { ChartMart } from './fields';
import { metricKey } from './queries';
import { MartCards } from './Scorecards';
import type { Spark } from './settings';

vi.mock('./useBucket', () => ({ useBucket: () => ({ bucket: 'MONTH', error: null, retry: () => {} }) }));

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const amount = f('amount', 'number', 'NUMERIC');
const created = f('created_at', 'date', 'TIMESTAMP');
const updated = f('updated_at', 'date', 'TIMESTAMP');
const orders: ChartMart = { aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: false, metrics: [{ field: amount, fn: 'SUM' }], dates: [created, updated], dimensions: [] };
const SUM = metricKey({ field: amount, fn: 'SUM' });
const spark = (date: Field): Spark => ({ hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date });

type Read = { options: TraverseOptions; answer: (rows: Row[]) => void };
/** A ctx whose reads stay open until the test answers them. */
function held() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: Read[] = [];
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (_id, options) => new Promise((resolve) => {
    reads.push({ options, answer: (rows) => resolve({ rowChunks: async function* () { yield rows; }, cancel: async () => {} }) });
  }) as never } } };
  return { ctx, reads };
}
const ui = (ctx: Ctx, date: Field, filter: TraverseFilter[]) => (
  <AppServices ctx={ctx}><StoreProvider><TooltipProvider>
    <MartCards martId="orders" mart={orders} main spark={spark(date)} scores={{ rows: [{ [SUM]: 1 }], error: null, loading: false, retry: () => {} }} bucket="MONTH" filter={filter} version={0} paused={false} hasFilters={false} formatOf={() => ({} as never)} />
  </TooltipProvider></StoreProvider></AppServices>
);
const rule = (v: string): TraverseFilter[] => [{ column: 'status', operator: 'in', value: [v], placement: 'pre-join' } as TraverseFilter];
const rowsFor = (date: string): Row[] => [{ [date]: '2024-01-01', [SUM]: 3 }, { [date]: '2024-02-01', [SUM]: 5 }];
const trend = () => screen.queryByRole('img', { name: 'amount trend' }) ?? screen.queryByRole('img', { name: /trend$/ });

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} })); });

test('a filter change keeps the sparkline, dimmed and busy, until the new trend arrives', async () => {
  const { ctx, reads } = held();
  const view = render(ui(ctx, created, []));
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { reads[0]!.answer(rowsFor('created_at')); });
  await waitFor(() => expect(trend()).not.toBeNull());
  expect(trend()!.closest('.dm-stale')).toBeNull();
  view.rerender(ui(ctx, created, rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(screen.queryByLabelText('Loading trend')).toBeNull();
  const old = trend()!.closest('.dm-stale');
  expect(old).not.toBeNull();
  expect(old).toHaveAttribute('aria-busy', 'true');
  await act(async () => { reads[1]!.answer(rowsFor('created_at')); });
  await waitFor(() => expect(trend()!.closest('.dm-stale')).toBeNull());
  expect(document.querySelector('[aria-busy="true"] .dm-sparkline')).toBeNull();
});

test('a changed date keeps the placeholder, not the old sparkline', async () => {
  const { ctx, reads } = held();
  const view = render(ui(ctx, created, []));
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { reads[0]!.answer(rowsFor('created_at')); });
  await waitFor(() => expect(trend()).not.toBeNull());
  view.rerender(ui(ctx, updated, []));
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(screen.getByLabelText('Loading trend')).toBeInTheDocument();
  expect(trend()).toBeNull();
});
