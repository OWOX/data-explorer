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
 * before the ghosts go; only a (+), the anchor card itself or a ghost keeps them, and nothing the pointer does on other cards moves that deadline.
 * `mute` keeps a (+) it names from showing its ghosts until the pointer goes elsewhere (the second click on a pinned (+) hides them).
 * While a card is pinned, hovering another card's body changes nothing; another card's (+) shows its ghosts alone until that hover ends, and the (+) of a ghost
 * extends the chain from the anchor on show (the pin when none is hovered), whose own chain (`pinnedChain`) shows when none is hovered.
 * `at` is the card or ghost the pointer is on, held for the same grace after the pointer leaves the cards, on a timer of its own: the other cards fade while it is set.
 * A pointer arriving on any card or ghost cancels that timer. `onOver(over, false)` is focus, not the pointer: a blur hands what is shown back to where the pointer is.
 */
export function useGhostChain(pinned: string | null, pinnedChain: string[] = NO_CHAIN) {
  const [shown, setShown] = useState<Shown>(NOTHING);
  const [at, setAt] = useState<Over | null>(null);
  // The ghosts' deadline, and the dimming's: neither moves or fires the other.
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const atTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const muted = useRef<string | null>(null);
  // What the pointer is on right now, null when it is on neither a card nor a ghost.
  const pointer = useRef<Over | null>(null);
  // The handlers are stable and read the pin and what is shown through refs.
  const pin = useLatest({ path: pinned, chain: pinnedChain });
  const current = useLatest(shown);
  const cancelGhosts = useCallback(() => { clearTimeout(ghostTimer.current); ghostTimer.current = undefined; }, []);
  const cancelAt = useCallback(() => { clearTimeout(atTimer.current); atTimer.current = undefined; }, []);
  useEffect(() => () => { cancelGhosts(); cancelAt(); }, [cancelGhosts, cancelAt]);
  // Ends a pending leave for good: the pointer is gone, so the other cards stop fading as well.
  const stop = useCallback(() => { if (atTimer.current !== undefined) setAt(null); cancelAt(); cancelGhosts(); }, [cancelAt, cancelGhosts]);
  const hideGhostsLater = useCallback(() => {
    if (ghostTimer.current !== undefined) return;
    ghostTimer.current = setTimeout(() => { ghostTimer.current = undefined; setShown(NOTHING); }, GHOST_GRACE_MS);
  }, []);
  const dimUntilLater = useCallback(() => {
    if (atTimer.current !== undefined) return;
    atTimer.current = setTimeout(() => { atTimer.current = undefined; setAt(null); }, GHOST_GRACE_MS);
  }, []);

  const onOver = useCallback((over: Over, byPointer = true) => {
    if (byPointer) pointer.current = over.card === null && over.ghost === null ? null : over;
    if (over.card === null && over.ghost === null) {
      muted.current = null;
      dimUntilLater();
      if (current.current.anchor !== null) hideGhostsLater();
      return;
    }
    cancelAt();
    setAt((cur) => (cur !== null && cur.card === over.card && cur.ghost === over.ghost ? cur : over));
    const key = plusKey(over);
    // The (+) that was just closed: the pointer is still on it, and it shows nothing until the pointer has been elsewhere.
    if (key !== null && key === muted.current) { cancelGhosts(); return; }
    muted.current = null;
    if (over.card !== null) {
      if (over.plus) {
        // Also on a pinned card's neighbour: its ghosts show instead of the pin's until this hover ends.
        cancelGhosts();
        setShown((cur) => (cur.anchor === over.card && cur.chain.length === 0 ? cur : { anchor: over.card, chain: [] }));
      } else if (current.current.anchor === over.card) {
        cancelGhosts();
      } else if (current.current.anchor !== null) {
        // Another card: what is shown goes at the deadline set when the pointer left it, not at a new one.
        hideGhostsLater();
      }
      return;
    }
    // On a ghost: its own (+) adds the next level; the ghost itself leaves the chain as it is.
    cancelGhosts();
    if (!over.plus) return;
    setShown((cur) => {
      const from = cur.anchor ?? pin.current.path;
      const base = cur.chain.length > 0 ? cur.chain : cur.anchor === null || cur.anchor === pin.current.path ? pin.current.chain : [];
      const chain = chainAfterHover(from, base, over.ghost!);
      return chain === base ? cur : { anchor: cur.anchor, chain };
    });
  }, [dimUntilLater, hideGhostsLater, cancelAt, cancelGhosts, pin, current]);
  /** Focus left: what focus showed goes, but what the pointer holds stays; with the pointer on nothing, it all lets go. */
  const release = useCallback(() => { onOver(pointer.current ?? { card: null, ghost: null, plus: false }, false); }, [onOver]);
  const onLeave = useCallback(() => onOver({ card: null, ghost: null, plus: false }), [onOver]);
  const clear = useCallback(() => { cancelGhosts(); cancelAt(); setShown(NOTHING); muted.current = null; setAt(null); }, [cancelGhosts, cancelAt]);
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
  return { anchor: shown.anchor, chain, at, onOver, onLeave, release, clear, drop, mute };
}
