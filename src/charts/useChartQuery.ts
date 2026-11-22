import { useCallback, useEffect, useMemo, useState } from 'react';
import { readRows } from '../api/rows';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { useServices } from '../state/store';
import { answers, partsOf, stable, type JoinGrain, type QueryParts } from './answers';

export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; retry: () => void };

/** How many resolved reads a ctx keeps: about ten views of the charts. The least recently used is dropped first. */
export const CHART_CACHE_LIMIT = 64;
// Resolved rows only, per ctx: a failed or aborted read is never stored, so retry always reads again.
// The options and the mart stay with the rows, so a later query for a subset of them can be answered without a read.
type Entry = { rows: Row[]; martId: string; version: number; parts: QueryParts };
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

/** The cached read that answers this query: the exact one, else, when `joins` is given, one for a superset of it (see `answers`). Returns its key and rows. */
function lookup(ctx: Ctx, key: string, martId: string, version: number, asked: QueryParts | null, joins: JoinGrain | undefined): { key: string; rows: Row[] } | null {
  const cache = cacheOf(ctx);
  const exact = cache.get(key);
  if (exact) return { key, rows: exact.rows };
  if (!asked || !joins) return null;
  for (const [k, e] of cache) if (e.martId === martId && e.version === version && answers(e.parts, asked, joins)) return { key: k, rows: e.rows };
  return null;
}

/**
 * Runs one traversal for a chart. `null` options run nothing. `version` busts the cache (the mart was refreshed).
 * With `joins`, a cached read for a superset of this query answers it with no read (a card whose column was dropped keeps its value);
 * without it only an identical query is served from the cache.
 */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number, joins?: JoinGrain): ChartResult {
  const { ctx } = useServices();
  const [attempt, setAttempt] = useState(0);
  const key = options ? `${martId}:${version}:${stable(options)}` : null;
  // The ask's parts are split once per key, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const asked = useMemo(() => (options ? partsOf(options) : null), [key]);
  const [state, setState] = useState<{ key: string | null; rows: Row[] | null; error: unknown }>({ key: null, rows: null, error: null });

  useEffect(() => {
    if (!options || !key) return;
    const cache = cacheOf(ctx);
    const cached = lookup(ctx, key, martId, version, asked, joins);
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
        (rows) => { if (inflight.get(key) === made) inflight.delete(key); if (!controller.signal.aborted) remember(ctx, key, { rows, martId, version, parts: asked! }); },
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
  const rows = current ? state.rows : lookup(ctx, key, martId, version, asked, joins)?.rows ?? null;
  const error = current ? state.error : null;
  return { rows, error, loading: !rows && !error, retry };
}
