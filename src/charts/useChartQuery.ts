import { useCallback, useEffect, useState } from 'react';
import { readRows } from '../api/rows';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { useServices } from '../state/store';

export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; retry: () => void };

/** How many resolved reads a ctx keeps: about ten views of the charts. The least recently used is dropped first. */
export const CHART_CACHE_LIMIT = 64;
// Resolved rows only, per ctx: a failed or aborted read is never stored, so retry always reads again.
const cacheOf = perCtx(() => new Map<string, Row[]>());

function remember(ctx: Ctx, key: string, rows: Row[]) {
  const cache = cacheOf(ctx);
  cache.set(key, rows);
  // A Map keeps insertion order and a hit re-inserts its key, so the first key is the least recently used.
  if (cache.size > CHART_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

// A read under way, shared by every hook that asks for the same key while it runs: each traverseData call is billed, so
// a pie and a stack asking for the same thing at once must cost one read. Dropped when it settles or its last reader leaves.
type Flight = { promise: Promise<Row[]>; readers: number; controller: AbortController };
const flightsOf = perCtx(() => new Map<string, Flight>());

// Key-sorted, so two builders that set the same options in another property order share one read. Arrays keep their order.
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));

/** Runs one traversal for a chart. `null` options run nothing. `version` busts the cache (the mart was refreshed). */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number): ChartResult {
  const { ctx } = useServices();
  const [attempt, setAttempt] = useState(0);
  const key = options ? `${martId}:${version}:${stable(options)}` : null;
  const [state, setState] = useState<{ key: string | null; rows: Row[] | null; error: unknown }>({ key: null, rows: null, error: null });

  useEffect(() => {
    if (!options || !key) return;
    const cache = cacheOf(ctx);
    const cached = cache.get(key);
    if (cached) {
      // Keep the rows in state too, so a later eviction cannot strand this reader; re-insert the key so it counts as recently used.
      cache.delete(key);
      cache.set(key, cached);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a hit has no promise to answer through
      setState({ key, rows: cached, error: null });
      return;
    }
    const inflight = flightsOf(ctx);
    let flight = inflight.get(key);
    if (!flight) {
      const controller = new AbortController();
      const promise = readRows(ctx, martId, options, { signal: controller.signal });
      const made: Flight = (flight = { promise, readers: 0, controller });
      promise.then(
        (rows) => { if (inflight.get(key) === made) inflight.delete(key); if (!controller.signal.aborted) remember(ctx, key, rows); },
        () => { if (inflight.get(key) === made) inflight.delete(key); },
      );
      inflight.set(key, made);
    }
    const mine = flight;
    mine.readers += 1;
    let gone = false;
    mine.promise.then(
      (rows) => { if (!gone) setState({ key, rows, error: null }); },
      // A rejection with no reason must still end the loading state.
      (error) => { if (!gone) setState({ key, rows: null, error: error || new Error('Query failed') }); },
    );
    return () => {
      gone = true;
      mine.readers -= 1;
      if (mine.readers === 0) {
        mine.controller.abort();
        if (inflight.get(key) === mine) inflight.delete(key);
      }
    };
    // `key` stands for martId, version and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key, attempt]);

  const retry = useCallback(() => {
    setState({ key: null, rows: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  // State from an earlier key is stale: show nothing until this key's effect has answered.
  if (!key) return { rows: null, error: null, loading: false, retry };
  const current = state.key === key;
  const cached = cacheOf(ctx).get(key);
  const rows = current ? state.rows : cached ?? null;
  const error = current ? state.error : null;
  return { rows, error, loading: !rows && !error, retry };
}
