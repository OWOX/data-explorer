import { vi } from 'vitest';
import { createColumnStore, SAVE_DEBOUNCE_MS } from './grid-columns';
import { stubCtx } from './test-ctx';
import type { Ctx } from '../sdk/types';

function ctxWith(col: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> }): Ctx {
  return { ...stubCtx(), collections: () => col } as unknown as Ctx;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('load reads the saved columns once and caches them', async () => {
  const get = vi.fn(async () => ({ document: { columns: ['a', 'b'], at: 'x' } }));
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await store.load('m')).toEqual(['a', 'b']);
  expect(await store.load('m')).toEqual(['a', 'b']);
  expect(get).toHaveBeenCalledTimes(1);
});

test('an absent document loads as null and is cached', async () => {
  const get = vi.fn(async () => null);
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await store.load('m')).toBeNull();
  expect(await store.load('m')).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
});

test('a failed read returns null and is not cached', async () => {
  const get = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ document: { columns: ['a'], at: 'x' } });
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await store.load('m')).toBeNull();
  expect(await store.load('m')).toEqual(['a']);
  expect(get).toHaveBeenCalledTimes(2);
});

test('save is debounced per mart and the last write wins', async () => {
  vi.useFakeTimers();
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get: vi.fn(), put }));
  store.save('m', ['a']);
  vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
  store.save('m', ['a', 'b']);
  store.save('n', ['z']);
  vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
  expect(put).not.toHaveBeenCalledWith('m', expect.anything());
  vi.advanceTimersByTime(1);
  await vi.runAllTimersAsync();
  expect(put).toHaveBeenCalledTimes(2);
  expect(put).toHaveBeenCalledWith('m', { columns: ['a', 'b'], at: expect.any(String) });
  expect(put).toHaveBeenCalledWith('n', { columns: ['z'], at: expect.any(String) });
});

test('a saved list is served from memory without a read', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => null);
  const store = createColumnStore(ctxWith({ get, put: vi.fn(async () => ({})) }));
  store.save('m', ['a']);
  expect(await store.load('m')).toEqual(['a']);
  expect(get).not.toHaveBeenCalled();
});

test('a failing put is swallowed with a warning', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = createColumnStore(ctxWith({ get: vi.fn(), put: vi.fn(async () => { throw new Error('nope'); }) }));
  store.save('m', ['a']);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('concurrent loads share one read', async () => {
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x' } }));
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await Promise.all([store.load('m'), store.load('m')])).toEqual([['a'], ['a']]);
  expect(get).toHaveBeenCalledTimes(1);
});

test('a stored null document counts as absent and is cached', async () => {
  const get = vi.fn(async () => ({ document: null }));
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await store.load('m')).toBeNull();
  expect(await store.load('m')).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
});

test('picks are read with the doc, merged by a later save, and written back without erasing the others', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', picks: { customers: ['customers__city'], stores: ['stores__city'] } } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  expect(await store.loadPicks('m')).toEqual({ customers: ['customers__city'], stores: ['stores__city'] });
  store.save('m', ['a', 'customers__email'], { customers: ['customers__email'] });
  expect(await store.loadPicks('m')).toEqual({ customers: ['customers__email'], stores: ['stores__city'] });
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenCalledWith('m', { columns: ['a', 'customers__email'], at: expect.any(String), picks: { customers: ['customers__email'], stores: ['stores__city'] } });
});

test('a plain column save keeps the picks that were stored and never read', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', picks: { customers: ['customers__city'] } } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  store.save('m', ['a', 'b']);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenCalledWith('m', { columns: ['a', 'b'], at: expect.any(String), picks: { customers: ['customers__city'] } });
});

test('a failed read gives no picks', async () => {
  const store = createColumnStore(ctxWith({ get: vi.fn().mockRejectedValue(new Error('down')), put: vi.fn() }));
  expect(await store.loadPicks('m')).toEqual({});
});

