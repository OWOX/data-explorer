import { useEffect, useMemo, useReducer } from 'react';
import type { JoinTree } from '../../state/join-tree';
import { ghostStep, IDLE, shownOf, type GhostEvent, type Over } from './ghost-chain';

/** How long the ghosts stay after the pointer leaves, so it can cross the gap from a card to its ghosts. Showing them has no delay. */
export const GHOST_GRACE_MS = 400;

const NO_CHAIN: string[] = [];

export function overOf(target: EventTarget | null): Over {
  const el = target instanceof Element ? target : null;
  const plus = el?.closest('[data-join-plus]') != null;
  const ghost = el?.closest<HTMLElement>('[data-ghost-path]')?.dataset.ghostPath;
  if (ghost !== undefined) return { card: null, ghost, plus };
  return { card: el?.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath ?? null, ghost: null, plus };
}

/** Sends `type` once the deadline `due` has run for the grace. */
function useDeadline(type: 'ghostsDue' | 'atDue', due: number | null, dispatch: (e: GhostEvent) => void) {
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(() => dispatch({ type, due }), GHOST_GRACE_MS);
    return () => clearTimeout(timer);
  }, [type, due, dispatch]);
}

/**
 * The ghosts of the canvas: the pin, what shows (`anchor` and `chain`, the pin's when nothing is hovered or focused), and `at`, the card or ghost the other cards fade for.
 * The rules are in `ghostStep`. This adds the timers, and drops what stands on a path the tree lost.
 */
export function useGhostChain(mainId: string | null, tree: JoinTree) {
  const [state, dispatch] = useReducer(ghostStep, IDLE);
  useDeadline('ghostsDue', state.ghostsDue, dispatch);
  useDeadline('atDue', state.atDue, dispatch);
  const lost: GhostEvent = { type: 'tree', main: mainId, has: (path) => tree.nodes.has(path) };
  if (ghostStep(state, lost) !== state) dispatch(lost);
  const actions = useMemo(() => ({
    onOver: (over: Over) => dispatch({ type: 'over', over }),
    onLeave: () => dispatch({ type: 'over', over: { card: null, ghost: null, plus: false } }),
    onFocus: (over: Over) => dispatch({ type: 'focus', over }),
    onBlur: (to: Over | null) => dispatch({ type: 'blur', to }),
    clear: () => dispatch({ type: 'clear' }),
    /** A card becomes the pin. */
    pinCard: (path: string) => dispatch({ type: 'pin', path, main: mainId }),
    /** A click on a card, on its (+) or on the (+) of a ghost. */
    toggleCard: (path: string) => dispatch({ type: 'card', path, main: mainId }),
    togglePlus: (path: string) => dispatch({ type: 'plus', path, main: mainId }),
    toggleGhostPlus: (path: string) => dispatch({ type: 'ghostPlus', path, main: mainId }),
  }), [mainId]);
  const shown = shownOf(state);
  return { pin: state.pin?.anchor ?? null, pinnedChain: state.pin?.chain ?? NO_CHAIN, anchor: shown?.anchor ?? null, chain: shown?.chain ?? NO_CHAIN, at: state.at, ...actions };
}
