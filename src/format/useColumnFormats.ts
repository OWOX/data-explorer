import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Schema } from '../model/types';
import { useServices } from '../state/store';
import { pickFormats } from './ai-pick';
import { AUTO, isValidFormat, resolveFormat, type Format } from './formats';
import { formatStore, type Formats } from './store';

const NONE: Formats = { member: {}, project: {} };

/** A mart's column formats: the member's choice, else the project's pick, else `auto`. */
export function useColumnFormats(martId: string, schema: Schema = [], martTitle = martId): { formatOf(column: string, type: string): Format; setMember(column: string, f: Format | null): void } {
  const { ctx } = useServices();
  const store = useMemo(() => formatStore(ctx), [ctx]);
  // The AI pick reads the schema and title as they are when the formats have loaded.
  const asking = useRef({ schema, martTitle });
  asking.current = { schema, martTitle };
  const [loaded, setLoaded] = useState<{ martId: string; formats: Formats }>({ martId, formats: NONE });
  useEffect(() => {
    const ctl = new AbortController();
    store.load(martId).then(async (formats) => {
      if (ctl.signal.aborted) return;
      setLoaded((cur) => ({ martId, formats: cur.martId === martId ? { member: { ...formats.member, ...cur.formats.member }, project: formats.project } : formats }));
      const picks = await pickFormats(ctx, store, martId, asking.current.martTitle, asking.current.schema, formats.project, ctl.signal);
      if (ctl.signal.aborted || !Object.keys(picks).length) return;
      setLoaded((cur) => (cur.martId === martId ? { martId, formats: { member: cur.formats.member, project: { ...picks, ...cur.formats.project } } } : cur));
    });
    return () => ctl.abort();
  }, [ctx, store, martId]);
  const formats = loaded.martId === martId ? loaded.formats : NONE;
  const formatOf = useCallback((column: string, type: string): Format => {
    const f = resolveFormat(formats.member[column], formats.project[column]);
    return isValidFormat(f, type) ? f : AUTO;
  }, [formats]);
  const setMember = useCallback((column: string, f: Format | null) => {
    setLoaded((cur) => {
      const member = { ...(cur.martId === martId ? cur.formats.member : {}) };
      if (f) member[column] = f; else delete member[column];
      return { martId, formats: { member, project: cur.martId === martId ? cur.formats.project : {} } };
    });
    void store.setMember(martId, column, f);
  }, [store, martId]);
  return { formatOf, setMember };
}