test('what a mart showed when it left a grid is read with its doc, saved without erasing the columns, and can be forgotten', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a', 'b'], at: 'x', lastShown: ['city', 'name'] } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  expect(store.lastShown('m')).toBeNull();
  expect(await store.loadLastShown('m')).toEqual(['city', 'name']);
  expect(store.lastShown('m')).toEqual(['city', 'name']);
  store.saveLastShown('m', ['email']);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenLastCalledWith('m', { columns: ['a', 'b'], at: expect.any(String), lastShown: ['email'] });
  store.saveLastShown('m', null);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenLastCalledWith('m', { columns: ['a', 'b'], at: expect.any(String) });
});

test('a plain column save keeps the last shown fields that were stored and never read', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', lastShown: ['city'] } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  store.save('m', ['a', 'b']);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenCalledWith('m', { columns: ['a', 'b'], at: expect.any(String), lastShown: ['city'] });
});

test('a mart whose doc could not be read is never written over', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => { throw new Error('down'); });
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  store.saveLastShown('m', ['a']);
  store.save('m', ['x'], { j: ['y'] });
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
  await vi.runAllTimersAsync();
  expect(get).toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('aggregations and buckets are read with the doc, saved with the columns, and bad rules are ignored', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', aggregations: [{ column: 'a', function: 'SUM' }, { column: 'a', function: 'NOPE' }, 7], dateTrunc: [{ column: 'd', unit: 'MONTH', timeZone: 'UTC' }, { column: 'd', unit: 'HOUR' }] } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  expect(await store.loadAggregation('m')).toEqual({ aggregations: [{ column: 'a', function: 'SUM' }], dateTrunc: [{ column: 'd', unit: 'MONTH', timeZone: 'UTC' }] });
  store.saveAggregation('m', { aggregations: [{ column: 'a', function: 'AVG' }], dateTrunc: [] });
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenLastCalledWith('m', { columns: ['a'], at: expect.any(String), aggregations: [{ column: 'a', function: 'AVG' }] });
  store.saveAggregation('m', { aggregations: [], dateTrunc: [] });
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenLastCalledWith('m', { columns: ['a'], at: expect.any(String) });
});

test('a plain column save keeps the aggregations that were stored and never read', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', aggregations: [{ column: 'a', function: 'SUM' }] } }));
  const put = vi.fn(async () => ({}));
  const store = createColumnStore(ctxWith({ get, put }));
  store.save('m', ['a', 'b']);
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  expect(put).toHaveBeenCalledWith('m', { columns: ['a', 'b'], at: expect.any(String), aggregations: [{ column: 'a', function: 'SUM' }] });
});

test('a bucket with a time zone the backend would refuse, or on a column that also has a function, is not loaded', async () => {
  const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', aggregations: [{ column: 'n', function: 'SUM' }], dateTrunc: [
    { column: 'd1', unit: 'DAY', timeZone: "UTC'; DROP" }, { column: 'd2', unit: 'DAY', timeZone: '1UTC' }, { column: 'n', unit: 'DAY' }, { column: 'd3', unit: 'DAY', timeZone: 'Europe/Kyiv' }, { column: 'd4', unit: 'DAY', timeZone: 'A'.repeat(65) }, { column: 'd5', unit: 'DAY', timeZone: 5 },
  ] } }));
  const store = createColumnStore(ctxWith({ get, put: vi.fn() }));
  expect(await store.loadAggregation('m')).toEqual({ aggregations: [{ column: 'n', function: 'SUM' }], dateTrunc: [{ column: 'd3', unit: 'DAY', timeZone: 'Europe/Kyiv' }] });
});

