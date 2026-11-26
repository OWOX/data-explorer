import { render, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import type { ChartMart } from './fields';
import { rangeKeys } from './queries';
import { MartCards } from './Scorecards';

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const net = f('orders__net', 'number', 'NUMERIC');
const tax = f('orders__tax', 'number', 'NUMERIC');
const placed = f('orders__date', 'date', 'DATE');
// The charts draw on the main mart's date, by month; Orders is a joined mart with one date of its own.
const firstOrder = f('first_order_date', 'date', 'DATE');
const orders: ChartMart = { aliasPath: 'orders', recordsId: 'records:orders', title: 'Orders', hasPk: false, metrics: [net, tax].map((field) => ({ field, fn: 'SUM' as const })), dates: [placed], dimensions: [] };

function show(min: string, max: string) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: TraverseOptions[] = [];
  const keys = rangeKeys(placed);
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (async (_id: string, o: TraverseOptions) => {
    reads.push(o);
    const rows: Row[] = o.dateTrunc ? [] : [{ [keys.min]: min, [keys.max]: max }];
    return { rowChunks: async function* () { yield rows; } };
  }) as unknown as Ctx['owox']['dataMarts']['traverseData'] } } };
  render(
    <AppServices ctx={ctx}><StoreProvider>
      <MartCards martId="customers" mart={orders} main={false} spark={{ hidden: new Set(), sparklines: true, metrics: {}, dates: {}, date: firstOrder }} scores={{ rows: [{}], error: null, loading: false, held: false, retry: () => {} }} bucket="MONTH" autoBucket
        filter={[]} version={0} paused={false} hasFilters={false} formatOf={() => ({} as never)} onHide={() => {}} />
    </StoreProvider></AppServices>,
  );
  return { trends: () => reads.filter((o) => o.dateTrunc), ranges: () => reads.filter((o) => !o.dateTrunc) };
}

test('a joined mart’s sparklines are cut by its own date: 54 days are daily, with one range read and one trend read for all its cards', async () => {
  const t = show('2026-10-01', '2026-11-23');
  await waitFor(() => expect(t.trends()).toHaveLength(1));
  expect(t.trends()[0]!.dateTrunc).toEqual([expect.objectContaining({ column: 'orders__date', unit: 'DAY' })]);
  expect(t.ranges()).toHaveLength(1);
});

test('more than 60 days are weekly', async () => {
  const t = show('2026-09-01', '2026-11-23');
  await waitFor(() => expect(t.trends()).toHaveLength(1));
  expect(t.trends()[0]!.dateTrunc).toEqual([expect.objectContaining({ column: 'orders__date', unit: 'WEEK' })]);
});
