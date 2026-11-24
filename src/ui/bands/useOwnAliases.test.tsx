import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { expect, test } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider, useServices, useStore } from '../../state/store';
import { useOwnAliases } from './useOwnAliases';

/** A mock whose blendable schemas name every join of `stores` "Store Country", count each read, and fail for `broken`. */
function setup(failing = new Set(['broken'])) {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const reads: string[] = [];
  const getJson = ctx.owox.getJson.bind(ctx.owox) as (url: string, ...rest: unknown[]) => Promise<unknown>;
  (ctx.owox as { getJson: unknown }).getJson = async (url: string, ...rest: unknown[]) => {
    const m = /\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(url);
    if (m) reads.push(m[1]!);
    if (m && failing.has(m[1]!)) throw new Error('403');
    const dto = await getJson(url, ...rest);
    if (m?.[1] !== 'stores') return dto;
    const d = dto as { availableSources?: { aliasPath: string; defaultAlias?: string | null }[] };
    return { ...d, availableSources: d.availableSources?.map((s) => ({ ...s, defaultAlias: 'Store Country' })) };
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx as Ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  return { reads, wrapper, failing };
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

/** The hook as the bands use it: the lookup asked during render, and the loader cleared in an effect when the model is read again (`useModelData`). */
function useLine() {
  const { blendable } = useServices();
  const [{ modelVersion }, dispatch] = useStore();
  const [retry, setRetry] = useState(0);
  const own = useOwnAliases();
  const alias = useMemo(() => own('stores', 'countries'), [own]);
  useEffect(() => { if (modelVersion > 0) blendable.clear(); }, [blendable, modelVersion, retry]);
  return { alias, ask: () => own('stores', 'countries'), refresh: () => dispatch({ type: 'refreshModel' }), retry: () => setRetry((n) => n + 1) };
}

test('a mart whose read failed is read again after the model is refreshed', async () => {
  const { reads, wrapper, failing } = setup(new Set(['stores']));
  const { result } = renderHook(() => useLine(), { wrapper });
  await waitFor(() => expect(reads).toContain('stores'));
  failing.clear();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.alias).toBe('Store Country'));
});

test('an alias already read comes back after a refresh and after a retry of it', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useLine(), { wrapper });
  await waitFor(() => expect(result.current.alias).toBe('Store Country'));
  act(() => result.current.refresh());
  // Asked for and read again under the refreshed model: only then can a second clear of the same model version lose it.
  await waitFor(() => expect(result.current.ask()).toBe('Store Country'));
  act(() => result.current.retry());
  // The bands ask again when the model that the retry reads lands.
  await waitFor(() => expect(result.current.ask()).toBe('Store Country'));
});
