import { useCallback, useEffect, useState } from 'react';
import { readRows } from '../api/rows';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { useServices } from '../state/store';
import { answersQuery, stable } from './answers';

export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; retry: () => void };

/** How many resolved reads a ctx keeps: about ten views of the charts. The least recently used is dropped first. */
export const CHART_CACHE_LIMIT = 64;
// Resolved rows only, per ctx: a failed or aborted read is never stored, so retry always reads again.
// The options and the mart stay with the rows, so a later query for a subset of them can be answered without a read.
type Entry = { rows: Row[]; martId: string; version: number; options: TraverseOptions };
const cacheOf = perCtx(() => new Map<string, Entry>());

function remember(ctx: Ctx, key: string, entry: Entry) {
  const cache = cacheOf(ctx);
  cache.set(key, entry);
  // A Map keeps insertion order and a hit re-inserts its key, so the first key is the least recently used.
  if (cache.size > CHART_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

// A read under way, shared by every hook that asks for the same key while it runs: each traverseData call is billed, so
// a pie and a stack asking for the same thing at once must cost one read. Dropped when it settles or its last reader leaves.
type Flight = { promise: Promise<Row[]>; readers: number; controller: AbortController };
const flightsOf = perCtx(() => new Map<string, Flight>());

/** The cached read that answers this query: the exact one, else one for a superset of it (see `answersQuery`). Returns its key and rows. */
function lookup(ctx: Ctx, key: string, martId: string, version: number, options: TraverseOptions): { key: string; rows: Row[] } | null {
  const cache = cacheOf(ctx);
  const exact = cache.get(key);
  if (exact) return { key, rows: exact.rows };
  for (const [k, e] of cache) if (e.martId === martId && e.version === version && answersQuery(e.options, options)) return { key: k, rows: e.rows };
  return null;
}

/** Runs one traversal for a chart. `null` options run nothing. `version` busts the cache (the mart was refreshed). */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number): ChartResult {
  const { ctx } = useServices();
  const [attempt, setAttempt] = useState(0);
  const key = options ? `${martId}:${version}:${stable(options)}` : null;
  const [state, setState] = useState<{ key: string | null; rows: Row[] | null; error: unknown }>({ key: null, rows: null, error: null });

  useEffect(() => {
    if (!options || !key) return;
    const cache = cacheOf(ctx);
    const cached = lookup(ctx, key, martId, version, options);
    if (cached) {
      // Keep the rows in state too, so a later eviction cannot strand this reader; re-insert the key so it counts as recently used.
      const entry = cache.get(cached.key)!;
      cache.delete(cached.key);
      cache.set(cached.key, entry);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a hit has no promise to answer through
      setState({ key, rows: cached.rows, error: null });
      return;
    }
    const inflight = flightsOf(ctx);
    let flight = inflight.get(key);
    if (!flight) {
      const controller = new AbortController();
      const promise = readRows(ctx, martId, options, { signal: controller.signal });
      const made: Flight = (flight = { promise, readers: 0, controller });
      promise.then(
        (rows) => { if (inflight.get(key) === made) inflight.delete(key); if (!controller.signal.aborted) remember(ctx, key, { rows, martId, version, options }); },
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
  // A cached read for a superset answers on this very render, so the cards show their values with no skeleton.
  const rows = current ? state.rows : lookup(ctx, key, martId, version, options!)?.rows ?? null;
  const error = current ? state.error : null;
  return { rows, error, loading: !rows && !error, retry };
}
