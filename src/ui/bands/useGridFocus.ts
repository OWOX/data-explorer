// The Grid view's focus: the report card (alias path, '' for the main mart) whose joinable marts the band shows.
import { useCallback, useEffect, useState } from 'react';
import type { JoinTree } from '../../state/join-tree';

/**
 * Focus clears on a second click on the focused card, on Escape, on a click on the band's empty area (`clear`), when the main
 * mart changes, and when the focused path leaves the report. It only exists in the Grid view.
 */
export function useGridFocus(mainId: string | null, tree: JoinTree | null, enabled: boolean) {
  const [state, setState] = useState<{ main: string | null; path: string } | null>(null);
  const focus = enabled && state !== null && state.main === mainId && !!tree?.nodes.has(state.path) ? state.path : null;
  // Adjusted while rendering: a stale focus is dropped, so it does not come back when the mart or path does.
  if (state !== null && focus === null) setState(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const toggle = useCallback((path: string) => setState((cur) => (cur !== null && cur.path === path && cur.main === mainId ? null : { main: mainId, path })), [mainId]);
  const clear = useCallback(() => setState(null), []);
  /** Focus a path outright (a card just added), whatever is focused now. */
  const show = useCallback((path: string) => setState({ main: mainId, path }), [mainId]);
  return { focus, toggle, clear, show };
}
