import { BLANK_KEY, OTHER_KEY } from './blank';
import { labelColors } from './labelColor';
import { layoutSankey, NODE_GAP, REST_ORIGIN, type Flow } from './sankeyLayout';

const flows: Flow[][] = [
  [{ source: 'a', target: 'x', value: 5 }, { source: 'a', target: 'y', value: 3 }, { source: 'b', target: 'y', value: 4 }, { source: BLANK_KEY, target: 'x', value: 2 }, { source: OTHER_KEY, target: 'y', value: 1 }, { source: 'b', target: OTHER_KEY, value: 2 }],
  [{ source: 'x', target: 'z', value: 10 }, { source: 'y', target: 'z', value: 3 }],
];
const lay = layoutSankey({ flows, width: 600, padRight: 100, height: 200 });
const col = (c: number) => lay.nodes.filter((n) => n.col === c);

test('nodes run blank first, then by size, Other last', () => {
  expect(col(0).map((n) => n.key)).toEqual([BLANK_KEY, 'a', 'b', OTHER_KEY]);
  expect(col(1).map((n) => n.key)).toEqual(['x', 'y', OTHER_KEY]);
  expect(col(2).map((n) => n.key)).toEqual(['z']);
});

test('a node is as tall as the larger of what flows in and out, on one scale', () => {
  const x = col(1).find((n) => n.key === 'x')!; // in 7, out 10
  const y = col(1).find((n) => n.key === 'y')!; // in 8, out 3
  expect(x.value).toBe(10);
  expect(y.value).toBe(8);
  expect(x.h / y.h).toBeCloseTo(10 / 8);
  const a = col(0).find((n) => n.key === 'a')!;
  expect(a.h / x.h).toBeCloseTo(8 / 10);
});

test('nodes of a column do not overlap and keep a gap, inside the height', () => {
  for (let c = 0; c < 3; c++) {
    const nodes = col(c);
    nodes.slice(1).forEach((n, i) => expect(n.y).toBeGreaterThanOrEqual(nodes[i]!.y + nodes[i]!.h + NODE_GAP - 1e-6));
    const last = nodes.at(-1)!;
    expect(last.y + last.h).toBeLessThanOrEqual(lay.height + 1e-6);
  }
});

test('columns are evenly spaced and the last keeps room for its labels', () => {
  const xs = [0, 1, 2].map((c) => col(c)[0]!.x);
  expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  expect(xs[2]! + 12).toBeLessThanOrEqual(500 + 1e-6);
});

test('ribbon slots follow the opposite node rank, do not overlap on a node, and fit it', () => {
  for (const node of lay.nodes) {
    for (const side of ['out', 'in'] as const) {
      const links = lay.links.filter((l) => (side === 'out' ? l.pair === node.col && l.source === node.key : l.pair === node.col - 1 && l.target === node.key));
      const spans = links.map((l) => [side === 'out' ? l.y0 : l.y1, l.w] as const).sort((p, q) => p[0] - q[0]);
      spans.forEach(([y, w], i) => {
        expect(y).toBeGreaterThanOrEqual(node.y - 1e-6);
        expect(y + w).toBeLessThanOrEqual(node.y + node.h + 1e-6);
        if (i > 0) expect(y).toBeGreaterThanOrEqual(spans[i - 1]![0] + spans[i - 1]![1] - 1e-6);
      });
    }
  }
  // Leaving node a: its ribbon to x (rank 0) sits above its ribbon to y (rank 1).
  const toX = lay.links.find((l) => l.source === 'a' && l.target === 'x')!;
  const toY = lay.links.find((l) => l.source === 'a' && l.target === 'y')!;
  expect(toX.y0).toBeLessThan(toY.y0);
  // Entering y: a (rank 1) above b (rank 2) above Other.
  const intoY = lay.links.filter((l) => l.pair === 0 && l.target === 'y').sort((p, q) => p.y1 - q.y1).map((l) => l.source);
  expect(intoY).toEqual(['a', 'b', OTHER_KEY]);
});

test('ribbon width is proportional to value, drawn as a closed filled path', () => {
  const p = lay.links.find((l) => l.source === 'a' && l.target === 'x')!;
  const q = lay.links.find((l) => l.source === 'a' && l.target === 'y')!;
  expect(p.w / q.w).toBeCloseTo(5 / 3);
  expect(p.path.startsWith('M')).toBe(true);
  expect(p.path.endsWith('Z')).toBe(true);
  expect(p.path.match(/C/g)).toHaveLength(2);
});

