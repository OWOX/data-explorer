import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../state/store';
import type { ChartMart } from './fields';
import { MartCards } from './Scorecards';
import type { Spark } from './settings';

const useBucket = vi.hoisted(() => vi.fn<(martId: string, date: Field | null) => { bucket: string; error: null; retry: () => void }>().mockReturnValue({ bucket: 'WEEK', error: null, retry: () => {} }));
vi.mock('./useBucket', () => ({ useBucket }));

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const amount = f('amount', 'number', 'NUMERIC');
const created = f('created_at', 'date', 'TIMESTAMP');
const updated = f('updated_at', 'date', 'TIMESTAMP');
const mart = (dates: Field[]): ChartMart => ({ aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: false, metrics: [{ field: amount, fn: 'SUM' as const }], dates, dimensions: [] });

function show(shown: ChartMart, spark: Spark, paused = true) {
  render(
    <AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider>
      <MartCards martId="orders" mart={shown} main spark={spark} scores={{ rows: [{ amount: 1 }], error: null, loading: false, retry: () => {} }} bucket="MONTH" autoBucket
        filter={[]} version={0} paused={paused} hasFilters={false} formatOf={() => ({} as never)} onHide={() => {}} />
    </StoreProvider></AppServices>,
  );
}
// The date each card asked useBucket to range (null: it asked for none and rides the charts' bucket).
const asked = () => useBucket.mock.calls.map((c) => c[1]?.name ?? null);

beforeEach(() => { useBucket.mockClear(); useBucket.mockReturnValue({ bucket: 'WEEK', error: null, retry: () => {} }); });

test('an explicit pick of another date under Auto ranges that date for its own bucket', () => {
  show(mart([created, updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: { amount: 'updated_at' }, date: created });
  expect(asked()).toContain('updated_at');
});

test('a joined mart without the chart date uses its default date with no range read of its own', () => {
  show(mart([updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date: created });
  expect(asked().every((d) => d === null)).toBe(true);
});

test('a saved date the mart no longer shows falls back to the mart default and reads no range of its own', () => {
  show(mart([created]), { hidden: new Set(), sparklines: true, metrics: {}, dates: { amount: 'updated_at' }, date: updated });
  expect(asked().every((d) => d === null)).toBe(true);
});

test('a card whose trend is still being read shows a placeholder in the sparkline area, and it goes when the rows land', async () => {
  useBucket.mockReturnValue({ bucket: 'MONTH', error: null, retry: () => {} });
  show(mart([created, updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: { amount: 'updated_at' }, date: created }, false);
  expect(screen.getByLabelText('Loading trend')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByLabelText('Loading trend')).toBeNull());
});

test('a card waiting for its own bucket shows the placeholder too', () => {
  useBucket.mockReturnValue({ bucket: null as never, error: null, retry: () => {} });
  show(mart([created, updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: { amount: 'updated_at' }, date: created }, false);
  expect(screen.getByLabelText('Loading trend')).toBeInTheDocument();
});
