// One label, one colour: the colour of a category comes from its text, so 'true' or 'OWOX BI' looks the same in every chart.
/** The label colours in charts.css (`--dm-series-1` .. `--dm-series-12`). */
export const LABEL_COLORS = 12;

/** The CSS colour of a slot (0-based). */
export const slotColor = (slot: number): string => `var(--dm-series-${slot + 1})`;

/**
 * Turns the palette's rotation: added to FNV-1a's offset basis. 37 gives the product names of the usage data (OWOX Data Marts, OWOX BI, Extension,
 * Extension v2, ChatGPT, Claude, Excel Add-in) seven different slots, with OWOX Data Marts on the first, the blue.
 */
const ROTATION = 37;

/** The slot a label hashes to: FNV-1a over its UTF-16 code units, mod the palette size. The same text gives the same slot on every chart. */
export function labelSlot(text: string): number {
  let h = (0x811c9dc5 + ROTATION) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h % LABEL_COLORS;
}

/**
 * The colours of one chart's labels. Keys come in rank order; each takes its hash slot, or the next free one when a key of the same chart
 * already holds it, so the biggest values never share a colour while the palette lasts. Past 12 labels a key falls back to its hash slot.
 * Pass real values only: the blank and Other categories keep their neutral colours.
 */
export function labelColors(keys: string[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const key of keys) {
    if (out.has(key)) continue;
    let slot = labelSlot(key);
    if (taken.size < LABEL_COLORS) while (taken.has(slot)) slot = (slot + 1) % LABEL_COLORS;
    taken.add(slot);
    out.set(key, slotColor(slot));
  }
  return out;
}
