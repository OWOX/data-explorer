import { useEffect, useState } from 'react';
import type { JoinedSource } from '../api/blendable';
import { useServices, useStore } from '../state/store';

/**
 * The data marts a mart can join, read when it becomes the main mart (once per mart per session, from the blendable schema;
 * nothing is billed). `sources` is null until known; a failed read leaves `sources` empty and sets `failed`, so the caller can tell
 * "could not read" from "joins nothing". A failed read is asked again the next time.
 */
export function useJoinSources(martId: string | null): { sources: JoinedSource[] | null; failed: boolean } {
  const { blendable } = useServices();
  const [{ modelVersion }] = useStore();
  // The grid's Refresh forgets a mart's joined sources: this copy is read again on the same signal.
  const [forgotten, setForgotten] = useState(0);
  useEffect(() => blendable.subscribe(() => setForgotten((n) => n + 1)), [blendable]);
  const [read, setRead] = useState<{ id: string; version: number; sources: JoinedSource[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!martId) return;
    let live = true;
    blendable.get(martId).then(
      (sources) => { if (live) setRead({ id: martId, version: modelVersion, sources, failed: false }); },
      () => { if (live) setRead({ id: martId, version: modelVersion, sources: [], failed: true }); },
    );
    return () => { live = false; };
  }, [blendable, martId, modelVersion, forgotten]);
  if (!martId) return { sources: null, failed: false };
  if (read?.id === martId) return { sources: read.sources, failed: read.failed };
  return { sources: blendable.peek(martId) ?? null, failed: false };
}
