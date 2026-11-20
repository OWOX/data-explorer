import { vi } from 'vitest';
import type { Ctx } from './types';
import { perCtx } from './per-ctx';

test('makes one value per ctx and reuses it', () => {
  const make = vi.fn(() => new Map<string, number>());
  const of = perCtx(make);
  const a = {} as Ctx;
  const b = {} as Ctx;
  expect(of(a)).toBe(of(a));
  expect(of(b)).not.toBe(of(a));
  expect(make).toHaveBeenCalledTimes(2);
});
