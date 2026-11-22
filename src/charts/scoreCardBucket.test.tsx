import { render } from '@testing-library/react';
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

function show(shown: ChartMart, spark: Spark) {
  render(
    <AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider>
      <MartCards martId="orders" mart={shown} main spark={spark} scores={{ rows: [{ amount: 1 }], error: null, loading: false, retry: () => {} }} bucket="MONTH" autoBucket
        filter={[]} version={0} paused hasFilters={false} formatOf={() => ({} as never)} onHide={() => {}} />
    </StoreProvider></AppServices>,
  );
}
// The date each card asked useBucket to range (null: it asked for none and rides the charts' bucket).
const asked = () => useBucket.mock.calls.map((c) => c[1]?.name ?? null);

beforeEach(() => { useBucket.mockClear(); });

test('an explicit pick of another date under Auto ranges that date for its own bucket', () => {
  show(mart([created, updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: { amount: 'updated_at' }, date: created });
  expect(asked()).toContain('updated_at');
});

test('a joined mart without the chart date uses its default date with no range read of its own', () => {
  show(mart([updated]), { hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date: created });
  expect(asked().every((d) => d === null)).toBe(true);
});
