import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { useOwnAliases } from './useOwnAliases';

/** A mock whose blendable schemas name every join of `stores` "Store Country", count each read, and fail for `broken`. */
function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: string[] = [];
  const getJson = ctx.owox.getJson.bind(ctx.owox) as (url: string, ...rest: unknown[]) => Promise<unknown>;
  (ctx.owox as { getJson: unknown }).getJson = async (url: string, ...rest: unknown[]) => {
    const m = /\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(url);
    if (m) reads.push(m[1]!);
    if (m?.[1] === 'broken') throw new Error('403');
    const dto = await getJson(url, ...rest);
    if (m?.[1] !== 'stores') return dto;
    const d = dto as { availableSources?: { aliasPath: string; defaultAlias?: string | null }[] };
    return { ...d, availableSources: d.availableSources?.map((s) => ({ ...s, defaultAlias: 'Store Country' })) };
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx as Ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  return { reads, wrapper };
}

test('a mart is read the first time a line asks about it, and the lookup answers once the read lands', async () => {
  const { reads, wrapper } = setup();
  const { result } = renderHook(() => useOwnAliases(), { wrapper });
  let first: string | undefined = 'unset';
  act(() => { first = result.current('stores', 'countries'); });
  expect(first).toBeUndefined();
  await waitFor(() => expect(result.current('stores', 'countries')).toBe('Store Country'));
  expect(reads.filter((id) => id === 'stores')).toHaveLength(1);
});

test('a failed read is not asked again when another mart lands', async () => {
  const { reads, wrapper } = setup();
  const { result } = renderHook(() => useOwnAliases(), { wrapper });
  act(() => { result.current('broken', 'x'); result.current('stores', 'countries'); });
  await waitFor(() => expect(result.current('stores', 'countries')).toBe('Store Country'));
  act(() => { result.current('broken', 'x'); });
  expect(reads.filter((id) => id === 'broken')).toHaveLength(1);
});
