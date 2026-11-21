import type { ChartFields } from '../fields';
import { KINDS } from './index';
import { heatmap } from './heatmap';
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
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['a'] }, cf)!.dims).toHaveLength(2);
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
  expect(sankeyWidth(3)).toBe('clamp(20rem, 33rem, 100%)');
});

const j = (name: string) => ({ name, category: 'string', type: 'STRING', joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }) as never;
const ltv = { name: 'c__ltv', category: 'number', type: 'NUMERIC', joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } } as never;
const two = (hasPk: boolean): ChartFields => ({
  marts: [
    { aliasPath: '', recordsId: 'records:M', title: '', hasPk, metrics: [{ field: amount, fn: 'SUM' }], dates: [], dimensions: [a, b] },
    { aliasPath: 'c', recordsId: 'records:C', title: '', hasPk: true, metrics: [{ field: ltv, fn: 'SUM' }], dates: [], dimensions: [j('c__x'), j('c__y')] },
  ], dates: [], dimensions: [a, b, j('c__x'), j('c__y')], counter: null,
});

test('sankey resolve: a saved Count Unique is kept on its own mart and falls back to a metric when a column comes from another mart (never written back)', () => {
  const cf = two(true);
  const spec = { id: 's', kind: 'sankey' as const, measure: 'records', dimensions: ['a', 'b'] };
  expect(sankey.resolve(spec, cf)!.measure).toMatchObject({ kind: 'records', aliasPath: '' });
  const mixed = sankey.resolve({ ...spec, dimensions: ['a', 'c__x'] }, cf)!;
  expect(mixed.measure).toBeNull();
  expect(spec.measure).toBe('records');
  // Columns of the joined mart: its own measures only, the saved main-mart one is replaced for display.
  const own = sankey.resolve({ ...spec, dimensions: ['c__x', 'c__y'] }, cf)!;
  expect(own.measure).toMatchObject({ kind: 'metric', metric: { field: { name: 'c__ltv' } } });
});

test('sankey: a new or filled column prefers the first column\'s mart', () => {
  const cf = two(false);
  expect(withColumns(['c__x'], 2, cf.dimensions)).toEqual(['c__x', 'c__y']);
  expect(sankey.resolve({ id: 's', kind: 'sankey', dimensions: ['c__y'] }, cf)!.dims.map((d) => d.name)).toEqual(['c__y', 'c__x']);
});
