/** How many lines `items` take when laid out in order, wrapping greedily as a flex row does. An item wider than the row takes a line of its own. */
function linesOf(items: number[], available: number, gap: number): number {
  let lines = 0;
  let used = 0;
  for (const w of items) {
    if (lines === 0 || used + gap + w > available) { lines++; used = w; } else used += gap + w;
  }
  return lines;
}

/**
 * How many badges stay whole when they wrap onto at most `lines` lines (two by default). `widths` are the
 * badges' own widths, `chip` the width of the "+N more" chip, `gap` the space between neighbours, in a row
 * and between rows alike. When every badge fits in `lines` lines there is no chip; otherwise the chip ends
 * the last line and as many badges as fit before it stay. An `available` of 0 or less means the row has not
 * been laid out, so everything is kept.
 */
export function fitBadges(widths: number[], chip: number, available: number, gap: number, lines = 2): number {
  if (available <= 0) return widths.length;
  if (linesOf(widths, available, gap) <= lines) return widths.length;
  for (let kept = widths.length - 1; kept > 0; kept--) {
    if (linesOf([...widths.slice(0, kept), chip], available, gap) <= lines) return kept;
  }
  return 0;
}
