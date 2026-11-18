import { vi } from 'vitest';
import { stubCtx } from './test-ctx';
import { createChartSettings } from './chart-settings';
import type { Ctx } from '../sdk/types';

const ctxWith = (get: () => Promise<unknown>, put: () => Promise<unknown>) => ({ ...stubCtx(), collections: () => ({ get, put }) }) as unknown as Ctx;

test('load is empty on a missing document', async () => {
  expect(await createChartSettings(stubCtx()).load('M')).toEqual({});
});

test('save does one put under the mart id and load reads it back', async () => {
  const put = vi.fn(async () => {});
  const s = { pie: { metric: 'amount' }, timeSeries: { bucket: 'WEEK' as const, stack: null } };
  createChartSettings(ctxWith(async () => null, put)).save('M', s);
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put).toHaveBeenCalledWith('M', s);
  const ctx = stubCtx();
  const store = createChartSettings(ctx);
  store.save('M', s);
  await vi.waitFor(async () => expect(await store.load('M')).toEqual(s));
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

test('a malformed document keeps only known keys of the right type', async () => {
  const doc = {
    scorecards: { hidden: ['a', 1, 'b'], sparklines: 'yes' },
    timeSeries: { date: 5, bucket: 'FORTNIGHT', metric: 'm', stack: null, orientation: 'diagonal', extra: 1 },
    pie: 'nope',
    other: true,
  };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M'))
    .toEqual({ scorecards: { hidden: ['a', 'b'] }, timeSeries: { metric: 'm', stack: null } });
});

test('a non-object document or part is dropped', async () => {
  expect(await createChartSettings(ctxWith(async () => ({ document: 'x' }), async () => {})).load('M')).toEqual({});
  expect(await createChartSettings(ctxWith(async () => ({ document: { scorecards: [], pie: 3 } }), async () => {})).load('M')).toEqual({});
});
