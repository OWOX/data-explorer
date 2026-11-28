import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cachedFiltered, countFiltered, filteredKey, forgetFiltered, martOfKey, rememberFiltered } from '../api/filtered-counts';
import { COUNT_CONCURRENCY } from '../config';
import { hasPrimaryKey } from '../records/relationships';
import type { GridRules } from '../filters/card-rules';
import type { Model } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { useServices } from '../state/store';
import type { CountState } from './bands/cards';
import { errorMessage } from './ErrorBox';

type Wanted = { key: string; martId: string; rules: TraverseFilter[]; partial: boolean; /** The grid's own read will answer this path: no read here. */ awaitGrid: boolean };
const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** What the reads last said about a path: for `key`, plus the last value it showed, kept dimmed while a new key is read. */
type Status = { key: string; state: CountState; last: number | null | undefined; lastUnique?: boolean };

export type FilteredCount = { /** Absent for a card with no rule that could be counted. */ state?: CountState; partial: boolean };

/** The filtered count of each card that has rules, read once per rule set and `COUNT_CONCURRENCY` at a time. */
export function useFilteredCounts(model: Model | null, byPath: ReadonlyMap<string, GridRules> | null) {
  const { ctx, schemas } = useServices();
  const [status, setStatus] = useState(new Map<string, Status>());
  const [tick, setTick] = useState(0);
  const requested = useRef(new Map<string, string>());
  const queue = useRef<(Wanted & { path: string })[]>([]);
  const active = useRef(0);
  // The newest job queued per path: the result of an older one is dropped.
  const latest = useRef(new Map<string, object>());
  // The local day, moved on at midnight so a relative date rule gets a new key.
  const [day, setDay] = useState(() => localDay(new Date()));
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const timer = setTimeout(() => setDay(localDay(new Date())), Math.max(midnight - now.getTime(), 1) + 50);
    return () => clearTimeout(timer);
  }, [day]);

  const wanted = useMemo(() => {
    const out = new Map<string, Wanted>();
    if (!model || !byPath) return out;
    for (const [path, c] of byPath) {
      // A card with a rule that cannot be counted shows its unfiltered count: a number filtered by only some of its rules would be wrong.
      if (c.partial) { out.set(path, { key: '', martId: c.martId, rules: [], partial: true, awaitGrid: false }); continue; }
      const key = c.rules.length > 0 ? filteredKey(c.martId, c.rules, model.marts.get(c.martId)?.dataLastUpdatedAt ?? null, new Date(`${day}T12:00:00`)) : '';
      out.set(path, { key, martId: c.martId, rules: c.rules, partial: c.partial, awaitGrid: !!c.awaitGrid });
    }
    return out;
  }, [model, byPath, day]);
  // A Refresh that the grid answers: the grid's next `byPath` carries `awaitGrid`, but this render's `wanted` does not yet.
  const waiting = useRef<{ wanted: ReadonlyMap<string, Wanted>; paths: Set<string> } | null>(null);
  const wantedRef = useRef(wanted);
  useEffect(() => { wantedRef.current = wanted; }, [wanted]);

  const pump = useCallback(function run() {
    while (active.current < COUNT_CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!;
      if (cachedFiltered(ctx, job.key) !== undefined) continue;
      const current = () => wantedRef.current.get(job.path)?.key === job.key && latest.current.get(job.path) === job;
      const put = (state: CountState) => { if (current()) setStatus((s) => {
        const was = s.get(job.path);
        const last = state.state === 'ok' ? state.value : was?.state.state === 'ok' ? was.state.value : was?.last;
        const lastUnique = state.state === 'ok' ? state.unique : was?.state.state === 'ok' ? was.state.unique : was?.lastUnique;
        return new Map(s).set(job.path, { key: job.key, state, last, lastUnique });
      }); };
      active.current++;
      put({ state: 'loading' });
      schemas.get(job.martId)
        .then((schema) => countFiltered(ctx, job.key, job.martId, schema, job.rules))
        .then(({ value, unique }) => put({ state: 'ok', value, unique }), (e) => put({ state: 'error', message: errorMessage(e) }))
        .finally(() => { active.current--; run(); });
    }
  }, [ctx, schemas]);

  useEffect(() => {
    queue.current = queue.current.filter((j) => wanted.get(j.path)?.key === j.key);
    // A read asked for under a key the path no longer wants (gone, partial, or cached under a new key) must not block asking again for that key later.
    for (const [path, k] of [...requested.current]) if (wanted.get(path)?.key !== k) requested.current.delete(path);
    for (const [path, w] of wanted) {
      if (w.rules.length === 0) continue;
      if (w.awaitGrid || (waiting.current?.wanted === wanted && waiting.current.paths.has(path))) {
        requested.current.delete(path);
        queue.current = queue.current.filter((j) => j.path !== path);
        continue;
      }
      if (requested.current.get(path) === w.key || cachedFiltered(ctx, w.key) !== undefined) continue;
      requested.current.set(path, w.key);
      queue.current = queue.current.filter((j) => j.path !== path);
      const job = { ...w, path };
      latest.current.set(path, job);
      queue.current.push(job);
    }
    pump();
  }, [ctx, wanted, tick, pump]);

  const retry = useCallback((path: string) => {
    requested.current.delete(path);
    setStatus((s) => { const was = s.get(path); return was ? new Map(s).set(path, { ...was, state: { state: 'queued' } }) : s; });
    setTick((t) => t + 1);
  }, []);

  const forget = useCallback((martId: string, awaitMain = false) => {
    forgetFiltered(ctx, martId);
    waiting.current = awaitMain ? { wanted: wantedRef.current, paths: new Set(['']) } : null;
    for (const [path, w] of wantedRef.current) {
      if (w.martId !== martId || w.rules.length === 0) continue;
      requested.current.delete(path);
      setStatus((s) => { const was = s.get(path); return was ? new Map(s).set(path, { ...was, state: { state: 'queued' } }) : s; });
    }
    setTick((t) => t + 1);
  }, [ctx]);

  const seed = useCallback((key: string, n: number) => {
    // The grid's total counts the main mart's rows, taken as its unique records when it has a key (the keys are unique), so the label matches the card's other reads.
    rememberFiltered(ctx, key, n, hasPrimaryKey(schemas.peek(martOfKey(key)) ?? []));
    setTick((t) => t + 1);
  }, [ctx, schemas]);

  const filtered = useMemo(() => {
    void tick; // a seed changes the cache, not the inputs
    const out = new Map<string, FilteredCount>();
    for (const [path, w] of wanted) {
      if (w.rules.length === 0) { if (w.partial) out.set(path, { partial: true }); continue; }
      const hit = cachedFiltered(ctx, w.key);
      const was = status.get(path);
      let state: CountState;
      if (hit !== undefined) state = { state: 'ok', value: hit.n, unique: hit.unique };
      else if (was?.key === w.key && !((was.state.state === 'loading' || was.state.state === 'queued') && was.last !== undefined)) state = was.state;
      else if (was?.last !== undefined) state = { state: 'ok', value: was.last, stale: true, unique: was.lastUnique };
      else state = { state: 'queued' };
      out.set(path, { state, partial: w.partial });
    }
    return out;
  }, [ctx, wanted, status, tick]);

  return { filtered, retry, seed, forget };
}