test('colour: every node takes its label colour, blank and Other keep their own, a ribbon takes its origin node colour', () => {
  // All columns share one palette, so a clash probes forward: colours come from every key in column order.
  const own = (k: string, keys: string[] = ['a', 'b', 'x', 'y']) => ({ kind: 'series', color: labelColors(keys).get(k) });
  expect(col(0).map((n) => n.tone)).toEqual([{ kind: 'blank' }, own('a'), own('b'), { kind: 'other' }]);
  expect(col(1).find((n) => n.key === 'x')!.tone).toEqual(own('x'));
  expect(col(1).find((n) => n.key === 'y')!.tone).toEqual(own('y'));
  expect(lay.links.find((l) => l.source === 'b' && l.target === 'y')!.tone).toEqual(own('b'));
});

test('empty flows lay out nothing', () => {
  expect(layoutSankey({ flows: [[]], width: 300 })).toMatchObject({ nodes: [], links: [] });
});

test('exact column totals set node heights; ribbons never outgrow their node', () => {
  const f: Flow[][] = [[{ source: 'a', target: 'x', value: 2 }]];
  const l = layoutSankey({ flows: f, columns: [[{ key: 'a', value: 10 }, { key: 'b', value: 5 }, { key: 'z', value: 0 }], [{ key: 'x', value: 1 }]], width: 400, height: 200 });
  const node = (c: number, k: string) => l.nodes.find((n) => n.col === c && n.key === k)!;
  expect(node(0, 'a').value).toBe(10);
  expect(node(0, 'b').value).toBe(5); // a node with no flow is still drawn at its total
  expect(l.nodes.some((n) => n.key === 'z')).toBe(false);
  expect(node(1, 'x').value).toBe(2); // the flow into it is larger than its total: never shorter than its ribbons
  expect(node(0, 'a').h / node(0, 'b').h).toBeCloseTo(2);
});

test('a ribbon is coloured by its first-column origin in every pair', () => {
  const f: Flow[][] = [
    [{ source: 'a', target: 'x', value: 3, origin: 'a' }, { source: 'b', target: 'x', value: 2, origin: 'b' }],
    [{ source: 'x', target: 'z', value: 3, origin: 'a' }, { source: 'x', target: 'z', value: 2, origin: 'b' }],
  ];
  const l = layoutSankey({ flows: f, width: 600, height: 200 });
  const tone = (pair: number, origin: string) => l.links.find((k) => k.pair === pair && k.origin === origin)!.tone;
  expect(tone(1, 'a')).toEqual(tone(0, 'a'));
  expect(tone(1, 'b')).toEqual(tone(0, 'b'));
  expect(tone(1, 'a')).not.toEqual(tone(1, 'b'));
});

test('a width narrower than the label padding gives a step of 0, never negative', () => {
  const l = layoutSankey({ flows, width: 0, padRight: 100, height: 200 });
  expect(l.nodes.every((n) => n.x >= 0)).toBe(true);
  expect(l.links.every((k) => Number.isFinite(k.x1))).toBe(true);
});

test('a real value fed only by a blank origin takes a series slot of its own, not the blank grey', () => {
  const l = layoutSankey({ flows: [
    [{ source: BLANK_KEY, target: 'x', value: 10 }, { source: 'a', target: 'y', value: 5 }],
    [{ source: 'x', target: 'z', value: 10, origin: BLANK_KEY }, { source: 'y', target: 'z', value: 5, origin: 'a' }],
  ], width: 600, height: 200 });
  const tone = (c: number, k: string) => l.nodes.find((n) => n.col === c && n.key === k)!.tone;
  expect(tone(0, BLANK_KEY)).toEqual({ kind: 'blank' });
  expect(tone(1, 'x')).toMatchObject({ kind: 'series' });
  expect(tone(1, 'x')).not.toEqual(tone(0, 'a'));
  expect(tone(1, 'y')).not.toEqual(tone(0, 'a'));
  expect(tone(1, 'y')).not.toEqual(tone(1, 'x'));
});

test('small ribbons of one (source, target) merge into one rest ribbon; the total and big ribbons stay', () => {
  const small: Flow[] = Array.from({ length: 50 }, (_, i) => ({ source: 'x', target: 'z', value: 1, origin: `o${i}` }));
  const l = layoutSankey({ flows: [
    [{ source: 'big', target: 'x', value: 5000 }, ...small.map((f) => ({ source: f.origin!, target: 'x', value: 1 }))],
    [{ source: 'x', target: 'z', value: 5000, origin: 'big' }, ...small],
  ], width: 600, height: 300 });
  const pair1 = l.links.filter((k) => k.pair === 1);
  expect(pair1).toHaveLength(2);
  expect(pair1.find((k) => k.origin === REST_ORIGIN)!.value).toBe(50);
  expect(pair1.find((k) => k.origin === 'big')!.value).toBe(5000);
  // Node sizes still come from every flow.
  expect(l.nodes.find((n) => n.col === 1 && n.key === 'x')!.value).toBe(5050);
});

