import { expect, test } from 'vitest';
import { columnColors, LABEL_COLORS, labelColors, labelSlot, slotColor } from './labelColor';

test('a label hashes to the same slot every time, inside the palette', () => {
  expect(labelSlot('true')).toBe(labelSlot('true'));
  for (const t of ['', 'true', 'false', 'OWOX BI', '42', 'ünï']) {
    expect(labelSlot(t)).toBeGreaterThanOrEqual(0);
    expect(labelSlot(t)).toBeLessThan(LABEL_COLORS);
  }
  expect(labelSlot('')).toBe((0x811c9dc5 + 11) % LABEL_COLORS);
  expect(labelSlot('OWOX Data Marts')).toBe(0);
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

test('letter case does not change a colour: "new" and "New" match across charts and inside one', () => {
  for (const [a, b] of [['new', 'New'], ['OWOX BI', 'owox bi'], ['ünï', 'ÜNÏ']] as const) {
    expect(labelSlot(a)).toBe(labelSlot(b));
    expect(labelColors([a]).get(a)).toBe(labelColors([b]).get(b));
    const both = labelColors([a, b]);
    expect(both.get(a)).toBe(both.get(b));
  }
});

test('case variants of one label hold one slot, so they do not push another label off its own', () => {
  const keys = Array.from({ length: 11 }, (_, i) => `v${i}`);
  const c = labelColors(['new', 'New', 'NEW', ...keys]);
  expect(new Set(keys.map((k) => c.get(k))).size).toBe(11);
  expect(keys.map((k) => c.get(k))).not.toContain(c.get('new'));
});

const find = (pred: (k: string) => boolean, prefix = 'k') => Array.from({ length: 20000 }, (_, i) => `${prefix}${i}`).find(pred)!;

test('labels that meet in a later column only still get different colours', () => {
  expect(labelSlot('p6')).toBe(labelSlot('q1'));
  const c = columnColors([['p6'], ['q1'], ['p6', 'q1']]);
  expect(c.get('p6')).not.toBe(c.get('q1'));
});

test('two labels that share a hash slot but never share a column both keep it', () => {
  const clash = find((k) => labelSlot(k) === labelSlot('new'));
  const c = columnColors([['new'], [clash]]);
  expect(c.get('new')).toBe(slotColor(labelSlot('new')));
  expect(c.get(clash)).toBe(slotColor(labelSlot('new')));
});

test('a label in two columns, in different letter case, has one colour', () => {
  const clash = find((k) => labelSlot(k) === labelSlot('new'));
  const c = columnColors([[clash, 'new'], ['New']]);
  expect(c.get('New')).toBe(c.get('new'));
  expect(c.get('new')).not.toBe(c.get(clash));
});

test('a carried label does not collide with a label of the column it joins', () => {
  const clash = find((k) => labelSlot(k) === labelSlot('new'));
  const pushed = (labelSlot('new') + 1) % LABEL_COLORS;
  const y = find((k) => labelSlot(k) === pushed && k !== clash, 'y');
  const c = columnColors([[clash, 'new'], [y, 'New']]);
  expect(c.get('New')).toBe(c.get('new'));
  expect(c.get(y)).not.toBe(c.get('New'));
});

test('labelColors(keys) is columnColors([keys])', () => {
  const keys = Array.from({ length: 15 }, (_, i) => `v${i}`);
  expect([...labelColors(keys)]).toEqual([...columnColors([keys])]);
});

test('a column of more than twelve labels terminates and its first twelve are distinct', () => {
  const keys = Array.from({ length: 30 }, (_, i) => `w${i}`);
  const c = columnColors([keys]);
  expect(new Set(keys.slice(0, 12).map((k) => c.get(k))).size).toBe(12);
  expect(c.size).toBe(30);
});
