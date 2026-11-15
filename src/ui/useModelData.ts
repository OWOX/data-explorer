import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDqSummaries } from '../api/data-quality';
import { loadModel } from '../api/model';
import { runPool } from '../api/pool';
import { COUNT_CONCURRENCY, VISIBLE_BUDGET } from '../config';
import type { DqSummary, Model } from '../model/types';
import { useServices, useStore } from '../state/store';
import type { CardData } from './canvas/MartCard';
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
  const [counts, setCounts] = useState(new Map<string, CardData['count']>());
  const fresh = useRef(false);
  const seenVersion = useRef(modelVersion);

  const runCount = useCallback((id: string, recount: boolean): Promise<void> => {
    setCounts((c) => new Map(c).set(id, { state: 'loading' }));
    return schemas.get(id)
      .then((s) => (recount ? counter.recount(id, s) : counter.count(id, s)))
      .then(
        (value) => setCounts((c) => new Map(c).set(id, { state: 'ok', value })),
        (e) => setCounts((c) => new Map(c).set(id, { state: 'error', message: errorMessage(e) })),
      );
  }, [schemas, counter]);

  useEffect(() => {
    if (seenVersion.current === modelVersion) return;
    seenVersion.current = modelVersion;
    fresh.current = true;
    // a model refresh drops the cached status so the visible cards reload
    setDq(new Map());
    setCounts(new Map());
  }, [modelVersion]);

  const key = visibleIds.join('|');
  useEffect(() => {
    if (!model) return;
    const ids = visibleIds.filter((id) => model.marts.get(id)?.accessible);
    const recount = fresh.current;
    fresh.current = false;
    const missingDq = ids.filter((id) => recount || !dq.has(id));
    if (missingDq.length) loadDqSummaries(ctx, missingDq).then((m) => setDq((d) => new Map([...d, ...m]))).catch(() => undefined);
    // Only the first VISIBLE_BUDGET cards are counted, a few requests at a time.
    const toCount = ids.slice(0, VISIBLE_BUDGET).filter((id) => recount || !counts.has(id));
    setCounts((c) => { const n = new Map(c); toCount.forEach((id) => n.set(id, { state: 'loading' })); return n; });
    void runPool(toCount, COUNT_CONCURRENCY, (id) => runCount(id, recount));
    // dq and counts are read, not tracked: this runs when the model or the visible set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, key]);

  // Cards past the cap are never counted: they show no badge.
  const counted = new Set(visibleIds.filter((id) => model?.marts.get(id)?.accessible).slice(0, VISIBLE_BUDGET));
  const shown = new Map<string, CardData['count']>(visibleIds.map((id) => [id, counted.has(id) ? counts.get(id) ?? { state: 'loading' } : { state: 'ok', value: null }]));

  return { dq, counts: shown, recount: (id: string) => runCount(id, true) };
}
