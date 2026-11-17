import { useCallback, useEffect, useMemo, useState } from 'react';
import { useServices } from '../state/store';
import { AUTO, isValidFormat, resolveFormat, type Format } from './formats';
import { formatStore, type Formats } from './store';

const NONE: Formats = { member: {}, project: {} };

/** A mart's column formats: the member's choice, else the project's pick, else `auto`. */
export function useColumnFormats(martId: string): { formatOf(column: string, type: string): Format; setMember(column: string, f: Format | null): void } {
  const { ctx } = useServices();
  const store = useMemo(() => formatStore(ctx), [ctx]);
  const [loaded, setLoaded] = useState<{ martId: string; formats: Formats }>({ martId, formats: NONE });
  useEffect(() => {
    let live = true;
    store.load(martId).then((formats) => live && setLoaded((cur) => ({ martId, formats: cur.martId === martId ? { member: { ...formats.member, ...cur.formats.member }, project: formats.project } : formats })));
    return () => { live = false; };
  }, [store, martId]);
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
