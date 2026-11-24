import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../state/store';

/**
 * The Output Alias a mart's own join settings give a path below it. A mart joined deeper in the report keeps the names its owner gave its joins
 * ("Last Session") in its own settings, not in the main mart's, so a line under it reads them from there. Each mart is read once per session.
 * Returns undefined until the mart's joins are read, or when the path has no alias there.
 */
export function useOwnAliases(martIds: readonly string[]): (martId: string, path: string) => string | undefined {
  const { blendable } = useServices();
  const [read, setRead] = useState(0);
  const key = [...new Set(martIds)].sort().join('|');
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split('|') : []) {
      if (blendable.peek(id)) continue;
      blendable.get(id).then(() => { if (live) setRead((n) => n + 1); }, () => {});
    }
    return () => { live = false; };
    // `read` too: joins forgotten by Refresh are read again.
  }, [blendable, key, read]);
  useEffect(() => blendable.subscribe(() => setRead((n) => n + 1)), [blendable]);
  // `read` makes a fresh lookup each time a mart's joins arrive, so memos that take it rebuild.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((martId, path) => blendable.peek(martId)?.find((s) => s.aliasPath === path)?.outputAlias, [blendable, read]);
}
