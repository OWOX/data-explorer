// Tells an element how much of the viewport lies below its top edge, as the CSS variable `--dm-fill`,
// so a band can take "everything left on the screen" without knowing what sits above it.
import { useEffect } from 'react';

/**
 * The height from the element's top to the bottom of the viewport, less the page's bottom padding. The top is measured in the document
 * (viewport top plus the scroll), so scrolling the page does not change it.
 */
export function fillHeight(el: HTMLElement): number {
  const top = el.getBoundingClientRect().top + window.scrollY;
  const main = el.closest('main');
  const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
  return Math.max(0, Math.round(window.innerHeight - top - pad));
}

/**
 * Keeps `--dm-fill` on the element with this id current. The top of the element moves when the bands above
 * it grow or fold, so only the siblings before it are watched (through the page container). What sits after it, and its own height,
 * do not change its top, so setting the variable cannot feed back.
 */
export function useFillHeight(id: string) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = () => {
      // In full screen the band is fixed over the page: its top says nothing about the page.
      if (el.closest('.dm-full')) return;
      el.style.setProperty('--dm-fill', `${fillHeight(el)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    const page = el.parentElement;
    const watchAbove = () => {
      if (!observer || !page) return;
      observer.disconnect();
      for (const child of Array.from(page.children)) { if (child === el) break; observer.observe(child); }
    };
    watchAbove();
    // A band mounted (or removed) above later changes what is watched, and the top itself.
    const mutations = typeof MutationObserver === 'undefined' || !page ? null : new MutationObserver(() => { watchAbove(); apply(); });
    if (page) mutations?.observe(page, { childList: true });
    return () => { window.removeEventListener('resize', apply); observer?.disconnect(); mutations?.disconnect(); };
  }, [id]);
}
