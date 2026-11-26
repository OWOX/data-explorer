// Cards that animate in and out when the set a block shows changes, ported from Data Flow's
// useReorder (src/reorder.ts) without the drag-to-reorder half.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * How long the transition classes stay on: never shorter than the longest animation (the turn takes
 * 300ms; growing in and collapsing out take 250 and simply finish early).
 */
const SETTLE_MS = 300;

/** What a card is told about its own transition. */
export type CardTransition = { className?: string; leaving?: boolean };

/**
 * What a block of cards is doing between one set and the next.
 *
 * `leaving` cards shrink away where they stood and hold their place until they have; `entering`
 * cards grow out of a point; `turning` cards arrived into a cell another card has just vacated and
 * turn over in place, so a replacement reads as one event. The first render animates nothing, and
 * neither does folding a block (its cards unmount and mount, but none of them joined anything).
 * `idOf` must be a stable function (declared outside the component), or the transitions are recomputed on every render.
 */
export function useCardTransitions<T>(items: T[], idOf: (item: T) => string): { items: T[]; transitionOf: (item: T) => CardTransition } {
  const [leaving, setLeaving] = useState<Array<{ item: T; at: number }>>([]);
  const [entering, setEntering] = useState<Set<string>>(new Set());
  const [turning, setTurning] = useState<Set<string>>(new Set());
  const was = useRef<T[]>(items);
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A layout effect, so the classes are on the elements before the browser paints: an ordinary one
  // lands a frame late and a card flashes at full size before it collapses.
  useLayoutEffect(() => {
    const idOfItem = idOf;
    const before = was.current;
    const here = items.map(idOfItem);
    const present = new Set(here);
    was.current = items;

    const fresh = new Set(here.filter((x) => !before.some((item) => idOfItem(item) === x)));
    const gone = before.map((item, at) => ({ item, at })).filter(({ item }) => !present.has(idOfItem(item)));
    // A cell whose card left and whose index now holds a newly arrived one is a replacement.
    const swapped = new Map<string, T>();
    for (const { item, at } of gone) {
      const taker = here[at];
      if (taker !== undefined && fresh.has(taker)) swapped.set(taker, item);
    }
    const replaced = new Set([...swapped.values()].map(idOfItem));

    if (fresh.size === 0 && gone.length === 0) return;
    setTurning(new Set(swapped.keys()));
    setEntering(new Set([...fresh].filter((x) => !swapped.has(x))));
    setLeaving(gone.filter(({ item }) => !replaced.has(idOfItem(item))));
    clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      setTurning(new Set());
      setEntering(new Set());
      setLeaving([]);
    }, SETTLE_MS);
  }, [items, idOf]);

  useLayoutEffect(() => () => clearTimeout(settling.current), []);

  const shown = useMemo(() => {
    if (leaving.length === 0) return items;
    // A card on its way out shrinks where it stood, rather than jumping to the end to do it.
    const here = new Set(items.map(idOf));
    const out = [...items];
    for (const { item, at } of leaving) {
      if (!here.has(idOf(item))) out.splice(Math.min(at, out.length), 0, item);
    }
    return out;
  }, [items, leaving, idOf]);

  const transitionOf = (item: T): CardTransition => {
    const x = idOf(item);
    const going = leaving.some((l) => idOf(l.item) === x);
    const className = [going ? 'dm-leaving' : '', entering.has(x) ? 'dm-entering' : turning.has(x) ? 'dm-turning' : ''].filter(Boolean).join(' ');
    return { className: className || undefined, leaving: going };
  };

  return { items: shown, transitionOf };
}
