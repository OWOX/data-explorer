// What the canvas shows as ghosts, and what it dims, as a pure state machine: `ghostStep` takes each thing the user did and `useGhostChain` runs the two timers it asks for.
import { chainAfterHover } from '../../state/join-tree';
import { parentPath } from '../../state/join-plan';

/** What the pointer or focus is on: a tree card (its path), a ghost (its alias path), or neither; `plus` is whether it is on the (+) of that card or ghost. */
export type Over = { card: string | null; ghost: string | null; plus: boolean };

/** The tree card whose ghosts show, and the chain of ghosts from it: each link adds its own level. */
type Shown = { anchor: string; chain: string[] };
/** A pin belongs to one main mart, as in the Grid. Its chain is empty for a card, and the links to a ghost for a ghost's (+). */
type Pin = Shown & { main: string | null };

export type GhostState = {
  pin: Pin | null;
  /** What the pointer showed. It shows instead of the pin. */
  held: Shown | null;
  /** What focus showed. It shows instead of both. */
  focused: Shown | null;
  /** Focus is where it showed `focused` or set `at`. */
  focus: boolean;
  /** What the pointer is on, null when it is on neither a card nor a ghost. */
  pointer: Over | null;
  /** The (+) the pointer is on was closed under it: the pointer holds nothing until it has left that (+). */
  spent: boolean;
  /** The card or ghost the other cards fade for; `atFocus` when focus set it and the pointer is not on it. */
  at: Over | null;
  atFocus: boolean;
  /** The running deadlines, of the ghosts and of the dimming. Each is a new number every time it starts, so an old timer does nothing. */
  ghostsDue: number | null;
  atDue: number | null;
  started: number;
};

export const IDLE: GhostState = { pin: null, held: null, focused: null, focus: false, pointer: null, spent: false, at: null, atFocus: false, ghostsDue: null, atDue: null, started: 0 };

export type GhostEvent =
  /** The pointer arrived somewhere; on nothing when it left the cards. */
  | { type: 'over'; over: Over }
  /** Focus arrived on a (+) or inside a ghost. */
  | { type: 'focus'; over: Over }
  /** Focus left for `to`, null when that is outside the graph. */
  | { type: 'blur'; to: Over | null }
  /** A click on a card, on its (+) or on the (+) of a ghost. The second one on what is pinned lets it go. */
  | { type: 'card' | 'plus'; path: string; main: string | null }
  | { type: 'ghostPlus'; path: string; main: string | null }
  /** The card a ghost became is pinned. */
  | { type: 'pin'; path: string; main: string | null }
  /** Escape or a click on the empty canvas. */
  | { type: 'clear' }
  /** The tree changed: what stood on a path it lost is dropped, and so is a pin kept for another main mart. */
  | { type: 'tree'; main: string | null; has: (path: string) => boolean }
  /** A deadline passed. */
  | { type: 'ghostsDue' | 'atDue'; due: number };

const sameCard = (a: Over | null, b: Over) => a !== null && a.card === b.card && a.ghost === b.ghost;

/** The ghosts on screen: what focus showed, else what the pointer showed, else the pin's. */
export const shownOf = (s: GhostState): Shown | null => s.focused ?? s.held ?? s.pin;

const hasGhost = (shown: Shown, ghost: string) => parentPath(ghost) === shown.anchor || shown.chain.includes(parentPath(ghost));

/** Whether the pointer keeps these ghosts: it is on their anchor card or on one of them. */
function isOn(s: GhostState, shown: Shown): boolean {
  if (s.pointer === null || s.spent) return false;
  return s.pointer.ghost !== null ? hasGhost(shown, s.pointer.ghost) : s.pointer.card === shown.anchor;
}

/** What a (+) shows. A card's: its ghosts. A ghost's: the next level, on the chain that is on screen. The pin's own chain stays with the (+) it hangs from. */
function shownBy(s: GhostState, over: Over): Shown | null {
  if (over.card !== null) return { anchor: over.card, chain: s.pin?.anchor === over.card ? s.pin.chain : [] };
  const base = shownOf(s);
  if (base === null || over.ghost === null) return null;
  if (s.pin?.anchor === base.anchor && s.pin.chain.includes(over.ghost)) return { anchor: base.anchor, chain: s.pin.chain };
  const chain = chainAfterHover(base.anchor, base.chain, over.ghost);
  return chain === base.chain ? null : { anchor: base.anchor, chain };
}

/** Everything but the pin lets go. What fades is what the pointer is on, if that is still there. */
function letGo(s: GhostState): GhostState {
  const onGone = s.pointer !== null && s.pointer.ghost !== null && !(s.pin !== null && hasGhost(s.pin, s.pointer.ghost));
  const pointer = onGone ? null : s.pointer;
  return { ...s, pointer, held: null, focused: null, at: pointer, atFocus: false };
}

