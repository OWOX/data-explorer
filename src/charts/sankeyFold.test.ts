import type { Field } from '../model/types';
import { BLANK_KEY, OTHER_KEY } from './blank';
import { measureKey, SANKEY_FLOW_LIMIT, type Measure } from './queries';
import { foldColumn, foldSankey } from './sankeyFold';

const fld = (name: string): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false });
const [a, b, c] = [fld('a'), fld('b'), fld('c')];
const sum: Measure = { kind: 'metric', metric: { field: { ...fld('amount'), type: 'FLOAT', category: 'number' }, fn: 'SUM' } };
const K = measureKey(sum);
const row = (o: Record<string, unknown>, v: unknown) => ({ ...o, [K]: v });
const names = (n: number) => Array.from({ length: n }, (_, i) => `v${String(i).padStart(2, '0')}`);

test('a column lists blank first, the top 8 by total, then Other (grand total minus listed and blank)', () => {
  const rows = [row({ a: 'x' }, 1), ...names(10).map((v, i) => row({ a: v }, 100 - i)), row({ a: null }, 7)];
  const { nodes } = foldColumn(rows as never, a, sum);
  expect(nodes.map((n) => n.key)).toEqual([BLANK_KEY, ...names(8), OTHER_KEY]);
  expect(nodes[0]!.value).toBe(7);
  expect(nodes.at(-1)!.value).toBe(92 + 91 + 1);
  const grand = rows.reduce((s, r) => s + Number(r[K]), 0);
  expect(nodes.reduce((s, n) => s + n.value, 0)).toBe(grand);
});

test('zero totals are not nodes and there is no Other when nothing is left over', () => {
  const { nodes } = foldColumn([row({ a: 'x' }, 3), row({ a: 'y' }, 0), row({ a: null }, 0)] as never, a, sum);
  expect(nodes).toEqual([{ key: 'x', value: 3 }]);
});

test('flows are summed per adjacent pair, with listed values, blank and Other mapped per column', () => {
  const tops = names(9); // v08 is Other in column a
  const colA = tops.map((v, i) => row({ a: v }, 100 - i));
  const colB = [row({ b: 'p' }, 60), row({ b: 'q' }, 30), row({ b: null }, 10)];
  const flowRows = [
    row({ a: 'v00', b: 'p' }, 40), row({ a: 'v00', b: 'p' }, 5), row({ a: 'v00', b: null }, 3),
    row({ a: 'v08', b: 'q' }, 4), row({ a: 'v08', b: 'q' }, 6), row({ a: null, b: 'p' }, 0),
  ];
  const d = foldSankey({ flowRows: flowRows as never, columnRows: [colA, colB] as never, dims: [a, b], measure: sum });
  expect(d.flows).toHaveLength(1);
  const f = (s: string, t: string) => d.flows[0]!.find((x) => x.source === s && x.target === t)?.value;
  expect(f('v00', 'p')).toBe(45);
  expect(f('v00', BLANK_KEY)).toBe(3);
  expect(f(OTHER_KEY, 'q')).toBe(10);
  expect(d.flows[0]).toHaveLength(3); // the zero flow is not drawn
  expect(d.columns[0]!.at(-1)).toEqual({ key: OTHER_KEY, value: 92 });
  expect(d.negative).toBe(false);
  expect(d.capped).toBe(false);
  expect(d.empty).toBe(false);
});

test('flows keep their first-column origin across later pairs', () => {
  const col = (k: string, vals: [string, number][]) => vals.map(([v, n]) => row({ [k]: v }, n));
  const flowRows = [row({ a: 'x', b: 'p', c: 'm' }, 5), row({ a: 'y', b: 'p', c: 'm' }, 2), row({ a: 'y', b: 'p', c: 'n' }, 1), row({ a: null, b: 'p', c: 'm' }, 4)];
  const d = foldSankey({ flowRows: flowRows as never, columnRows: [col('a', [['x', 5], ['y', 3]]).concat(row({ a: null }, 4)), col('b', [['p', 12]]), col('c', [['m', 11], ['n', 1]])] as never, dims: [a, b, c], measure: sum });
  const pair1 = d.flows[1]!;
  expect(pair1.find((f) => f.origin === 'x' && f.target === 'm')!.value).toBe(5);
  expect(pair1.find((f) => f.origin === 'y' && f.target === 'm')!.value).toBe(2);
  expect(pair1.find((f) => f.origin === 'y' && f.target === 'n')!.value).toBe(1);
  expect(pair1.find((f) => f.origin === BLANK_KEY)!.value).toBe(4);
  expect(pair1.reduce((s, f) => s + f.value, 0)).toBe(12);
  expect(d.flows[0]!.every((f) => f.origin === f.source)).toBe(true);
});

test('a flow read at its row cap is flagged, node sizes still come from the column totals', () => {
  const flowRows = Array.from({ length: SANKEY_FLOW_LIMIT }, () => row({ a: 'x', b: 'p' }, 1));
  const d = foldSankey({ flowRows: flowRows as never, columnRows: [[row({ a: 'x' }, 9000)], [row({ b: 'p' }, 8000)]] as never, dims: [a, b], measure: sum });
  expect(d.capped).toBe(true);
  expect(d.columns[0]).toEqual([{ key: 'x', value: 9000 }]);
  expect(d.flows[0]![0]!.value).toBe(SANKEY_FLOW_LIMIT);
});

test('a negative flow or column total is flagged', () => {
  const ok = [[row({ a: 'x' }, 5)], [row({ b: 'p' }, 5)]] as never;
  expect(foldSankey({ flowRows: [row({ a: 'x', b: 'p' }, -1)] as never, columnRows: ok, dims: [a, b], measure: sum }).negative).toBe(true);
  expect(foldSankey({ flowRows: [row({ a: 'x', b: 'p' }, 5)] as never, columnRows: [[row({ a: 'x' }, -5)], [row({ b: 'p' }, 5)]] as never, dims: [a, b], measure: sum }).negative).toBe(true);
});

test('no rows, or only zero flows, is empty', () => {
  const cols = [[row({ a: 'x' }, 1)], [row({ b: 'p' }, 1)]] as never;
  expect(foldSankey({ flowRows: [], columnRows: cols, dims: [a, b], measure: sum }).empty).toBe(true);
  expect(foldSankey({ flowRows: [row({ a: 'x', b: 'p' }, 0)] as never, columnRows: cols, dims: [a, b], measure: sum }).empty).toBe(true);
  expect(foldSankey({ flowRows: [row({ a: 'x', b: 'p' }, 1)] as never, columnRows: [[], []], dims: [a, b], measure: sum }).empty).toBe(true);
});
