import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Field } from '../model/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseFilter, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { TooltipProvider } from '../ui/Tooltip';
import type { ChartFields, ChartMart } from './fields';
import { metricKey, uniqueKey } from './queries';
import { MartCards, useScorecards } from './Scorecards';
import type { Spark } from './settings';

vi.mock('./useBucket', () => ({ useBucket: () => ({ bucket: 'MONTH', error: null, retry: () => {} }) }));

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const amount = f('amount', 'number', 'NUMERIC');
const orders: ChartMart = { aliasPath: '', recordsId: 'records:orders', title: 'Orders', hasPk: true, metrics: [{ field: amount, fn: 'SUM' }], dates: [], dimensions: [] };
const products: ChartMart = { aliasPath: 'products', recordsId: 'records:products', title: 'Products', hasPk: true, metrics: [], dates: [], dimensions: [] };
const spark: Spark = { hidden: new Set(), sparklines: false, metrics: {}, dates: {}, date: null };
const SUM = metricKey({ field: amount, fn: 'SUM' });
const ORDERS = uniqueKey('');
const PRODUCTS = uniqueKey('products');

type Read = { options: TraverseOptions; answer: (rows: Row[]) => void; fail: (e: Error) => void };

/** A ctx whose reads stay open until the test answers them, so loading can be looked at. */
function held() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: Read[] = [];
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (_id, options) => new Promise((resolve, reject) => {
    reads.push({
      options,
      answer: (rows) => resolve({ rowChunks: async function* () { yield rows; }, cancel: async () => {} }),
      fail: (e) => reject(e),
    });
  }) as never } } };
  return { ctx, reads };
}

function Strip({ marts, filter }: { marts: ChartMart[]; filter: TraverseFilter[] }) {
  const cf = { marts, counter: null } as unknown as ChartFields;
  const scores = useScorecards('orders', cf, filter, 0, false);
  return <>{marts.map((m) => <div key={m.aliasPath} data-mart={m.aliasPath || 'orders'}><MartCards martId="orders" mart={m} main={m.aliasPath === ''} spark={spark} scores={scores} bucket="MONTH" filter={filter} version={0} paused={false} hasFilters={false} formatOf={() => ({} as never)} /></div>)}</>;
}

const ui = (ctx: Ctx, marts: ChartMart[], filter: TraverseFilter[] = []) => (
  <AppServices ctx={ctx}><StoreProvider><TooltipProvider><Strip marts={marts} filter={filter} /></TooltipProvider></StoreProvider></AppServices>
);
const rule = (v: string): TraverseFilter[] => [{ column: 'status', operator: 'in', value: [v], placement: 'pre-join' } as TraverseFilter];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const valueOf = (key: string) => document.querySelector<HTMLElement>(`[data-card="${key !== ORDERS ? 'amount' : 'records:orders'}"] [data-card-value]`);

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Fake the frame clock only: the reads themselves resolve on real promises. */
const frames = () => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

async function loaded(filter: TraverseFilter[] = [], mart: ChartMart = orders, first: Row = { [SUM]: 450, [ORDERS]: 12 }, text = '450') {
  const { ctx, reads } = held();
  const view = render(ui(ctx, [mart], filter));
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { reads[0]!.answer([first]); });
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
  return { ctx, reads, view };
}

test('every mart rides one read: adding a mart and changing the filter each issue exactly one', async () => {
  const { ctx, reads, view } = await loaded();
  view.rerender(ui(ctx, [orders, products]));
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(reads[1]!.options.uniqueCount).toEqual(['', 'products']);
  await act(async () => { reads[1]!.answer([{ [SUM]: 450, [ORDERS]: 12, [PRODUCTS]: 5 }]); });
  view.rerender(ui(ctx, [orders, products], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(3));
  await flush();
  expect(reads).toHaveLength(3);
});

test('while a read runs the previous value shows dimmed and busy, and a new mart shows a skeleton', async () => {
  const { ctx, reads, view } = await loaded();
  view.rerender(ui(ctx, [orders, products]));
  await waitFor(() => expect(reads).toHaveLength(2));
  const old = valueOf(SUM)!;
  expect(old).toHaveTextContent('450');
  expect(old).toHaveAttribute('aria-busy', 'true');
  expect(old.className).toContain('dm-stale');
  expect(document.querySelector('[data-mart="products"] [aria-label="Loading"]')).not.toBeNull();
  expect(document.querySelector('[data-mart="products"] [data-card-value]')).toBeNull();
});

test('a new value rolls from the old one, whole for a count, and ends exactly on the new text after 500ms', async () => {
  const { ctx, reads, view } = await loaded();
  frames();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [SUM]: 1000, [ORDERS]: 20 }]); });
  const sum = valueOf(SUM)!;
  // Undimmed from the first frame, still showing the old number.
  expect(sum).not.toHaveAttribute('aria-busy');
  expect(sum.className).not.toContain('dm-stale');
  expect(sum).toHaveTextContent('450');
  act(() => { vi.advanceTimersByTime(250); });
  const mid = Number(valueOf(SUM)!.textContent!.replace(/,/g, ''));
  expect(mid).toBeGreaterThan(450);
  expect(mid).toBeLessThan(1000);
  const count = valueOf(ORDERS)!.textContent!;
  expect(count).toMatch(/^\d+$/);
  act(() => { vi.advanceTimersByTime(300); });
  expect(valueOf(SUM)).toHaveTextContent('1,000');
  expect(valueOf(ORDERS)).toHaveTextContent('20');
});

