import type { Edge, Mart, Model, Source } from '../model/types';
import type { Selection } from '../state/store';
import { NO_CONTEXT } from './contexts';
import { computeVisible, inboundCounts, neighbours, pickFocus } from './visible';

const e = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target, joins: [] });
const mart = (id: string, extra: Partial<Mart> = {}): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null, ...extra });
const modelOf = (ids: string[], edges: Edge[], extra: Partial<Mart>[] = [], sources: Source[] = []): Model => ({
  marts: new Map(ids.map((id, i) => [id, mart(id, extra[i] ?? {})])),
  sources,
  edges,
  contexts: [],
  storages: [], failedStorages: [],
});
const sel = (patch: Partial<Selection> = {}): Selection => ({ sourceKey: null, martId: null, record: null, ...patch });
const run = (model: Model, selection: Selection, search = '', contextIds: string[] | null = null) =>
  computeVisible({ model, selection, search, contextIds });

test('inboundCounts counts targets', () => {
  expect(inboundCounts([e('a', 'b'), e('c', 'b'), e('b', 'd')])).toEqual(new Map([['b', 2], ['d', 1]]));
});

test('pickFocus picks the most inbound, ties by title', () => {
  const marts = new Map([['x', mart('x', { title: 'Zeta' })], ['y', mart('y', { title: 'Alpha' })]]);
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 1], ['y', 1]]))).toBe('y');
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 2]]))).toBe('x');
  expect(pickFocus([], marts, new Map())).toBeNull();
});

test('neighbours returns inbound and outbound, without duplicates or itself', () => {
  expect(new Set(neighbours('b', [e('a', 'b'), e('b', 'c'), e('a', 'b'), e('b', 'b')]))).toEqual(new Set(['a', 'c']));
});

test('rule 4: nothing selected shows the focus mart and its neighbours, focus first', () => {
  const r = run(modelOf(['a', 'b', 'c', 'z'], [e('a', 'b'), e('c', 'b')]), sel());
  expect(r.focusId).toBe('b');
  expect(r.ids[0]).toBe('b');
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c']));
});

test('the focus mart is never one the member cannot open', () => {
  const r = run(modelOf(['a', 'b', 'c'], [e('a', 'b'), e('c', 'b')], [{}, { accessible: false }, {}]), sel());
  expect(r.focusId).toBe('a');
});

test('rule 2: a selected mart shows with every neighbour, no cap, ordered by inbound then title', () => {
  const edges = Array.from({ length: 30 }, (_, i) => e(`n${String(i).padStart(2, '0')}`, 'hub'));
  edges.push(e('n05', 'n01'));
  const r = run(modelOf(['hub', ...edges.slice(0, 30).map((x) => x.source)], edges), sel({ martId: 'hub' }));
  expect(r.ids).toHaveLength(31);
  expect(r.ids[0]).toBe('hub');
  expect(r.ids[1]).toBe('n01'); // the only neighbour with an inbound edge
  expect(r.ids.slice(2)).toEqual(r.ids.slice(2).sort());
});

test('rule 2: the selected mart comes first even with fewer inbound edges, and an inaccessible neighbour is included', () => {
  const r = run(modelOf(['a', 'b', 'c'], [e('a', 'b'), e('c', 'b'), e('b', 'a')], [{}, {}, { accessible: false }]), sel({ martId: 'a' }));
  expect(r.ids).toEqual(['a', 'b']);
  const r2 = run(modelOf(['a', 'b', 'c'], [e('a', 'b'), e('c', 'b')], [{}, {}, { accessible: false }]), sel({ martId: 'b' }));
  expect(r2.ids).toEqual(['b', 'a', 'c']);
});

test('rule 3: a source with no mart selected shows every mart it feeds', () => {
  const sources: Source[] = [{ key: 'Shopify', name: 'Shopify', logo: null, martIds: ['a', 'c'] }];
  const model = modelOf(['a', 'b', 'c'], [e('a', 'b')], [{ sourceKey: 'Shopify' }, {}, { sourceKey: 'Shopify' }], sources);
  expect(new Set(run(model, sel({ sourceKey: 'Shopify' })).ids)).toEqual(new Set(['a', 'c']));
});

test('rule 1: a search shows its matches, narrowed to the selected source, selected mart first', () => {
  const sources: Source[] = [{ key: 'S', name: 'S', logo: null, martIds: ['sales1', 'sales2'] }];
  const model = modelOf(['sales1', 'sales2', 'sales3', 'other'], [e('sales1', 'sales2')], [{ sourceKey: 'S' }, { sourceKey: 'S' }, {}, { sourceKey: 'S' }], sources);
  expect(new Set(run(model, sel(), 'SALES').ids)).toEqual(new Set(['sales1', 'sales2', 'sales3']));
  expect(run(model, sel({ sourceKey: 'S' }), 'sales').ids).toEqual(['sales2', 'sales1']);
  expect(run(model, sel({ martId: 'sales1' }), 'sales').ids[0]).toBe('sales1');
});

