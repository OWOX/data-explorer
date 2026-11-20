import { useCallback, useEffect, useRef, useState } from 'react';
import { chainAfterHover } from '../../state/join-tree';

/** How long the ghosts stay after the pointer leaves, so it can cross the gap from a card to its ghosts. Showing them has no delay. */
export const GHOST_GRACE_MS = 400;

type Shown = { anchor: string | null; chain: string[] };
const NOTHING: Shown = { anchor: null, chain: [] };

/** What the pointer is over: a tree card (its path), a ghost (its alias path), or neither. */
export type Over = { card: string | null; ghost: string | null };

export function overOf(target: EventTarget | null): Over {
  const el = target instanceof Element ? target : null;
  const ghost = el?.closest<HTMLElement>('[data-ghost-path]')?.dataset.ghostPath;
  if (ghost !== undefined) return { card: null, ghost };
  return { card: el?.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath ?? null, ghost: null };
}

/**
 * The hover side of the canvas ghosts: the tree card the pointer is on (the anchor) and the chain of ghosts from it to the hovered one.
 * A card shows its ghosts at once, also when the pointer comes from another card. Leaving everything waits `GHOST_GRACE_MS` before the ghosts go.
 * `mute` keeps a card's own hover from showing its ghosts until the pointer goes elsewhere (the second click on a pinned card hides them).
 * While a card is pinned, hovering another card changes nothing; hovered ghosts extend the chain from the pin.
 */
export function useGhostChain(pinned: string | null) {
  const [shown, setShown] = useState<Shown>(NOTHING);
  const [muted, setMuted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The handlers are stable and read the pin through a ref.
  const pin = useRef(pinned);
  useEffect(() => { pin.current = pinned; });
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => cancel, []);

  const onOver = useCallback((over: Over) => {
    if (over.card === null && over.ghost === null) {
      setMuted(null);
      if (timer.current !== undefined) return;
      timer.current = setTimeout(() => { timer.current = undefined; setShown(NOTHING); }, GHOST_GRACE_MS);
      return;
    }
    cancel();
    if (over.card !== null) {
      setMuted((m) => (m === over.card ? m : null));
      // A pinned card keeps the ghosts: another card under the pointer shows nothing of its own.
      if (pin.current !== null) { setShown(NOTHING); return; }
      setShown((cur) => (cur.anchor === over.card && cur.chain.length === 0 ? cur : { anchor: over.card, chain: [] }));
      return;
    }
    setMuted(null);
    setShown((cur) => {
      const chain = chainAfterHover(cur.anchor ?? pin.current, cur.chain, over.ghost!);
      return chain === cur.chain ? cur : { anchor: cur.anchor, chain };
    });
  }, []);
  const onLeave = useCallback(() => onOver({ card: null, ghost: null }), [onOver]);
  const clear = useCallback(() => { cancel(); setShown(NOTHING); setMuted(null); }, []);
  const mute = useCallback((path: string) => { cancel(); setShown(NOTHING); setMuted(path); }, []);

  // A hovered card that was muted shows nothing; the pointer is still on it.
  const hovered = shown.anchor !== null && shown.anchor === muted ? NOTHING : shown;
  return { anchor: hovered.anchor, chain: hovered.chain, onOver, onLeave, clear, mute };
}