test('a lone small ribbon keeps its origin', () => {
  const l = layoutSankey({ flows: [[{ source: 'big', target: 'x', value: 5000 }, { source: 'a', target: 'x', value: 1 }], [{ source: 'x', target: 'z', value: 5000, origin: 'big' }, { source: 'x', target: 'z', value: 1, origin: 'a' }]], width: 600, height: 300 });
  expect(l.links.filter((k) => k.pair === 1).map((k) => k.origin).sort()).toEqual(['a', 'big']);
});

describe('fit (fan-out): ribbons are scaled to fit their node', () => {
  const fan: Flow[][] = [[{ source: 'a', target: 'x', value: 8, origin: 'a' }, { source: 'a', target: 'y', value: 8, origin: 'a' }, { source: 'b', target: 'y', value: 2, origin: 'b' }]];
  const columns = [[{ key: 'a', value: 10 }, { key: 'b', value: 2 }], [{ key: 'x', value: 8 }, { key: 'y', value: 10 }]];
  const withFit = layoutSankey({ flows: fan, columns, width: 400, height: 200, fit: true });
  const node = (l: typeof withFit, c: number, k: string) => l.nodes.find((n) => n.col === c && n.key === k)!;

  it('sizes a node by its column total and keeps the outgoing ribbons inside it', () => {
    const a = node(withFit, 0, 'a');
    expect(a.value).toBe(10);
    const out = withFit.links.filter((l) => l.source === 'a');
    expect(out.reduce((s, l) => s + l.w, 0)).toBeCloseTo(a.h);
    const y = node(withFit, 1, 'y');
    expect(withFit.links.filter((l) => l.target === 'y').reduce((s, l) => s + l.w1, 0)).toBeCloseTo(y.h);
  });

  it('leaves a node whose ribbons already fit alone', () => {
    const x = node(withFit, 1, 'x');
    const l = withFit.links.find((k) => k.target === 'x')!;
    expect(l.w1).toBeCloseTo(x.h);
    const b = withFit.links.find((k) => k.source === 'b')!;
    expect(b.w).toBeCloseTo(node(withFit, 0, 'b').h);
  });

  it('without fit a node grows to hold its ribbons and nothing is scaled', () => {
    const plain = layoutSankey({ flows: fan, columns, width: 400, height: 200 });
    expect(node(plain, 0, 'a').value).toBe(16);
    expect(plain.links.every((l) => l.w === l.w1)).toBe(true);
  });

  it('colours a ribbon with no origin by its source node, and every node by its own label', () => {
    const two: Flow[][] = [[{ source: 'a', target: 'x', value: 5, origin: 'a' }, { source: 'b', target: 'y', value: 4, origin: 'b' }], [{ source: 'x', target: 'm', value: 5 }, { source: 'y', target: 'n', value: 4 }]];
    const l = layoutSankey({ flows: two, width: 400, height: 200, fit: true });
    const tone = (c: number, k: string) => l.nodes.find((n) => n.col === c && n.key === k)!.tone;
    // The old rule handed a column-0 colour down; now a later node is not tied to the node that feeds it.
    for (const k of ['a', 'b']) expect(tone(0, k)).toEqual({ kind: 'series', color: labelColors(['a', 'b']).get(k) });
    expect(l.nodes.filter((n) => n.col > 0).map((n) => n.tone)).toHaveLength(4);
    expect(new Set(l.nodes.map((n) => (n.tone as { color: string }).color)).size).toBe(6);
    const ribbon = l.links.find((k) => k.pair === 1 && k.source === 'y')!;
    expect(ribbon.tone).toEqual(tone(1, 'y'));
    expect(ribbon.origin).toBeUndefined();
  });
});

test('the same label gets the same colour in a Sankey node as in a pie or a stack (labelColors)', () => {
  const l = layoutSankey({ flows: [[{ source: 'true', target: 'OWOX BI', value: 3 }]], width: 400, height: 200 });
  const pie = labelColors(['true']);
  const stack = labelColors(['OWOX BI']);
  expect(l.nodes.find((n) => n.key === 'true')!.tone).toEqual({ kind: 'series', color: pie.get('true') });
  expect(l.nodes.find((n) => n.key === 'OWOX BI')!.tone).toEqual({ kind: 'series', color: stack.get('OWOX BI') });
});
