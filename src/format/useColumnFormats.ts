import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Schema } from '../model/types';
import { useServices } from '../state/store';
import { pickFormats } from './ai-pick';
import { AUTO, isValidFormat, resolveFormat, type Format } from './formats';
import { formatStore, type Formats } from './store';

const NONE: Formats = { member: {}, project: {} };
const NO_SCHEMA: Schema = [];
/** The AI pick waits this long after the formats load or the schema changes, so a join that adds columns costs one call. */
export const PICK_SETTLE_MS = 250;

/** A mart's column formats: the member's choice, else the project's pick, else `auto`. */
export function useColumnFormats(martId: string, schema: Schema = NO_SCHEMA, martTitle = martId): { formatOf(column: string, type: string): Format; setMember(column: string, f: Format | null): void } {
  const { ctx } = useServices();
  const store = useMemo(() => formatStore(ctx), [ctx]);
  const [loaded, setLoaded] = useState<{ martId: string; formats: Formats }>({ martId, formats: NONE });
  // The mart whose stored formats have been read: the AI pick starts only then.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  // Columns whose member choice was removed here: a stored choice that is still on its way must not bring them back.
  const removed = useRef(new Map<string, Set<string>>());
  const project = useRef<Formats['project']>({});
  useEffect(() => {
    let live = true;
    store.load(martId).then((formats) => {
      if (!live) return;
      const gone = removed.current.get(martId);
      const stored = Object.fromEntries(Object.entries(formats.member).filter(([c]) => !gone?.has(c)));
      setLoaded((cur) => ({ martId, formats: cur.martId === martId ? { member: { ...stored, ...cur.formats.member }, project: formats.project } : { ...formats, member: stored } }));
      project.current = formats.project;
      setReadyFor(martId);
    });
    return () => { live = false; };
  }, [store, martId]);
  const ready = readyFor === martId;
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      void pickFormats(ctx, store, martId, martTitle, schema, project.current, ctl.signal).then((picks) => {
        if (ctl.signal.aborted || !Object.keys(picks).length) return;
        project.current = { ...picks, ...project.current };
        setLoaded((cur) => (cur.martId === martId ? { martId, formats: { member: cur.formats.member, project: { ...picks, ...cur.formats.project } } } : cur));
      });
    }, PICK_SETTLE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [ready, ctx, store, martId, martTitle, schema]);
  const formats = loaded.martId === martId ? loaded.formats : NONE;
  const formatOf = useCallback((column: string, type: string): Format => {
    const f = resolveFormat(formats.member[column], formats.project[column]);
    return isValidFormat(f, type) ? f : AUTO;
  }, [formats]);
  const setMember = useCallback((column: string, f: Format | null) => {
    const gone = removed.current.get(martId) ?? new Set<string>();
    if (f) gone.delete(column); else gone.add(column);
    removed.current.set(martId, gone);
    setLoaded((cur) => {
      const member = { ...(cur.martId === martId ? cur.formats.member : {}) };
      if (f) member[column] = f; else delete member[column];
      return { martId, formats: { member, project: cur.martId === martId ? cur.formats.project : {} } };
    });
    void store.setMember(martId, column, f);
  }, [store, martId]);
  return { formatOf, setMember };
}
