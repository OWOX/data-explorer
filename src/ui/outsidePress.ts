import { useEffect } from 'react';
import { useLatest } from './useLatest';

/**
 * Swallows what the current press sends on to the page: its follow-up mouse events and the click. Armed from a pointerdown, it
 * stays until the release has been handled (the click comes after pointerup), and drops itself at the next press or a cancel,
 * so a release that never comes (the window lost focus) cannot eat a later, unrelated click.
 */
export function swallowPress(press?: Event): void {
  const eat = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  const click = (e: Event) => { eat(e); off(); };
  // A later press starts a new one; the press that armed this is still being dispatched and is not that.
  const next = (e: Event) => { if (e !== press) off(); };
  const off = () => {
    window.removeEventListener('click', click, true);
    window.removeEventListener('mousedown', eat, true);
    window.removeEventListener('mouseup', eat, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', next, true);
    window.removeEventListener('pointerdown', next, true);
  };
  const up = () => { window.removeEventListener('pointerdown', next, true); setTimeout(off, 0); };
  window.addEventListener('click', click, true);
  window.addEventListener('mousedown', eat, true);
  window.addEventListener('mouseup', eat, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', next, true);
  window.addEventListener('pointerdown', next, true);
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
