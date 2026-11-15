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
