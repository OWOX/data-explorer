import { describe, vi } from 'vitest';
import { stubCtx } from './test-ctx';
import { createChartSettings } from './chart-settings';
import type { Ctx } from '../sdk/types';

const ctxWith = (get: (id: string) => Promise<unknown>, put: (id: string, d: unknown) => Promise<unknown>) => ({ ...stubCtx(), collections: () => ({ get, put }) }) as unknown as Ctx;

test('load is empty on a missing document', async () => {
  expect(await createChartSettings(stubCtx()).load('M')).toEqual({});
});

test('save does one put under the mart id and load reads it back', async () => {
  const store = new Map<string, unknown>();
  const s = { charts: [{ id: 'a', kind: 'pie' as const, measure: 'amount' }] };
  const cs = createChartSettings(ctxWith(async (id) => (store.has(id) ? { document: store.get(id) } : null), async (id, d) => { store.set(id, d); }));
  cs.save('M', s);
  await vi.waitFor(() => expect(store.get('M')).toEqual(s));
  expect(await cs.load('M')).toEqual(s);
});

test('a failed read gives {} and a failed write only warns', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const down = async () => { throw new Error('down'); };
  const store = createChartSettings(ctxWith(down, down));
  expect(await store.load('M')).toEqual({});
  store.save('M', {});
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  warn.mockRestore();
});

test('a v1 document keeps its scorecards and drops its time series and pie', async () => {
  const doc = { scorecards: { hidden: ['a'] }, timeSeries: { metric: 'm' }, pie: { dimension: 'd' } };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M')).toEqual({ scorecards: { hidden: ['a'] } });
});

test('a malformed document keeps only known scorecard keys of the right type', async () => {
  const doc = { scorecards: { hidden: ['a', 1, 'b'], sparklines: 'yes' }, charts: 'nope', other: true };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M')).toEqual({ scorecards: { hidden: ['a', 'b'] } });
});

test('a v2 document keeps known chart keys of the right type and drops bad charts', async () => {
  const doc = { version: 2, charts: [
    { id: 'a', kind: 'line', measure: 'm', measure2: null, bucket: 'FORTNIGHT', area: 'yes', orientation: 'diagonal', extra: 1 },
    { id: 'b', kind: 'donut' },
    { kind: 'pie' },
    { id: 'a', kind: 'pie' },
    { id: 'c', kind: 'heatmap', hidden: true, dimension: 'x', dimension2: 'y', stack: null, bucket: 'WEEK' },
  ] };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M')).toEqual({ charts: [
    { id: 'a', kind: 'line', measure: 'm', measure2: null },
    { id: 'c', kind: 'heatmap', hidden: true, dimension: 'x', dimension2: 'y', stack: null, bucket: 'WEEK' },
  ] });
});

test('a chart size is read back when it is whole cells within the limits; anything else is left out', async () => {
  const sizes = [{ cols: 20, rows: 12 }, { cols: 20 }, { rows: 12.5, cols: 20 }, { cols: 1, rows: 9999 }, 'big', null];
  const doc = { version: 2, charts: sizes.map((size, i) => ({ id: `${i}`, kind: 'pie', size })) };
  const { charts } = await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M');
  expect(charts!.map((c) => c.size)).toEqual([{ cols: 20, rows: 12 }, { cols: 20 }, { cols: 20 }, undefined, undefined, undefined]);
});

test('a non-object document or part is dropped', async () => {
  expect(await createChartSettings(ctxWith(async () => ({ document: 'x' }), async () => {})).load('M')).toEqual({});
  expect(await createChartSettings(ctxWith(async () => ({ document: { scorecards: [], pie: 3 } }), async () => {})).load('M')).toEqual({});
});

test('scorecard metrics keep string values only and are dropped when not an object', async () => {
  const load = (doc: unknown) => createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M');
  expect(await load({ scorecards: { metrics: { amount: 'records', bad: 3, worse: null } } })).toEqual({ scorecards: { metrics: { amount: 'records' } } });
  expect(await load({ scorecards: { metrics: ['x'] } })).toEqual({ scorecards: {} });
  expect(await load({ scorecards: { metrics: 'x' } })).toEqual({ scorecards: {} });
});

test('scorecard dates keep string values only, as metrics do', async () => {
  const load = (doc: unknown) => createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M');
  expect(await load({ scorecards: { dates: { amount: 'created_at', bad: 3 } } })).toEqual({ scorecards: { dates: { amount: 'created_at' } } });
  expect(await load({ scorecards: { dates: 'x' } })).toEqual({ scorecards: {} });
});

const pieChart = { id: 'a', kind: 'pie' as const, measure: 'amount' };
const loadChartDoc = (doc: unknown) => createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M');

test('a document saved with the old version marker keeps its charts and loses the marker', async () => {
  expect(await loadChartDoc({ version: 2, charts: [pieChart] })).toEqual({ charts: [pieChart] });
});

test('a document saved without the marker keeps its charts', async () => {
  expect(await loadChartDoc({ charts: [pieChart] })).toEqual({ charts: [pieChart] });
});

test('a load waits for the same mart\'s pending save, and not for another mart\'s', async () => {
  const store = new Map<string, unknown>();
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const cs = createChartSettings(ctxWith(async (id) => (store.has(id) ? { document: store.get(id) } : null), async (id, d) => { if (id === 'M') await slow; store.set(id, d); }));
  const s = { charts: [{ id: 'a', kind: 'pie' as const }] };
  cs.save('M', s);
  cs.save('N', s);
  const loadN = cs.load('N');
  const loadM = cs.load('M');
  expect(await loadN).toEqual(s);
  let done = false;
  void loadM.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 20));
  expect(done).toBe(false);
  release();
  expect(await loadM).toEqual(s);
});

describe('save queue', () => {
  afterEach(() => vi.useRealTimers());
  const gated = () => {
    const puts: { id: string; doc: unknown; release: () => void }[] = [];
    const store = new Map<string, unknown>();
    const cs = createChartSettings(ctxWith(async (id) => (store.has(id) ? { document: store.get(id) } : null), (id, doc) => new Promise<void>((res) => { puts.push({ id, doc, release: () => { store.set(id, doc); res(); } }); })));
    return { cs, puts };
  };

  test('a load stops waiting for a save that never settles after 5s, then reads anyway', async () => {
    vi.useFakeTimers();
    const { cs } = gated();
    void cs.save('M', {});
    let got: unknown;
    void cs.load('M').then((v) => { got = v; });
    await vi.advanceTimersByTimeAsync(4900);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(got).toEqual({});
  });

  test('saves while one is in flight coalesce into one more put with the newest doc; a load waits for both', async () => {
    vi.useFakeTimers();
    const { cs, puts } = gated();
    const doc = (n: number) => ({ charts: [{ id: 'a', kind: 'pie' as const, size: { cols: n } }] });
    void cs.save('M', doc(11));
    await vi.advanceTimersByTimeAsync(0);
    void cs.save('M', doc(12));
    void cs.save('M', doc(13));
    const last = cs.save('M', doc(14));
    let loaded: unknown;
    void cs.load('M').then((v) => { loaded = v; });
    await vi.advanceTimersByTimeAsync(0);
    expect(puts.map((p) => p.doc)).toEqual([doc(11)]);
    puts[0]!.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(puts.map((p) => p.doc)).toEqual([doc(11), doc(14)]);
    expect(loaded).toBeUndefined();
    puts[1]!.release();
    await last;
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded).toEqual(doc(14));
    expect(puts).toHaveLength(2);
  });
});
