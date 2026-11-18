import { useEffect, useState } from 'react';
import type { JoinedSource } from '../api/blendable';
import { useServices, useStore } from '../state/store';

/**
 * The data marts a mart can join, read when it becomes the main mart (once per mart per session, from the blendable schema;
 * nothing is billed). Null until known; a failed read counts as nothing to join, and is asked again the next time.
 */
export function useJoinSources(martId: string | null): JoinedSource[] | null {
  const { blendable } = useServices();
  const [{ modelVersion }] = useStore();
  // The grid's Refresh forgets a mart's joined sources: this copy is read again on the same signal.
  const [forgotten, setForgotten] = useState(0);
  useEffect(() => blendable.subscribe(() => setForgotten((n) => n + 1)), [blendable]);
  const [read, setRead] = useState<{ id: string; version: number; sources: JoinedSource[] } | null>(null);
  useEffect(() => {
    if (!martId) return;
    let live = true;
    blendable.get(martId).then(
      (sources) => { if (live) setRead({ id: martId, version: modelVersion, sources }); },
      () => { if (live) setRead({ id: martId, version: modelVersion, sources: [] }); },
    );
    return () => { live = false; };
  }, [blendable, martId, modelVersion, forgotten]);
  if (!martId) return null;
  if (read?.id === martId) return read.sources;
  return blendable.peek(martId) ?? null;
}
