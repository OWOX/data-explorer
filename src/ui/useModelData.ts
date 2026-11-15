import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDqSummaries } from '../api/data-quality';
import { loadModel } from '../api/model';
import { COUNT_CONCURRENCY } from '../config';
import type { DqSummary, Model } from '../model/types';
import { useServices, useStore } from '../state/store';
import type { CountState } from './bands/cards';
import { errorMessage } from './ErrorBox';

export function useModel() {
  const { ctx, schemas } = useServices();
  const [{ modelVersion }] = useStore();
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [schemaTick, setSchemaTick] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => schemas.subscribe(() => setSchemaTick((t) => t + 1)), [schemas]);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    if (modelVersion > 0) schemas.clear();
    loadModel(ctx).then(
      (m) => { if (!live) return; setModel(m); void schemas.prefetch([...m.marts.keys()]); },
      (e) => { if (live) setError(e); },
    );
    return () => { live = false; };
  }, [ctx, schemas, modelVersion, retry]);

  return { model, error, reload: () => setRetry((r) => r + 1), schemaTick };
}

export function useCardStatus(model: Model | null, visibleIds: string[], modelVersion: number) {
  const { ctx, schemas, counter } = useServices();
  const [dq, setDq] = useState(new Map<string, DqSummary>());
  const [counts, setCounts] = useState(new Map<string, CountState>());
  // Which refresh generation each card was last asked to count in. A refresh raises the generation:
  // cards already asked are recounted when the new model lands, the rest when they next come into view.
  const asked = useRef(new Map<string, number>());
  const generation = useRef(0);
  const appliedVersion = useRef(modelVersion);
  const lastModel = useRef(model);
  const queue = useRef<{ id: string; recount: boolean; seq: number }[]>([]);
  const active = useRef(0);
  // The newest request per card: an older count that finishes late must not overwrite a newer value.
  const seqs = useRef({ next: 0, latest: new Map<string, number>() });

  // A count turns to loading only here, when its request starts. Until then the old value stays.
  const runCount = useCallback((id: string, recount: boolean, seq: number): Promise<void> => {
    const current = () => seqs.current.latest.get(id) === seq;
    setCounts((c) => new Map(c).set(id, { state: 'loading' }));
    return schemas.get(id)
      .then((s) => (recount ? counter.recount(id, s) : counter.count(id, s)))
      .then(
        (value) => { if (current()) setCounts((c) => new Map(c).set(id, { state: 'ok', value })); },
        (e) => { if (current()) setCounts((c) => new Map(c).set(id, { state: 'error', message: errorMessage(e) })); },
      );
  }, [schemas, counter]);

  // One pool of COUNT_CONCURRENCY for every request, whenever it arrives.
  const pump = useCallback(() => {
    const drain = () => {
      while (active.current < COUNT_CONCURRENCY && queue.current.length) {
        const next = queue.current.shift()!;
        active.current++;
        void runCount(next.id, next.recount, next.seq).finally(() => { active.current--; drain(); });
      }
    };
    drain();
  }, [runCount]);

  // A card already waiting in the queue is upgraded in place, never queued twice.
  const enqueue = useCallback((id: string, recount: boolean) => {
    const seq = ++seqs.current.next;
    seqs.current.latest.set(id, seq);
    const waiting = queue.current.find((q) => q.id === id);
    if (waiting) { waiting.recount ||= recount; waiting.seq = seq; } else queue.current.push({ id, recount, seq });
    pump();
  }, [pump]);

  const request = useCallback((id: string) => {
    const before = asked.current.get(id);
    if (before === generation.current) return;
    asked.current.set(id, generation.current);
    // Only a card counted in an earlier generation is recounted; a first request may use the cache.
    enqueue(id, before !== undefined);
  }, [enqueue]);

  const key = visibleIds.join('|');
  useEffect(() => {
    if (!model) return;
    // A new model after a refresh: reload what is on screen. A failed reload never gets here, so
    // the previous counts and quality stay exactly as they were.
    const refreshed = appliedVersion.current !== modelVersion && model !== lastModel.current;
    lastModel.current = model;
    if (refreshed) {
      appliedVersion.current = modelVersion;
      generation.current++;
    }
    const ids = visibleIds.filter((id) => model.marts.get(id)?.accessible);
    const missingDq = ids.filter((id) => refreshed || !dq.has(id));
    if (missingDq.length) loadDqSummaries(ctx, missingDq).then((m) => setDq((d) => new Map([...d, ...m]))).catch(() => undefined);
    if (refreshed) ids.filter((id) => asked.current.has(id)).forEach(request);
    // dq is read, not tracked: this runs when the model or the visible set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, key]);

  const shown = new Map<string, CountState>(visibleIds.map((id) => [id, counts.get(id) ?? { state: 'idle' }]));

  return { dq, counts: shown, request, recount: (id: string) => enqueue(id, true) };
}
