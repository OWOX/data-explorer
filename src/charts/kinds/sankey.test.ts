import type { ChartFields } from '../fields';
import { KINDS } from './index';
import { heatmap } from './heatmap';
import { sankeyMeasures } from '../fields';
import { sankey, sankeyWidth, setColumn, withColumns } from './sankey';

const dim = (name: string) => ({ name, category: 'string', type: 'STRING' }) as never;
const [a, b, c, d, e, g] = ['a', 'b', 'c', 'd', 'e', 'g'].map(dim) as [never, never, never, never, never, never];
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const mk = (dims: never[], metrics = [{ field: amount, fn: 'SUM' as const }]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics, dates: [], dimensions: dims }], dates: [], dimensions: dims, counter: null });

test('sankey: sits right after Heatmap, with an icon of its own', () => {
  const keys = Object.keys(KINDS);
  expect(keys[keys.indexOf('heatmap') + 1]).toBe('sankey');
  expect(new Set(Object.values(KINDS).map((k) => k.icon)).size).toBe(keys.length);
  expect(sankey.label).toBe('Sankey');
});

test('sankey: eligible with two dimensions and an additive measure', () => {
  expect(sankey.eligible(mk([a, b]))).toBe(true);
  expect(sankey.eligible(mk([a]))).toBe(false);
  expect(sankey.eligible(mk([a, b], []))).toBe(false);
});

test('sankey create: the first two dimensions, or the ones a heatmap / pie / bar had', () => {
  expect(sankey.create(mk([a, b, c]))).toEqual({ kind: 'sankey', dimensions: ['a', 'b'] });
  expect(sankey.create(mk([a, b, c]), { id: 'h', kind: 'heatmap', measure: 'amount', dimension: 'c', dimension2: 'b' })).toEqual({ kind: 'sankey', measure: 'amount', dimensions: ['c', 'b'] });
  expect(sankey.create(mk([a, b, c]), { id: 'p', kind: 'pie', dimension: 'c' })).toEqual({ kind: 'sankey', dimensions: ['c', 'a'] });
  expect(sankey.create(mk([a, b, c, d]), { id: 'b', kind: 'bar', dimension: 'c', stack: 'd' })).toEqual({ kind: 'sankey', dimensions: ['c', 'd'] });
});

test('sankey resolve: saved columns, missing ones replaced by unused dimensions, 2 to 5 columns', () => {
  const cf = mk([a, b, c, d, e, g]);
  expect(sankey.resolve({ id: 's', kind: 'sankey' }, cf)!.dims).toEqual([a, b]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['c', 'x', 'a'] }, cf)!.dims).toEqual([c, a, b]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['c', 'c', 'a'] }, cf)!.dims).toEqual([c, a, b]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a'] }, cf)!.dims).toEqual([a]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a', 'b', 'c', 'd', 'e', 'g'] }, cf)!.dims).toHaveLength(5);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a', 'b', 'c'] }, mk([a, b]))!.dims).toEqual([a, b]);
  expect(sankey.resolve({ id: 's', kind: 'sankey' }, mk([a]))).toBeNull();
  expect(sankey.resolve({ id: 's', kind: 'sankey' }, mk([a, b], []))).toBeNull();
  expect(sankey.title(sankey.resolve({ id: 's', kind: 'sankey' }, cf)!, cf)).toBe('amount · Sum by a → b');
});

test('switching from a sankey to a heatmap keeps its first two columns', () => {
  expect(heatmap.create(mk([a, b]), { id: 's', kind: 'sankey', dimensions: ['b', 'a'], dimension: 'b', dimension2: 'a' })).toMatchObject({ dimension: 'b', dimension2: 'a' });
});

test('sankey columns: a new column takes the next unused dimension; picking a held one swaps', () => {
  expect(withColumns(['b', 'a'], 3, [a, b, c])).toEqual(['b', 'a', 'c']);
  expect(withColumns(['a', 'b', 'c'], 2, [a, b, c])).toEqual(['a', 'b']);
  expect(setColumn(['a', 'b', 'c'], 0, 'c')).toEqual(['c', 'b', 'a']);
  expect(setColumn(['a', 'b'], 1, 'd')).toEqual(['a', 'd']);
});

test('sankey is wider with more columns', () => {
  expect(sankeyWidth(3)).toBe('clamp(20rem, 60rem, 100%)');
});

const j = (name: string) => ({ name, category: 'string', type: 'STRING', joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }) as never;
const ltv = { name: 'c__ltv', category: 'number', type: 'NUMERIC', joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } } as never;
const two = (hasPk: boolean): ChartFields => ({
  marts: [
    { aliasPath: '', recordsId: 'records:M', title: '', hasPk, metrics: [{ field: amount, fn: 'SUM' }], dates: [], dimensions: [a, b] },
    { aliasPath: 'c', recordsId: 'records:C', title: '', hasPk: true, metrics: [{ field: ltv, fn: 'SUM' }], dates: [], dimensions: [j('c__x'), j('c__y')] },
  ], dates: [], dimensions: [a, b, j('c__x'), j('c__y')], counter: null,
});

