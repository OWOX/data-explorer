import { expect, test } from 'vitest';
import { LABEL_COLORS, labelColors, labelSlot, slotColor } from './labelColor';

test('a label hashes to the same slot every time, inside the palette', () => {
  expect(labelSlot('true')).toBe(labelSlot('true'));
  for (const t of ['', 'true', 'false', 'OWOX BI', '42', 'ünï']) {
    expect(labelSlot(t)).toBeGreaterThanOrEqual(0);
    expect(labelSlot(t)).toBeLessThan(LABEL_COLORS);
  }
  expect(labelSlot('')).toBe(((0x811c9dc5 + 37) >>> 0) % LABEL_COLORS);
});

test('the rotation puts OWOX Data Marts on the blue and keeps the seven product names apart', () => {
  expect(labelSlot('OWOX Data Marts')).toBe(0);
  const products = ['OWOX Data Marts', 'OWOX BI', 'Extension', 'Extension v2', 'ChatGPT', 'Claude', 'Excel Add-in'];
  expect(new Set(products.map(labelSlot)).size).toBe(products.length);
});

test('the same label gets the same colour whatever else is in the chart', () => {
  expect(labelColors(['true']).get('true')).toBe(slotColor(labelSlot('true')));
  const other = ['x', 'y', 'z', 'w'].find((k) => labelSlot(k) !== labelSlot('true'))!;
  expect(labelColors([other, 'true']).get('true')).toBe(labelColors(['true']).get('true'));
});

test('a clash inside one chart probes forward to the next free slot', () => {
  const first = 'a';
  const clash = Array.from({ length: 5000 }, (_, i) => `k${i}`).find((k) => labelSlot(k) === labelSlot(first))!;
  const c = labelColors([first, clash]);
  expect(c.get(first)).toBe(slotColor(labelSlot(first)));
  expect(c.get(clash)).toBe(slotColor((labelSlot(first) + 1) % LABEL_COLORS));
});

test('twelve labels get twelve distinct colours; later ones reuse their hash slot', () => {
  const keys = Array.from({ length: 20 }, (_, i) => `v${i}`);
  const c = labelColors(keys);
  expect(new Set(keys.slice(0, 12).map((k) => c.get(k))).size).toBe(12);
  for (const k of keys.slice(12)) expect(c.get(k)).toBe(slotColor(labelSlot(k)));
});
