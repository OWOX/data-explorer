import { useCallback, useEffect, useRef, useState } from 'react';
import { chainAfterHover } from '../../state/join-tree';
import { useLatest } from '../useLatest';

/** How long the ghosts stay after the pointer leaves, so it can cross the gap from a card to its ghosts. Showing them has no delay. */
export const GHOST_GRACE_MS = 400;

type Shown = { anchor: string | null; chain: string[] };
const NOTHING: Shown = { anchor: null, chain: [] };
const NO_CHAIN: string[] = [];

/** What the pointer is over: a tree card (its path), a ghost (its alias path), or neither; `plus` is whether it is on the (+) of that card or ghost. */
export type Over = { card: string | null; ghost: string | null; plus: boolean };

export function overOf(target: EventTarget | null): Over {
  const el = target instanceof Element ? target : null;
  const plus = el?.closest('[data-join-plus]') != null;
  const ghost = el?.closest<HTMLElement>('[data-ghost-path]')?.dataset.ghostPath;
  if (ghost !== undefined) return { card: null, ghost, plus };
  return { card: el?.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath ?? null, ghost: null, plus };
}

/** The (+) a pointer is on, as the key `mute` takes; null when it is on no (+). */
const plusKey = (over: Over) => (!over.plus ? null : over.card !== null ? `card:${over.card}` : `ghost:${over.ghost}`);

/**
 * The hover side of the canvas ghosts: the tree card whose (+) the pointer is on (the anchor) and the chain of ghosts from it to the ghost whose (+) it is on.
 * A (+) shows its ghosts at once, also when the pointer comes from another card. Leaving to another card or to the empty canvas waits `GHOST_GRACE_MS`
 * before the ghosts go; the pointer on the anchor card itself, or on a ghost, keeps them.
 * `mute` keeps a (+) it names from showing its ghosts until the pointer goes elsewhere (the second click on a pinned (+) hides them).
 * While a card is pinned, hovering another card changes nothing; hovered ghost (+)s extend the chain from the pin, whose own chain (`pinnedChain`) shows when none is hovered.
 * `at` is the card or ghost the pointer is on, held for the same grace after it leaves: the other cards fade while it is set.
 */
export function useGhostChain(pinned: string | null, pinnedChain: string[] = NO_CHAIN) {
  const [shown, setShown] = useState<Shown>(NOTHING);
  const [at, setAt] = useState<Over | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether the pending timer also lets go of `at`: it does when the pointer left the cards, not when it only moved to another card.
  const timerLeaves = useRef(false);
  const muted = useRef<string | null>(null);
  // The handlers are stable and read the pin and what is shown through refs.
  const pin = useLatest({ path: pinned, chain: pinnedChain });
  const current = useLatest(shown);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => cancel, []);
  // Ends a pending leave for good: the pointer is gone, so the other cards stop fading as well.
  const stop = useCallback(() => { if (timer.current !== undefined && timerLeaves.current) setAt(null); cancel(); }, []);
  // The deadline is set when the pointer leaves the ghosts and is not moved by what it does on other cards after that.
  const later = useCallback((leaves: boolean) => {
    if (timer.current !== undefined) { timerLeaves.current = leaves; return; }
    timerLeaves.current = leaves;
    timer.current = setTimeout(() => { timer.current = undefined; setShown(NOTHING); if (timerLeaves.current) setAt(null); }, GHOST_GRACE_MS);
  }, []);

  const onOver = useCallback((over: Over) => {
    if (over.card === null && over.ghost === null) {
      muted.current = null;
      later(true);
      return;
    }
    setAt((cur) => (cur !== null && cur.card === over.card && cur.ghost === over.ghost ? cur : over));
    const key = plusKey(over);
    // The (+) that was just closed: the pointer is still on it, and it shows nothing until the pointer has been elsewhere.
    if (key !== null && key === muted.current) { cancel(); return; }
    muted.current = null;
    if (over.card !== null) {
      if (over.plus) {
        // Also on a pinned card's neighbour: its ghosts show instead of the pin's until this hover ends.
        cancel();
        setShown((cur) => (cur.anchor === over.card && cur.chain.length === 0 ? cur : { anchor: over.card, chain: [] }));
      } else if (current.current.anchor === over.card) {
        cancel();
      } else if (current.current.anchor !== null) {
        // Another card: what is shown goes at the deadline the pointer set when it left, not at a new one.
        later(false);
      }
      return;
    }
    // On a ghost: its own (+) adds the next level; the ghost itself leaves the chain as it is.
    cancel();
    if (!over.plus) return;
    setShown((cur) => {
      const from = cur.anchor ?? pin.current.path;
      const base = cur.chain.length > 0 ? cur.chain : cur.anchor === null || cur.anchor === pin.current.path ? pin.current.chain : [];
      const chain = chainAfterHover(from, base, over.ghost!);
      return chain === base ? cur : { anchor: cur.anchor, chain };
    });
  }, [later, pin, current]);
  const onLeave = useCallback(() => onOver({ card: null, ghost: null, plus: false }), [onOver]);
  const clear = useCallback(() => { cancel(); setShown(NOTHING); muted.current = null; setAt(null); }, []);
  /** Lets go of what the hover shows, without muting anything: the pointer stays where it is. */
  const drop = useCallback(() => { stop(); setShown(NOTHING); }, [stop]);
  const mute = useCallback((target: { card: string } | { ghost: string }) => {
    stop();
    if ('card' in target) {
      muted.current = `card:${target.card}`;
      setShown(NOTHING);
    } else {
      muted.current = `ghost:${target.ghost}`;
      setShown((cur) => {
        const at = cur.chain.indexOf(target.ghost);
        return at < 0 ? cur : { anchor: cur.anchor, chain: cur.chain.slice(0, at) };
      });
    }
  }, [stop]);

  // The pin's own chain shows when nothing is hovered or the pinned card's own (+) is; another card's (+) shows its ghosts alone.
  const chain = shown.chain.length > 0 ? shown.chain : shown.anchor === null || shown.anchor === pinned ? pinnedChain : NO_CHAIN;
  return { anchor: shown.anchor, chain, at, onOver, onLeave, clear, drop, mute };
}
