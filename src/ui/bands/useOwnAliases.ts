import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices, useStore } from '../../state/store';

/**
 * The Output Alias a mart's own join settings give a path below it. A mart joined deeper in the report keeps the names its owner gave its joins
 * ("Last Session") in its own settings, not in the main mart's, so a line under it reads them from there.
 * The lookup reads a mart the first time a line asks about it (once per mart until Refresh; a failed read is not asked again before then)
 * and returns undefined until the read lands, or when the path has no alias there. A landed read makes a new lookup, so memos that take it rebuild.
 */
export function useOwnAliases(): (martId: string, path: string) => string | undefined {
  const { blendable } = useServices();
  const [{ modelVersion }] = useStore();
  // `landed` makes a new lookup when a read lands; `forgot` when the grid's Refresh forgets a mart's joins.
  const [landed, setLanded] = useState(0);
  const [forgot, setForgot] = useState(0);
  useEffect(() => blendable.subscribe(() => setForgot((n) => n + 1)), [blendable]);
  // The marts asked for since the last Refresh or forget: each is read at most once in that time, even when its read fails.
  const asked = useRef({ stamp: '', ids: new Set<string>() });
  const stamp = `${modelVersion}:${forgot}`;
  return useCallback((martId: string, path: string) => {
    const hit = blendable.peek(martId);
    if (hit) return hit.find((s) => s.aliasPath === path)?.outputAlias;
    if (asked.current.stamp !== stamp) asked.current = { stamp, ids: new Set() };
    if (!asked.current.ids.has(martId)) {
      asked.current.ids.add(martId);
      blendable.get(martId).then(() => setLanded((n) => n + 1), () => {});
    }
    return undefined;
  // `landed` is read through `blendable.peek`: it is here so a landed read makes a new lookup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blendable, stamp, landed]);
}
