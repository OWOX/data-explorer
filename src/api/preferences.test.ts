import { vi } from 'vitest';
import { stubCtx } from './test-ctx';
import { createPreferences } from './preferences';
import type { Ctx } from '../sdk/types';

test('round-trips the folded map through the preferences collection, document "bands"', async () => {
  const ctx = stubCtx();
  const p = createPreferences(ctx);
  expect(await p.loadFolded()).toEqual({});
  p.saveFolded({ 'band-sources': false, 'band-data': true });
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadFolded()).toEqual({ 'band-sources': false, 'band-data': true }));
});

test('a failed read or write logs a warning and gives the defaults', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ctx = { ...stubCtx(), collections: () => ({ get: async () => { throw new Error('down'); }, put: async () => { throw new Error('down'); } }) } as unknown as Ctx;
  const p = createPreferences(ctx);
  expect(await p.loadFolded()).toEqual({});
  p.saveFolded({ a: true });
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  warn.mockRestore();
});

test('a malformed document is ignored', async () => {
  const ctx = { ...stubCtx(), collections: () => ({ get: async () => ({ document: { folded: { a: 'yes', b: true } } }), put: async () => {} }) } as unknown as Ctx;
  expect(await createPreferences(ctx).loadFolded()).toEqual({ b: true });
});
