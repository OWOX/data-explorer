import { useCallback, useEffect, useState } from 'react';
import { readRows } from '../api/rows';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { useServices } from '../state/store';

export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; retry: () => void };

// Resolved rows only, per ctx: a failed or aborted read is never stored, so retry always reads again.
const caches = new WeakMap<Ctx, Map<string, Row[]>>();
const cacheOf = (ctx: Ctx) => {
  let c = caches.get(ctx);
  if (!c) caches.set(ctx, (c = new Map()));
  return c;
};

// A read under way, shared by every hook that asks for the same key while it runs: each traverseData call is billed, so
// a pie and a stack asking for the same thing at once must cost one read. Dropped when it settles or its last reader leaves.
type Flight = { promise: Promise<Row[]>; readers: number; controller: AbortController };
const flights = new WeakMap<Ctx, Map<string, Flight>>();
const flightsOf = (ctx: Ctx) => {
  let f = flights.get(ctx);
  if (!f) flights.set(ctx, (f = new Map()));
  return f;
};

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
    const cached = cacheOf(ctx).get(key);
    if (cached) return; // the render below reads it straight from the cache
    const inflight = flightsOf(ctx);
    let flight = inflight.get(key);
    if (!flight) {
      const controller = new AbortController();
      const promise = readRows(ctx, martId, options, { signal: controller.signal });
      const made: Flight = (flight = { promise, readers: 0, controller });
      promise.then(
        (rows) => { if (inflight.get(key) === made) inflight.delete(key); if (!controller.signal.aborted) cacheOf(ctx).set(key, rows); },
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