describe('the saved grid view', () => {
  const view = {
    filters: { name: { field: 'name', op: 'eq' as const, value: 'a, b', list: true as const }, amount: { field: 'amount', op: 'gt' as const, value: 5, fn: 'SUM' as const } },
    slices: { customers__city: { field: 'customers__city', op: 'contains' as const, value: 'x' } },
    sorts: [{ field: 'amount', direction: 'desc' as const }],
    limit: 400,
    view: 'charts' as const,
  };

  test('every field round-trips through the doc, the list marker included', async () => {
    vi.useFakeTimers();
    let stored: unknown = null;
    const put = vi.fn(async (_id: string, doc: unknown) => { stored = doc; return {}; });
    const get = vi.fn(async () => (stored ? { document: stored } : null));
    const a = createColumnStore(ctxWith({ get, put }));
    await a.loadView('m');
    a.saveView('m', view);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const b = createColumnStore(ctxWith({ get, put }));
    expect(await b.loadView('m')).toEqual(view);
  });

  test('the Unique Count paths round-trip with the view, and a view without them reads as none', async () => {
    vi.useFakeTimers();
    let stored: unknown = null;
    const put = vi.fn(async (_id: string, doc: unknown) => { stored = doc; return {}; });
    const get = vi.fn(async () => (stored ? { document: stored } : null));
    const a = createColumnStore(ctxWith({ get, put }));
    await a.loadView('m');
    a.saveView('m', { filters: {}, sorts: [{ field: 'Unique Count', direction: 'desc' }], limit: 200, uniqueCount: ['', 'customers'] });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const b = createColumnStore(ctxWith({ get, put }));
    expect(await b.loadView('m')).toEqual({ filters: {}, sorts: [{ field: 'Unique Count', direction: 'desc' }], limit: 200, uniqueCount: ['', 'customers'] });
    const old = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: { columns: [], at: 'x', gridView: { fl: [], s: null, l: 200 } } })), put: vi.fn() }));
    expect(await old.loadView('m')).toEqual({ filters: {}, sorts: null, limit: 200 });
  });

  test('a null sort and the table survive as such', async () => {
    const doc = { columns: [], at: 'x', gridView: { fl: [], s: null, l: 200 } };
    const store = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: doc })), put: vi.fn() }));
    expect(await store.loadView('m')).toEqual({ filters: {}, sorts: null, limit: 200 });
  });

  test('malformed rules, sorts and shapes are left out', async () => {
    const doc = { columns: [], at: 'x', gridView: { fl: [['a', 'nope'], ['b', 'eq', 'v'], 'junk'], sl: [['c']], s: [['a', 1], ['b', 7], 3], l: 'x' } };
    const bad = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: doc })), put: vi.fn() }));
    expect(await bad.loadView('m')).toBeNull();
    const ok = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: { ...doc, gridView: { ...doc.gridView, l: 100 } } })), put: vi.fn() }));
    expect(await ok.loadView('m')).toEqual({ filters: { b: { field: 'b', op: 'eq', value: 'v' } }, sorts: [{ field: 'a', direction: 'asc' }], limit: 200 });
  });

  test('nothing is written before the doc is read, and a failed read never writes', async () => {
    vi.useFakeTimers();
    const put = vi.fn(async () => ({}));
    const down = createColumnStore(ctxWith({ get: vi.fn().mockRejectedValue(new Error('down')), put }));
    down.saveView('m', view);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(put).not.toHaveBeenCalled();
    const get = vi.fn(async () => ({ document: { columns: ['a'], at: 'x', picks: { j: ['j__f'] } } }));
    const up = createColumnStore(ctxWith({ get, put }));
    up.saveView('m', view);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('m', expect.objectContaining({ columns: ['a'], picks: { j: ['j__f'] }, gridView: expect.anything() }));
  });

  test('changes are debounced into one write', async () => {
    vi.useFakeTimers();
    const put = vi.fn(async () => ({}));
    const store = createColumnStore(ctxWith({ get: vi.fn(async () => null), put }));
    store.saveView('m', view);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    store.saveView('m', { ...view, limit: 600 });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
