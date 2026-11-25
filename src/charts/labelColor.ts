// One label, one colour: the colour of a category starts from its text in any letter case, so 'true' or 'New' and 'new' begin on the same slot in every chart. A label that clashes with a larger one in its own list takes the next free slot, so it can differ there.
/** The label colours in charts.css (`--dm-series-1` .. `--dm-series-12`). */
export const LABEL_COLORS = 12;

/** The CSS colour of a slot (0-based). */
export const slotColor = (slot: number): string => `var(--dm-series-${slot + 1})`;

/** Labels that differ only in letter case are one label to the palette. */
const fold = (text: string): string => text.toLowerCase();

/** The slot a label hashes to: FNV-1a over the UTF-16 code units of its lower-case text, mod the palette size. The same text hashes to the same slot on every chart. */
export function labelSlot(text: string): number {
  const t = fold(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h % LABEL_COLORS;
}

/**
 * The colours of one list of labels: `columnColors([keys])`. Keys come in rank order. Pass real values only: the blank and Other categories
 * keep their neutral colours.
 */
export const labelColors = (keys: string[]): Map<string, string> => columnColors([keys]);

/**
 * The colours of several lists (a Sankey's columns), each in rank order. A label has one slot over all the lists, whatever its letter case,
 * so a value in several columns has one colour. Labels that share a column get different slots while the palette lasts. A label starts at its
 * hash slot and probes forward past the slots held by other labels it shares a column with, in any column. Another column's values do not
 * push it off its hash slot, except a value that appears in both. Two labels that never share a column may share a colour. When its
 * neighbours already hold all twelve slots, a label keeps its hash slot. The map is keyed by raw key, so case variants share the colour.
 */
export function columnColors(columns: string[][]): Map<string, string> {
  const columnsOf = new Map<string, number[]>();
  columns.forEach((keys, c) => {
    for (const key of keys) {
      const f = fold(key);
      const list = columnsOf.get(f) ?? [];
      if (list.at(-1) !== c) list.push(c);
      columnsOf.set(f, list);
    }
  });
  const members = columns.map((keys) => [...new Set(keys.map(fold))]);
  const slots = new Map<string, number>();
  for (const keys of columns) {
    for (const key of keys) {
      const f = fold(key);
      if (slots.has(f)) continue;
      const forbidden = new Set<number>();
      for (const c of columnsOf.get(f)!) {
        for (const other of members[c]!) {
          const slot = other === f ? undefined : slots.get(other);
          if (slot !== undefined) forbidden.add(slot);
        }
      }
      let slot = labelSlot(key);
      if (forbidden.size < LABEL_COLORS) while (forbidden.has(slot)) slot = (slot + 1) % LABEL_COLORS;
      slots.set(f, slot);
    }
  }
  const out = new Map<string, string>();
  for (const keys of columns) for (const key of keys) out.set(key, slotColor(slots.get(fold(key))!));
  return out;
}
