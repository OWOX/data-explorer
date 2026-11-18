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

/** Runs one traversal for a chart. `null` options run nothing. `version` busts the cache (the mart was refreshed). */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number): ChartResult {
  const { ctx } = useServices();
  const [attempt, setAttempt] = useState(0);
  const key = options ? `${martId}:${version}:${JSON.stringify(options)}` : null;
  const [state, setState] = useState<{ key: string | null; rows: Row[] | null; error: unknown }>({ key: null, rows: null, error: null });

  useEffect(() => {
    if (!options || !key) return;
    const cached = cacheOf(ctx).get(key);
    if (cached) return; // the render below reads it straight from the cache
    const ac = new AbortController();
    readRows(ctx, martId, options, { signal: ac.signal }).then(
      (rows) => {
        if (ac.signal.aborted) return;
        cacheOf(ctx).set(key, rows);
        setState({ key, rows, error: null });
      },
      (error) => {
        if (ac.signal.aborted) return;
        setState({ key, rows: null, error });
      },
    );
    return () => ac.abort();
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