test('sankey resolve: any additive measure is offered; exact only when no join can repeat a record; a saved choice is kept (never written back)', () => {
  const cf = two(true);
  const spec = { id: 's', kind: 'sankey' as const, measure: 'records', dimensions: ['a', 'b'] };
  const own = sankey.resolve(spec, cf)!;
  expect(own.measure).toMatchObject({ kind: 'records', aliasPath: '' });
  expect(own.exact).toBe(true);
  // A column of another mart: the saved main-mart measure stays, in fan-out mode.
  const mixed = sankey.resolve({ ...spec, dimensions: ['a', 'c__x'] }, cf)!;
  expect(mixed.measure).toMatchObject({ kind: 'records', aliasPath: '' });
  expect(mixed.exact).toBe(false);
  expect(spec.measure).toBe('records');
  // Nothing saved: a measure that is exact for the columns comes first (the joined mart's own), else the first metric.
  expect(sankey.resolve({ ...spec, measure: undefined, dimensions: ['c__x', 'c__y'] }, cf)!).toMatchObject({ exact: true, measure: { kind: 'metric', metric: { field: { name: 'c__ltv' } } } });
  const none = sankey.resolve({ ...spec, measure: undefined, dimensions: ['a', 'c__x'] }, cf)!;
  expect(none.exact).toBe(false);
  expect(none.measure).toMatchObject({ kind: 'metric', metric: { field: { name: 'amount' } } });
  expect(sankey.eligible(cf)).toBe(true);
});

test('sankey: a new or filled column prefers the first column\'s mart', () => {
  const cf = two(false);
  expect(withColumns(['c__x'], 2, cf.dimensions)).toEqual(['c__x', 'c__y']);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['c__y', 'zz'] }, cf)!.dims.map((d) => d.name)).toEqual(['c__y', 'c__x']);
});

test('sankey setColumn: an unused column appends, a held name moves to the end, None removes and the rest move up, down to none', () => {
  // Appends: 1, 2, 5 becomes 1, 2, 3 because the saved list has no gaps.
  expect(setColumn(['a', 'b'], 4, 'd')).toEqual(['a', 'b', 'd']);
  expect(setColumn(['a', 'b', 'c'], 3, 'd')).toEqual(['a', 'b', 'c', 'd']);
  expect(setColumn([], 3, 'd')).toEqual(['d']);
  // A dimension another column holds moves to the end of an unused column: no duplicate, no gap.
  expect(setColumn(['a', 'b', 'c'], 4, 'a')).toEqual(['b', 'c', 'a']);
  // In a used column the two swap, as before.
  expect(setColumn(['a', 'b', 'c'], 0, 'c')).toEqual(['c', 'b', 'a']);
  // None on a used column takes it out, at any count: a Sankey with fewer than two columns is only misconfigured, not refused.
  expect(setColumn(['a', 'b', 'c', 'd'], 1, '')).toEqual(['a', 'c', 'd']);
  expect(setColumn(['a', 'b', 'c'], 2, '')).toEqual(['a', 'b']);
  expect(setColumn(['a', 'b'], 0, '')).toEqual(['b']);
  expect(setColumn(['b'], 0, '')).toEqual([]);
  // None on an unused column or the column's own dimension changes nothing.
  expect(setColumn(['a', 'b', 'c'], 4, '')).toEqual(['a', 'b', 'c']);
  expect(setColumn([], 0, '')).toEqual([]);
  expect(setColumn(['a', 'b', 'c'], 1, 'b')).toEqual(['a', 'b', 'c']);
});

test('sankey: fewer than two columns is a saved choice; no saved columns at all still fills in two', () => {
  const cf = mk([a, b, c]);
  const dimsOf = (dimensions?: string[]) => sankey.resolve({ id: 's', kind: 'sankey', ...(dimensions ? { dimensions } : {}) }, cf)!.dims;
  expect(dimsOf()).toEqual([a, b]);
  expect(dimsOf([])).toEqual([]);
  expect(dimsOf(['c'])).toEqual([c]);
  // A saved dimension that is not shown and has no fallback counts as not used.
  expect(dimsOf(['x'])).toEqual([]);
  // It stays resolvable with fewer than two dimensions shown, so the notice can say what is wrong.
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: [] }, mk([a]))!.dims).toEqual([]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a'] }, mk([a]))!.dims).toEqual([a]);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: [] }, mk([a, b], []))).toBeNull();
  // Two or more saved columns behave as before: the chart needs two shown dimensions.
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a', 'b'] }, mk([a]))).toBeNull();
  const none = sankey.resolve({ id: 's', kind: 'sankey', dimensions: [] }, cf)!;
  expect(none.measure).toMatchObject({ kind: 'metric' });
  expect(sankeyMeasures(cf, [])).toHaveLength(1);
});

test('sankey title: the measure and the columns it has, one or none', () => {
  const cf = mk([a, b]);
  const title = (dimensions: string[]) => sankey.title(sankey.resolve({ id: 's', kind: 'sankey', dimensions }, cf)!, cf);
  expect(title(['a', 'b'])).toBe('amount · Sum by a → b');
  expect(title(['b'])).toBe('amount · Sum by b');
  // With no column it is named apart from the scorecard of the same measure, which has the bare measure label.
  expect(title([])).toBe('Sankey · amount · Sum');
});

test('sankey create: a Sankey switched to a Sankey keeps its columns, none included', () => {
  expect(sankey.create(mk([a, b, c]), { id: 's', kind: 'sankey', dimensions: [] })).toEqual({ kind: 'sankey', dimensions: [] });
  expect(sankey.create(mk([a, b, c]), { id: 's', kind: 'sankey', dimensions: ['c'] })).toEqual({ kind: 'sankey', dimensions: ['c'] });
});
