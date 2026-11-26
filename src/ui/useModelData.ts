import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadDqSummaries } from '../api/data-quality';
import { FIRST_STEPS, loadModel, type LoadProgress } from '../api/model';
import { COUNT_CONCURRENCY } from '../config';
import type { DqSummary, Model } from '../model/types';
import { useServices, useStore } from '../state/store';
import type { CountState } from './bands/cards';
import { errorMessage } from './ErrorBox';

export function useModel() {
  const { ctx, schemas, blendable } = useServices();
  const [{ modelVersion }] = useStore();
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  // The first load only: a reload keeps the model on screen, so it has no bar.
  const [progress, setProgress] = useState<LoadProgress>({ done: 0, total: FIRST_STEPS });

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    if (modelVersion > 0) { schemas.clear(); blendable.clear(); }
    loadModel(ctx, (p) => { if (live) setProgress(p); }).then(
      (m) => { if (live) { blendable.useKeys({ edges: m.edges, schemaOf: schemas.peek }); setModel(m); } },
      (e) => { if (live) setError(e); },
    );
    return () => { live = false; };
  }, [ctx, schemas, blendable, modelVersion, retry]);

  return { model, error, progress, reload: () => setRetry((r) => r + 1) };
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
  // The latest visible ids, read by the drain: a card that left the band is not worth a request.
  const visible = useRef(visibleIds);
  // The newest request per card: an older count that finishes late must not overwrite a newer value.
  const seqs = useRef({ next: 0, latest: new Map<string, number>() });

  // A first count turns to loading here. A recount keeps its previous value, dimmed from the moment it is queued.
  const runCount = useCallback((id: string, recount: boolean, seq: number): Promise<void> => {
    const current = () => seqs.current.latest.get(id) === seq;
    // A recount keeps the card's previous count on screen, dimmed; a first count has none to show.
    setCounts((c) => { const was = c.get(id); return new Map(c).set(id, recount && was?.state === 'ok' && was.value !== null ? { ...was, stale: true } : { state: 'loading' }); });
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
      // Requests for cards no longer shown are dropped, so they cannot hold up the cards that are.
      const gone = queue.current.filter((q) => !visible.current.includes(q.id));
      if (gone.length) {
        queue.current = queue.current.filter((q) => visible.current.includes(q.id));
        const ids = new Set(gone.map((q) => q.id));
        ids.forEach((id) => asked.current.delete(id));
        setCounts((c) => {
          const next = new Map(c);
          ids.forEach((id) => {
            const was = next.get(id);
            if (was?.state === 'queued') next.delete(id);
            // A recount that will not run: its old count is the shown one again, no longer dimmed.
            else if (was?.state === 'ok' && was.stale) next.set(id, { state: 'ok', value: was.value });
          });
          return next;
        });
      }
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
    // Only a card with no count yet shows the wait; a recount keeps its old value, dimmed from now (it may queue behind others), until the new one lands.
    setCounts((c) => {
      const was = c.get(id);
      if (!was) return new Map(c).set(id, { state: 'queued' });
      return recount && was.state === 'ok' && was.value !== null && !was.stale ? new Map(c).set(id, { ...was, stale: true }) : c;
    });
    pump();
  }, [pump]);

  const request = useCallback((id: string) => {
    const before = asked.current.get(id);
    if (before === generation.current) return;
    asked.current.set(id, generation.current);
    // Only a card counted in an earlier generation is recounted; a first request may use the cache.
    enqueue(id, before !== undefined);
  }, [enqueue]);

  // A count the grid already has for this card: no read is needed for it. A queued read is dropped, a running one is
  // ignored when it ends (it is billed anyway), and the card's own request on scroll-in will not read again this generation.
  const offer = useCallback((id: string, value: number) => {
    seqs.current.latest.set(id, ++seqs.current.next);
    queue.current = queue.current.filter((q) => q.id !== id);
    asked.current.set(id, generation.current);
    setCounts((c) => new Map(c).set(id, { state: 'ok', value }));
    void counter.store(id, value);
  }, [counter]);

  // The card keeps its count, dimmed, while the grid's Refresh reads the total that will replace it. No read.
  const hold = useCallback((id: string) => {
    setCounts((c) => { const was = c.get(id); return was?.state === 'ok' && was.value !== null && !was.stale ? new Map(c).set(id, { ...was, stale: true }) : c; });
  }, []);

  const key = visibleIds.join('|');
  // A layout effect, so a card that just mounted and asks from its own effect sees the new set.
  useLayoutEffect(() => { visible.current = visibleIds; });
  useEffect(() => {
    pump();
    // pump is stable; this runs when the visible set changes, so stale requests are pruned with no new one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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

  return { dq, counts: shown, request, offer, hold, recount: (id: string) => enqueue(id, true) };
}