test('the exact value is final from the first frame of a roll', async () => {
  const { ctx, reads, view } = await loaded();
  frames();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [SUM]: 123456789, [ORDERS]: 20 }]); });
  act(() => { vi.advanceTimersByTime(100); });
  const el = valueOf(SUM)!;
  expect(el.getAttribute('data-exact')).toBe('123,456,789');
  expect(el.getAttribute('aria-label')).toContain('123,456,789');
  act(() => { vi.advanceTimersByTime(500); });
  expect(valueOf(SUM)).toHaveTextContent('123.5M');
});

test('reduced motion jumps straight to the new value', async () => {
  const { ctx, reads, view } = await loaded();
  frames();
  reduced = true;
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [SUM]: 1000, [ORDERS]: 20 }]); });
  expect(valueOf(SUM)).toHaveTextContent('1,000');
});

test('a failed read shows the error, not the stale values', async () => {
  const { ctx, reads, view } = await loaded();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.fail(new Error('boom')); });
  await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  expect(valueOf(SUM)).toBeNull();
});

test('strings from the warehouse roll too, and a big NUMERIC settles on its exact text, not an exponent', async () => {
  const { ctx, reads, view } = await loaded([], orders, { [SUM]: '450', [ORDERS]: '12' });
  frames();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [SUM]: '1000', [ORDERS]: '20' }]); });
  act(() => { vi.advanceTimersByTime(250); });
  const mid = Number(valueOf(SUM)!.textContent!.replace(/,/g, ''));
  expect(mid).toBeGreaterThan(450);
  expect(mid).toBeLessThan(1000);
  act(() => { vi.advanceTimersByTime(300); });
  expect(valueOf(SUM)).toHaveTextContent('1,000');
  view.rerender(ui(ctx, [orders], rule('b')));
  await waitFor(() => expect(reads).toHaveLength(3));
  await act(async () => { reads[2]!.answer([{ [SUM]: '123456789012345678901', [ORDERS]: '20' }]); });
  act(() => { vi.advanceTimersByTime(600); });
  expect(valueOf(SUM)!.getAttribute('data-exact') ?? valueOf(SUM)!.textContent).not.toMatch(/e\+/i);
  expect(valueOf(SUM)!.textContent).not.toMatch(/e\+/i);
});

test('a non-integer measure shows at most one decimal on the way from 412.5 to 1000.5', async () => {
  const avg: ChartMart = { ...orders, hasPk: false, metrics: [{ field: amount, fn: 'AVG' }] };
  const AVG = metricKey({ field: amount, fn: 'AVG' });
  const { ctx, reads, view } = await loaded([], avg, { [AVG]: 412.5 }, '412.5');
  frames();
  view.rerender(ui(ctx, [avg], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [AVG]: 1000.5 }]); });
  for (let i = 0; i < 12; i++) {
    act(() => { vi.advanceTimersByTime(40); });
    expect(valueOf(AVG)!.textContent).toMatch(/^[\d,]+(\.\d)?$/);
  }
  expect(valueOf(AVG)).toHaveTextContent('1,000.5');
});

test('the value from before an empty result does not come back as the dimmed value of the next read', async () => {
  const { ctx, reads, view } = await loaded();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([]); });
  view.rerender(ui(ctx, [orders], rule('b')));
  await waitFor(() => expect(reads).toHaveLength(3));
  expect(valueOf(SUM)).toBeNull();
  expect(screen.queryByText('450')).toBeNull();
  expect(document.querySelector('[aria-label="Loading"]')).not.toBeNull();
});

test('a value that arrives mid-roll rolls on from the number on screen', async () => {
  const { ctx, reads, view } = await loaded();
  frames();
  view.rerender(ui(ctx, [orders], rule('a')));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => { reads[1]!.answer([{ [SUM]: 1000, [ORDERS]: 20 }]); });
  act(() => { vi.advanceTimersByTime(200); });
  const onScreen = Number(valueOf(SUM)!.textContent!.replace(/,/g, ''));
  expect(onScreen).toBeGreaterThan(450);
  view.rerender(ui(ctx, [orders], rule('b')));
  await waitFor(() => expect(reads).toHaveLength(3));
  await act(async () => { reads[2]!.answer([{ [SUM]: 100, [ORDERS]: 20 }]); });
  // Not a jump back to 450 or on to 1000: the first frames stay near where it was.
  const first = Number(valueOf(SUM)!.textContent!.replace(/,/g, ''));
  expect(Math.abs(first - onScreen)).toBeLessThan(60);
  act(() => { vi.advanceTimersByTime(600); });
  expect(valueOf(SUM)).toHaveTextContent('100');
});
