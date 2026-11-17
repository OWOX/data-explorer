/**
 * How many badges of a row stay whole. `widths` are the badges' own widths, `chip` the width of the
 * "+N more" chip, `gap` the space between neighbours. When every badge fits there is no chip; otherwise
 * the chip takes its place at the end and as many badges as fit beside it stay. An `available` of 0 or
 * less means the row has not been laid out, so everything is kept.
 */
export function fitBadges(widths: number[], chip: number, available: number, gap: number): number {
  if (available <= 0) return widths.length;
  const all = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= available) return widths.length;
  let used = chip;
  let kept = 0;
  for (const w of widths) {
    if (used + gap + w > available) break;
    used += gap + w;
    kept++;
  }
  return kept;
}