test('rule 1: search leaves out marts the member cannot open, and a search with no match is empty', () => {
  const model = modelOf(['sales1', 'sales2'], [], [{}, { accessible: false }]);
  expect(run(model, sel(), 'sales').ids).toEqual(['sales1']);
  expect(run(model, sel(), 'nope').ids).toEqual([]);
});

test('rule 1: a narrowed Contexts filter applies on its own, with "Without context" as one of its boxes', () => {
  const model = modelOf(['a', 'b', 'c'], [], [{ contextIds: ['c1'] }, {}, { contextIds: ['c2'] }]);
  expect(run(model, sel(), '', ['c1']).ids).toEqual(['a']);
  expect(run(model, sel(), '', [NO_CONTEXT]).ids).toEqual(['b']);
  expect(new Set(run(model, sel(), '', ['c1', NO_CONTEXT]).ids)).toEqual(new Set(['a', 'b']));
  expect(run(model, sel(), '', []).ids).toEqual([]);
  // every box ticked is no filter: rule 2 applies, so the selected mart alone (no edges)
  expect(run(model, sel({ martId: 'a' }), '', null).ids).toEqual(['a']);
});

test('rule 1: the search reads the title only, so a context name or a field name finds nothing', () => {
  const model: Model = { ...modelOf(['a', 'b'], [], [{ contextIds: ['c1'], title: 'Orders' }, { title: 'Customers' }]), contexts: [{ id: 'c1', name: 'Sales', icon: null }] };
  expect(run(model, sel(), 'sales').ids).toEqual([]);
  expect(run(model, sel(), 'ord').ids).toEqual(['a']);
});

test('a selected mart that is no longer in the model falls back to the focus mart', () => {
  const r = run(modelOf(['a', 'b'], [e('a', 'b')]), sel({ martId: 'gone' }));
  expect(r.ids[0]).toBe('b');
});

describe('storageIds', () => {
  // a, b in storage s1; c, d in s2. b joins a and c; d joins c.
  const edges = [e('b', 'a'), e('b', 'c'), e('d', 'c')];
  const model = (sources: Source[] = []) => modelOf(['a', 'b', 'c', 'd'], edges, [{ storageId: 's1' }, { storageId: 's1' }, { storageId: 's2' }, { storageId: 's2' }], sources);
  const only = (m: Model, selection: Selection, storageIds: string[] | null, search = '') =>
    computeVisible({ model: m, selection, search, contextIds: null, storageIds });

  test('null and every storage ticked narrow nothing', () => {
    expect(new Set(only(model(), sel({ martId: 'b' }), null).ids)).toEqual(new Set(['a', 'b', 'c']));
    expect(new Set(only(model(), sel({ martId: 'b' }), ['s1', 's2']).ids)).toEqual(new Set(['a', 'b', 'c']));
  });

  test('rule 1: the search matches only marts in a ticked storage', () => {
    const r = computeVisible({ model: model(), selection: sel(), search: 'c', contextIds: null, storageIds: ['s1'] });
    expect(r.ids).toEqual([]);
    expect(computeVisible({ model: model(), selection: sel(), search: 'c', contextIds: null, storageIds: ['s2'] }).ids).toEqual(['c']);
  });

  test('rule 2: a selected mart is shown with its neighbours in ticked storages only', () => {
    expect(new Set(only(model(), sel({ martId: 'b' }), ['s1']).ids)).toEqual(new Set(['a', 'b']));
  });

  test('rule 2: a selected mart in an unticked storage leaves the band, its neighbours stay', () => {
    const r = only(model(), sel({ martId: 'c' }), ['s1']);
    expect(r.ids).toEqual(['b']);
  });

  test('rule 3: a source feeds only its marts in ticked storages', () => {
    const src: Source = { key: 'k', name: 'K', logo: null, martIds: ['a', 'c'] };
    const m = modelOf(['a', 'b', 'c', 'd'], edges, [{ storageId: 's1', sourceKey: 'k' }, { storageId: 's1' }, { storageId: 's2', sourceKey: 'k' }, { storageId: 's2' }], [src]);
    expect(only(m, sel({ sourceKey: 'k' }), ['s2']).ids).toEqual(['c']);
  });

  test('rule 4 and the focus mart come from ticked storages', () => {
    const r = only(model(), sel(), ['s2']);
    expect(r.focusId).toBe('c');
    expect(new Set(r.ids)).toEqual(new Set(['c', 'd']));
  });

  test('no storage ticked shows nothing', () => {
    expect(only(model(), sel({ martId: 'b' }), []).ids).toEqual([]);
  });
});
