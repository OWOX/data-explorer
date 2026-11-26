import { useEffect } from 'react';
import { useLatest } from './useLatest';

/** How long a release keeps the swallow armed for a click that arrives as its own task (touch). */
const GRACE_MS = 400;

/**
 * Swallows what the current press sends on to the page: its follow-up mouse events and the click. Armed from a pointerdown, it
 * stays until the click, the next press, a cancel, or a short grace after the release, so a release that never comes
 * (the window lost focus) cannot eat a later, unrelated click. A click with no pointer behind it (detail 0) is never eaten.
 */
export function swallowPress(press?: Event): void {
  const eat = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  // A keyboard or script click (detail 0) is not part of the press: it passes.
  const click = (e: Event) => { if ((e as MouseEvent).detail === 0) return; eat(e); off(); };
  // A later press starts a new one; the press that armed this is still being dispatched and is not that.
  const next = (e: Event) => { if (e !== press) off(); };
  const off = () => {
    clearTimeout(timer);
    window.removeEventListener('click', click, true);
    window.removeEventListener('mousedown', eat, true);
    window.removeEventListener('mouseup', eat, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', next, true);
    window.removeEventListener('pointerdown', next, true);
  };
  // On touch the click can arrive as its own task after pointerup: stay armed for a short grace, until the click or the next press.
  const up = () => { window.removeEventListener('pointerup', up, true); timer = setTimeout(off, GRACE_MS); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('click', click, true);
  window.addEventListener('mousedown', eat, true);
  window.addEventListener('mouseup', eat, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', next, true);
  window.addEventListener('pointerdown', next, true);
}

/** Swallows the click the browser sends after a drag's release, so it does not also act on what is under the pointer. Only the click: mousedown and mouseup pass. */
export function swallowNextClick(): void {
  const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

/**
 * While `active`, a press outside the menu only closes it: `onOutside` runs, and neither the press nor its click reaches the
 * element under the pointer (nothing folds, selects, sorts or starts a drag). `isInside` says which targets belong to the
 * menu or its trigger; those presses are left alone. Scrolling is not touched.
 */
export function useOutsidePress(active: boolean, isInside: (target: Element) => boolean, onOutside: () => void): void {
  const inside = useLatest(isInside);
  const out = useLatest(onOutside);
  useEffect(() => {
    if (!active) return;
    const down = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || inside.current(t)) return;
      e.stopPropagation();
      e.preventDefault();
      swallowPress(e);
      out.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [active, inside, out]);
}
