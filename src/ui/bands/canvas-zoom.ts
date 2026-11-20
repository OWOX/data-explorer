export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

/** One wheel notch of a mouse is clamped to this many delta units, so it zooms about as fast as a pinch burst does. */
const MAX_DELTA = 60;
const SPEED = 0.005;

/** The scale after a zoom wheel event: multiplicative in `deltaY` (wheel up, negative, zooms in), kept within 0.5 to 2. */
export function zoomedScale(scale: number, deltaY: number): number {
  const d = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, deltaY));
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.exp(-d * SPEED)));
}

/** The scroll box that holds the tree: the tree sits in a sizer, which sits in it. */
export function scrollBoxOf(tree: HTMLElement): HTMLElement {
  return tree.closest<HTMLElement>('.dm-tree-scroll') ?? tree.parentElement ?? tree;
}
