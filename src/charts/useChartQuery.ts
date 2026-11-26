import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readRows } from '../api/rows';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { useServices } from '../state/store';
import { useLatest } from '../ui/useLatest';
import { answers, partsOf, stable, type JoinGrain, type QueryParts } from './answers';

export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; /** This key's read was not started because of `hold`: `loading` is then true until the hold ends. */ held: boolean; retry: () => void };

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
// It keeps its key, mart, version and parts, so a read that asks for less can join it (see `joinable`).
type Flight = { key: string; promise: Promise<Row[]>; readers: number; controller: AbortController; martId: string; version: number; parts: QueryParts };
const flightsOf = perCtx(() => new Map<string, Flight>());

/** The cached read that answers this query: the exact one, else, when `joins` is given, one for a superset of it (see `answers`). Returns its key and rows. */
function lookup(ctx: Ctx, key: string, martId: string, version: number, asked: QueryParts | null, joins: JoinGrain | undefined, reuse: QueryParts | null = null): { key: string; rows: Row[] } | null {
  const cache = cacheOf(ctx);
  const exact = cache.get(key);
  if (exact) return { key, rows: exact.rows };
  if (!joins) return null;
  // `reuse` is a smaller ask the caller can do with: a cached read that answers it spares the read of the full query.
  for (const want of [asked, reuse]) {
    if (!want) continue;
    for (const [k, e] of cache) if (e.martId === martId && e.version === version && answers(e.parts, want, joins)) return { key: k, rows: e.rows };
  }
  return null;
}

/** The read under way that answers this query: the exact one, else, when `joins` is given, one for a superset of it (or of `reuse`). It sends nothing new. */
function joinable(ctx: Ctx, key: string, martId: string, version: number, asked: QueryParts | null, joins: JoinGrain | undefined, reuse: QueryParts | null): Flight | null {
  const inflight = flightsOf(ctx);
  const exact = inflight.get(key);
  if (exact || !joins) return exact ?? null;
  for (const want of [asked, reuse]) {
    if (!want) continue;
    for (const f of inflight.values()) if (f.martId === martId && f.version === version && answers(f.parts, want, joins)) return f;
  }
  return null;
}

/**
 * Runs one traversal for a chart. `null` options run nothing. `version` busts the cache (the mart was refreshed).
 * With `joins`, a cached read for a superset of this query answers it with no read (a card whose column was dropped keeps its value);
 * without it only an identical query is served from the cache.
 * `reuse` (with `joins`) is a smaller ask that is enough: when no read answers `options` but one answers `reuse`, its rows are served and nothing is sent.
 * `hold` keeps a read that is not under way from starting (a cache hit or a flight is still used); it starts when the hold ends, if the key is still the same.
 */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number, joins?: JoinGrain, reuse?: TraverseOptions | null, hold = false): ChartResult {
  const { ctx } = useServices();
  const [attempt, setAttempt] = useState(0);
  const held = useLatest(hold);
  // The key whose read was held back, so the end of the hold can start it.
  const skipped = useRef<string | null>(null);
  const key = options ? `${martId}:${version}:${stable(options)}` : null;
  // The ask's parts are split once per key, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const asked = useMemo(() => (options ? partsOf(options) : null), [key]);
  const reuseKey = reuse ? stable(reuse) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reused = useMemo(() => (reuse ? partsOf(reuse) : null), [reuseKey]);
  const [state, setState] = useState<{ key: string | null; rows: Row[] | null; error: unknown }>({ key: null, rows: null, error: null });

  useEffect(() => {
    // A key held earlier is no longer waiting: this run decides for the key it has now.
    skipped.current = null;
    if (!options || !key) return;
    const cache = cacheOf(ctx);
    const cached = lookup(ctx, key, martId, version, asked, joins, reused);
    if (cached) {
      // Keep the rows in state too, so a later eviction cannot strand this reader; re-insert the key so it counts as recently used.
      const entry = cache.get(cached.key)!;
      cache.delete(cached.key);
      cache.set(cached.key, entry);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the rows are in the render too; state keeps them if the cache drops them
      setState({ key, rows: cached.rows, error: null });
      return;
    }
    const inflight = flightsOf(ctx);
    let flight = joinable(ctx, key, martId, version, asked, joins, reused) ?? undefined;
    if (!flight && held.current) { skipped.current = key; return; }
    if (!flight) {
      const controller = new AbortController();
      const promise = readRows(ctx, martId, options, { signal: controller.signal });
      const made: Flight = (flight = { key, promise, readers: 0, controller, martId, version, parts: asked! });
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
        if (inflight.get(mine.key) === mine) inflight.delete(mine.key);
      }
    };
    // `key` stands for martId, version and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key, attempt]);

  useEffect(() => {
    if (hold || !key || skipped.current !== key) return;
    skipped.current = null;
    setAttempt((n) => n + 1);
  }, [hold, key]);

  const retry = useCallback(() => {
    setState({ key: null, rows: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  // State from an earlier key is stale: show nothing until this key's effect has answered.
  if (!key) return { rows: null, error: null, loading: false, held: false, retry };
  const current = state.key === key;
  // A cached read for a superset answers on this very render, so the cards show their values with no skeleton.
  const rows = current ? state.rows : lookup(ctx, key, martId, version, asked, joins, reused)?.rows ?? null;
  const error = current ? state.error : null;
  // The effect skips a read for exactly this: held, no rows (a cache hit gives rows), not answered yet, and no read under way to join.
  const waitingOnHold = hold && !rows && !current && !joinable(ctx, key, martId, version, asked, joins, reused);
  return { rows, error, loading: !rows && !error, held: waitingOnHold, retry };
}