function step(s: GhostState, e: GhostEvent): GhostState {
  switch (e.type) {
    case 'over': {
      const on = e.over.card === null && e.over.ghost === null ? null : e.over;
      // The browser sends the same place again when cards shift: that is no new hover.
      const moved = on === null ? s.pointer !== null : !(sameCard(s.pointer, on) && s.pointer!.plus === on.plus);
      const n: GhostState = { ...s, pointer: moved ? on : s.pointer, spent: moved ? false : s.spent };
      if (on !== null) { n.at = sameCard(s.at, on) ? s.at : on; n.atFocus = false; }
      if (!moved) return n;
      // Ghosts the pointer was on and left go, also when focus showed them.
      if (s.focused !== null && isOn(s, s.focused) && !isOn(n, s.focused)) n.focus = false;
      const show = on?.plus ? shownBy(s, on) : null;
      return show === null ? n : { ...n, held: show, focused: null };
    }
    case 'focus': {
      const n: GhostState = { ...s, focus: true, at: sameCard(s.at, e.over) ? s.at : e.over, atFocus: !sameCard(s.pointer, e.over) };
      if (e.over.plus) return { ...n, focused: shownBy(s, e.over) ?? s.focused };
      // A ghost with focus keeps the ghosts it is one of.
      const hover = s.focused ?? s.held;
      return hover !== null && e.over.ghost !== null && hasGhost(hover, e.over.ghost) ? { ...n, focused: hover } : n;
    }
    case 'blur': {
      // To a ghost, or within the anchor card: focus still holds what it showed.
      const hover = s.focused ?? s.held;
      if (e.to !== null && (e.to.ghost !== null || (e.to.card !== null && e.to.card === hover?.anchor))) return s;
      return { ...s, focus: false, at: s.atFocus ? s.pointer ?? s.at : s.at, atFocus: false };
    }
    case 'card':
      return s.pin?.anchor === e.path ? letGo({ ...s, pin: null }) : { ...s, pin: { main: e.main, anchor: e.path, chain: [] } };
    case 'plus':
      if (s.pin?.anchor === e.path) return letGo({ ...s, pin: null, spent: s.spent || (s.pointer?.plus === true && s.pointer.card === e.path) });
      return { ...s, pin: { main: e.main, anchor: e.path, chain: [] }, held: null, focused: null, spent: false };
    case 'ghostPlus': {
      const at = s.pin?.chain.indexOf(e.path) ?? -1;
      if (s.pin !== null && at >= 0) return letGo({ ...s, pin: { ...s.pin, chain: s.pin.chain.slice(0, at) }, spent: s.spent || (s.pointer?.plus === true && s.pointer.ghost === e.path) });
      const show = shownBy(s, { card: null, ghost: e.path, plus: true });
      return show === null ? s : { ...s, pin: { main: e.main, ...show }, held: null, focused: null, spent: false };
    }
    case 'pin':
      return { ...s, pin: { main: e.main, anchor: e.path, chain: [] } };
    case 'clear':
      return { ...letGo({ ...s, pin: null, spent: s.pointer?.plus === true }), at: null };
    case 'tree': {
      const kept = <T extends Shown>(x: T | null) => (x !== null && e.has(x.anchor) ? x : null);
      const still = (x: Over | null) => (x !== null && x.card !== null && !e.has(x.card) ? null : x);
      return { ...s, pin: s.pin?.main === e.main ? kept(s.pin) : null, held: kept(s.held), focused: kept(s.focused), pointer: still(s.pointer), at: still(s.at) };
    }
    case 'ghostsDue':
      return s.ghostsDue === e.due ? { ...s, held: null, focused: null } : s;
    case 'atDue':
      return s.atDue === e.due ? { ...s, at: null } : s;
  }
}

/** Brings who holds what, and the two deadlines, in line with where the pointer and focus now are. A deadline that already runs is left alone. */
function settle(s: GhostState): GhostState {
  const n = { ...s };
  // What the pointer left while focus shows something else is not on screen: there is nothing to wait for.
  if (n.focused !== null && n.held !== null && !isOn(n, n.held)) n.held = null;
  // Focus has left: what it showed gives way to what the pointer holds, or becomes it when the pointer is on it.
  if (n.focused !== null && !n.focus) {
    if (n.held === null && isOn(n, n.focused)) n.held = n.focused;
    if (n.held !== null) n.focused = null;
  }
  const ghostsHeld = n.focused !== null ? n.focus : n.held === null || isOn(n, n.held);
  n.ghostsDue = ghostsHeld ? null : s.ghostsDue ?? ++n.started;
  const atHeld = n.at === null || (n.atFocus ? n.focus : n.pointer !== null);
  n.atDue = atHeld ? null : s.atDue ?? ++n.started;
  if (n.at === null) n.atFocus = false;
  return n;
}

/**
 * The rules. Only a (+) shows ghosts, at once, by hover or by focus; the pointer keeps them on the anchor card, on its (+) and on the ghosts, and focus keeps what it showed until it leaves.
 * When nothing keeps them a deadline starts, and only being kept again stops it. The pin is under all that and shows when nothing else does.
 * A click lets go of what it closed for as long as the pointer stays on that (+). The dimming has its own deadline, from the moment the pointer or focus is on no card.
 */
export function ghostStep(s: GhostState, e: GhostEvent): GhostState {
  const n = settle(step(s, e));
  // The same object when nothing changed, so a pointer crossing the inside of a card renders nothing.
  return (Object.keys(n) as (keyof GhostState)[]).every((k) => n[k] === s[k]) ? s : n;
}
