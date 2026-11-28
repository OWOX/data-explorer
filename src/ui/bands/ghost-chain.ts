// What the canvas shows as ghosts, which card is selected and what it dims, as a pure state machine: `ghostStep` takes each thing the user did and `useGhostChain` runs the timer it asks for.
import { chainAfterHover } from '../../state/join-tree';
import { parentPath } from '../../state/join-plan';

/** What the pointer or focus is on: a tree card (its path), a ghost (its alias path), or neither; `plus` is whether it is on the (+) of that card or ghost. */
export type Over = { card: string | null; ghost: string | null; plus: boolean };

/** The tree card whose ghosts show, and the chain of ghosts from it: each link adds its own level. */
type Shown = { anchor: string; chain: string[] };
/** What is open or selected belongs to one main mart, as in the Grid. */
type Pin = Shown & { main: string | null };
type Selected = { main: string | null; path: string };

export type GhostState = {
  /** The ghosts on screen. Only a click on a (+) opens or closes them. */
  pin: Pin | null;
  /** The selected card: a click on it, or the card a ghost became. It opens no ghosts. */
  selected: Selected | null;
  /** Focus is where it set `at`. */
  focus: boolean;
  /** What the pointer is on, null when it is on neither a card nor a ghost. */
  pointer: Over | null;
  /** The card or ghost the other cards fade for; `atFocus` when focus set it and the pointer is not on it. */
  at: Over | null;
  atFocus: boolean;
  /** The running deadline of the dimming. It is a new number every time it starts, so an old timer does nothing. */
  atDue: number | null;
  started: number;
};

export const IDLE: GhostState = { pin: null, selected: null, focus: false, pointer: null, at: null, atFocus: false, atDue: null, started: 0 };

export type GhostEvent =
  /** The pointer arrived somewhere; on nothing when it left the cards. */
  | { type: 'over'; over: Over }
  /** Focus arrived on a (+) or inside a ghost. */
  | { type: 'focus'; over: Over }
  /** Focus left for `to`, null when that is outside the graph. */
  | { type: 'blur'; to: Over | null }
  /** A click on a card selects it; a second one lets it go. */
  | { type: 'card'; path: string; main: string | null }
  /** A click on a card's (+) or on the (+) of a ghost. The second one on what is open closes it. */
  | { type: 'plus' | 'ghostPlus'; path: string; main: string | null }
  /** The card a ghost became is selected. */
  | { type: 'select'; path: string; main: string | null }
  /** Escape or a click on the empty canvas. */
  | { type: 'clear' }
  /** The tree changed: what stood on a path it lost is dropped, and so is what was kept for another main mart. */
  | { type: 'tree'; main: string | null; has: (path: string) => boolean }
  /** The dimming's deadline passed. */
  | { type: 'atDue'; due: number };

const sameCard = (a: Over | null, b: Over) => a !== null && a.card === b.card && a.ghost === b.ghost;

/** The ghosts on screen. */
export const shownOf = (s: GhostState): Shown | null => s.pin;

const hasGhost = (shown: Shown, ghost: string) => parentPath(ghost) === shown.anchor || shown.chain.includes(parentPath(ghost));

/** The ghosts close. What fades is what the pointer is on, if that is still there. */
function close(s: GhostState): GhostState {
  const onGone = s.pointer !== null && s.pointer.ghost !== null;
  const pointer = onGone ? null : s.pointer;
  return { ...s, pin: null, pointer, at: pointer, atFocus: false };
}

function step(s: GhostState, e: GhostEvent): GhostState {
  switch (e.type) {
    case 'over': {
      const on = e.over.card === null && e.over.ghost === null ? null : e.over;
      // The browser sends the same place again when cards shift: that is no new hover.
      const moved = on === null ? s.pointer !== null : !(sameCard(s.pointer, on) && s.pointer!.plus === on.plus);
      const n: GhostState = { ...s, pointer: moved ? on : s.pointer };
      if (on !== null) { n.at = sameCard(s.at, on) ? s.at : on; n.atFocus = false; }
      return n;
    }
    case 'focus':
      return { ...s, focus: true, at: sameCard(s.at, e.over) ? s.at : e.over, atFocus: !sameCard(s.pointer, e.over) };
    case 'blur':
      // To another card or ghost: the focus event that follows moves the dimming.
      if (e.to !== null && (e.to.card !== null || e.to.ghost !== null)) return s;
      return { ...s, focus: false, at: s.atFocus ? s.pointer ?? s.at : s.at, atFocus: false };
    case 'card':
      return { ...s, selected: s.selected?.path === e.path ? null : { main: e.main, path: e.path } };
    case 'select':
      return { ...s, selected: { main: e.main, path: e.path } };
    case 'plus':
      return s.pin?.anchor === e.path ? close(s) : { ...s, pin: { main: e.main, anchor: e.path, chain: [] } };
    case 'ghostPlus': {
      if (s.pin === null || !hasGhost(s.pin, e.path)) return s;
      const at = s.pin.chain.indexOf(e.path);
      if (at >= 0) {
        const pin = { ...s.pin, chain: s.pin.chain.slice(0, at) };
        // What the pointer is on went with the closed levels when it hung from them.
        const gone = s.pointer?.ghost != null && !hasGhost(pin, s.pointer.ghost);
        return gone ? { ...s, pin, pointer: null, at: null, atFocus: false } : { ...s, pin };
      }
      return { ...s, pin: { ...s.pin, chain: chainAfterHover(s.pin.anchor, s.pin.chain, e.path) } };
    }
    case 'clear':
      return { ...close(s), selected: null, at: null };
    case 'tree': {
      const still = (x: Over | null) => (x !== null && x.card !== null && !e.has(x.card) ? null : x);
      const pin = s.pin !== null && s.pin.main === e.main && e.has(s.pin.anchor) ? s.pin : null;
      const selected = s.selected !== null && s.selected.main === e.main && e.has(s.selected.path) ? s.selected : null;
      return { ...s, pin, selected, pointer: still(s.pointer), at: still(s.at) };
    }
    case 'atDue':
      return s.atDue === e.due ? { ...s, at: null } : s;
  }
}

/** Starts the dimming's deadline once the pointer or focus is on no card; a deadline that already runs is left alone. */
function settle(s: GhostState): GhostState {
  const n = { ...s };
  const atHeld = n.at === null || (n.atFocus ? n.focus : n.pointer !== null);
  n.atDue = atHeld ? null : s.atDue ?? ++n.started;
  if (n.at === null) n.atFocus = false;
  return n;
}

/**
 * The rules. Ghosts show only from a click on a (+): a card's opens its ghosts, a ghost's adds the next level, and a second click closes it. Hover and focus open nothing,
 * so the layout never moves under a still pointer. A click on a card selects it. The dimming follows the pointer and focus, with a deadline from the moment both are on no card.
 */
export function ghostStep(s: GhostState, e: GhostEvent): GhostState {
  const n = settle(step(s, e));
  // The same object when nothing changed, so a pointer crossing the inside of a card renders nothing.
  return (Object.keys(n) as (keyof GhostState)[]).every((k) => n[k] === s[k]) ? s : n;
}
