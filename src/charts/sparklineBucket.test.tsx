import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseFilter, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { TooltipProvider } from '../ui/Tooltip';
import type { ChartMart } from './fields';
import { metricKey, rangeKeys } from './queries';
import { MartCards } from './Scorecards';
import type { Spark } from './settings';
import { useBucket } from './useBucket';

// The real useBucket, with Auto: a filter change gives it a new range key, so the bucket is null until the range read answers.

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const amount = f('amount', 'number', 'NUMERIC');
const created = f('created_at', 'date', 'TIMESTAMP');
const orders: ChartMart = { aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: false, metrics: [{ field: amount, fn: 'SUM' }], dates: [created], dimensions: [] };
const SUM = metricKey({ field: amount, fn: 'SUM' });
const spark: Spark = { hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date: created };

type Read = { options: TraverseOptions; answer: (rows: Row[]) => void; fail: () => void };
/** A ctx whose reads stay open until the test answers or fails them. */
function gated() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: Read[] = [];
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (_id, options) => new Promise((resolve, reject) => {
    reads.push({ options, answer: (rows) => resolve({ rowChunks: async function* () { yield rows; }, cancel: async () => {} }), fail: () => reject(new Error('range failed')) });
  }) as never } } };
  return { ctx, reads };
}

/** The charts' body in small: the real bucket read, then the cards on it. */
function Cards({ filter }: { filter: TraverseFilter[] }) {
  const { bucket, pending } = useBucket('orders', created, 'AUTO', filter, 0, false);
  return <MartCards martId="orders" mart={orders} main spark={spark} scores={{ rows: [{ [SUM]: 1 }], error: null, loading: false, held: false, retry: () => {} }} bucket={bucket} bucketPending={pending} filter={filter} version={0} paused={false} hasFilters={false} formatOf={() => ({} as never)} />;
}
const ui = (ctx: Ctx, filter: TraverseFilter[]) => (
  <AppServices ctx={ctx}><StoreProvider><TooltipProvider><Cards filter={filter} /></TooltipProvider></StoreProvider></AppServices>
);
const rule = (v: string): TraverseFilter[] => [{ column: 'status', operator: 'in', value: [v], placement: 'pre-join' } as TraverseFilter];
const range: Row[] = [{ [rangeKeys(created).min]: '2024-01-01', [rangeKeys(created).max]: '2024-06-01' }];
const series: Row[] = [{ created_at: '2024-01-01', [SUM]: 3 }, { created_at: '2024-02-01', [SUM]: 5 }];
const trend = () => screen.queryByRole('img', { name: 'amount trend' }) ?? screen.queryByRole('img', { name: /trend$/ });
const dimmed = () => trend()?.closest('.dm-stale') ?? null;

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} })); });

async function firstTrend(ctx: Ctx, reads: Read[]) {
  const view = render(ui(ctx, []));
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { reads[0]!.answer(range); });
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer(series); });
  await waitFor(() => expect(trend()).not.toBeNull());
  expect(dimmed()).toBeNull();
  return view;
}

test('a filter change keeps the old sparkline dimmed through the range read and the trend read', async () => {
  const { ctx, reads } = gated();
  const view = await firstTrend(ctx, reads);
  view.rerender(ui(ctx, rule('a')));
  await waitFor(() => expect(reads).toHaveLength(3));
  // The range read is open: no bucket yet, so no trend read, and the old sparkline stays.
  expect(screen.queryByLabelText('Loading trend')).toBeNull();
  expect(dimmed()).not.toBeNull();
  expect(dimmed()).toHaveAttribute('aria-busy', 'true');
  await act(async () => { reads[2]!.answer(range); });
  await waitFor(() => expect(reads).toHaveLength(4));
  expect(dimmed()).not.toBeNull();
  expect(dimmed()).toHaveAttribute('aria-busy', 'true');
  await act(async () => { reads[3]!.answer(series); });
  await waitFor(() => expect(dimmed()).toBeNull());
  expect(trend()).not.toBeNull();
  expect(document.querySelector('[aria-busy="true"] .dm-sparkline')).toBeNull();
});

test('a failed range read leaves no dimmed sparkline behind', async () => {
  const { ctx, reads } = gated();
  const view = await firstTrend(ctx, reads);
  view.rerender(ui(ctx, rule('a')));
  await waitFor(() => expect(reads).toHaveLength(3));
  expect(dimmed()).not.toBeNull();
  await act(async () => { reads[2]!.fail(); });
  await waitFor(() => expect(dimmed()).toBeNull());
  expect(trend()).toBeNull();
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  expect(reads).toHaveLength(3);
});
