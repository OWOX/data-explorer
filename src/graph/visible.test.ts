import type { Edge, Mart, Model, Source } from '../model/types';
import type { Selection } from '../state/store';
import { adjacencyOf, computeVisible, inboundCounts, neighbours, pickFocus, type VisibleInput } from './visible';

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
const run = (model: Model, selection: Selection, search = '', contextIds: string[] = []) =>
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

test('rule 1: selected context badges narrow on their own, and a mart needs any one of them', () => {
  const model = modelOf(['a', 'b', 'c'], [], [{ contextIds: ['c1'] }, {}, { contextIds: ['c2'] }]);
  expect(run(model, sel(), '', ['c1']).ids).toEqual(['a']);
  expect(new Set(run(model, sel(), '', ['c1', 'c2']).ids)).toEqual(new Set(['a', 'c']));
  // none selected is no filter: rule 2 applies, so the selected mart alone (no edges)
  expect(run(model, sel({ martId: 'a' }), '', []).ids).toEqual(['a']);
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
    computeVisible({ model: m, selection, search, contextIds: [], storageIds });

  test('null and every storage ticked narrow nothing', () => {
    expect(new Set(only(model(), sel({ martId: 'b' }), null).ids)).toEqual(new Set(['a', 'b', 'c']));
    expect(new Set(only(model(), sel({ martId: 'b' }), ['s1', 's2']).ids)).toEqual(new Set(['a', 'b', 'c']));
  });

  test('rule 1: the search matches only marts in a ticked storage', () => {
    const r = computeVisible({ model: model(), selection: sel(), search: 'c', contextIds: [], storageIds: ['s1'] });
    expect(r.ids).toEqual([]);
    expect(computeVisible({ model: model(), selection: sel(), search: 'c', contextIds: [], storageIds: ['s2'] }).ids).toEqual(['c']);
  });

  test('rule 2: a selected mart is shown with its neighbours in ticked storages only', () => {
    expect(new Set(only(model(), sel({ martId: 'b' }), ['s1']).ids)).toEqual(new Set(['a', 'b']));
  });

  test('rule 2: a selected mart in an unticked storage stays, first, with its neighbours', () => {
    const r = only(model(), sel({ martId: 'c' }), ['s1']);
    expect(r.ids).toEqual(['c', 'b']);
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

  test('no storage ticked shows only the main mart', () => {
    expect(only(model(), sel({ martId: 'b' }), []).ids).toEqual(['b']);
  });
});

describe('selected joined marts', () => {
  const model = modelOf(['m', 'a', 'b', 'c', 'far', 'x'], [e('m', 'a'), e('m', 'b'), e('m', 'c'), e('a', 'far'), e('x', 'far')]);

  test('each is shown even when it is not a neighbour, right after the main one and in the order added', () => {
    const r = computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [], joined: ['far', 'c'] });
    expect(r.ids.slice(0, 3)).toEqual(['m', 'far', 'c']);
    // far is selected, so the marts connected to it show too (x, a).
    expect(new Set(r.ids)).toEqual(new Set(['m', 'a', 'b', 'c', 'far', 'x']));
  });

  test('the rest follows breadth first from the main and the joined ones, ties by inbound then title', () => {
    const r = computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [], joined: ['far'] });
    // far has two inbound edges; after m and far come m's neighbours by inbound then title
    expect(r.ids).toEqual(['m', 'far', 'a', 'b', 'c', 'x']);
  });

  test('every mart connected to any selected mart shows, the main one\'s neighbours and the joined ones\'', () => {
    const r = computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [], joined: ['a'] });
    expect(new Set(r.ids)).toEqual(new Set(['m', 'a', 'b', 'c', 'far']));
    expect(r.ids.slice(0, 2)).toEqual(['m', 'a']);
    expect(computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [] }).ids).not.toContain('far');
  });

  test('a mart connected to a joined mart is dropped from an unticked storage', () => {
    const m2 = modelOf(['m', 'a', 'far'], [e('m', 'a'), e('a', 'far')], [{}, {}, { storageId: 'other' }]);
    const r = computeVisible({ model: m2, selection: sel({ martId: 'm' }), search: '', contextIds: [], storageIds: ['s'], joined: ['a'] });
    expect(r.ids).toEqual(['m', 'a']);
  });

  test('a search shows them as well, and they do not need to match it', () => {
    const r = computeVisible({ model, selection: sel({ martId: 'm' }), search: 'a', contextIds: [], joined: ['x'] });
    expect(r.ids).toContain('x');
  });

  test('without a joined mart the order is the main one, then its neighbours by inbound then title', () => {
    expect(computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [] }).ids).toEqual(['m', 'a', 'b', 'c']);
  });

  test('a mart with a filter applied is shown after the joined ones, whatever the search', () => {
    const r = computeVisible({ model, selection: sel({ martId: 'm' }), search: 'm', contextIds: [], joined: ['a'], filtered: ['x'] });
    expect(r.ids.slice(0, 3)).toEqual(['m', 'a', 'x']);
    expect(computeVisible({ model, selection: sel({ martId: 'm' }), search: '', contextIds: [], filtered: ['far'] }).ids).toContain('far');
  });

  test('joined and filtered marts stay when their storage is unticked', () => {
    const m2 = modelOf(['m', 'a', 'f'], [e('m', 'a')], [{}, { storageId: 'other' }, { storageId: 'other' }]);
    const r = computeVisible({ model: m2, selection: sel({ martId: 'm' }), search: '', contextIds: [], storageIds: ['s'], joined: ['a'], filtered: ['f'] });
    expect(r.ids).toEqual(['m', 'a', 'f']);
  });
});

test('the main mart stays in the band when a search or a context does not match it', () => {
  const m = modelOf(['m', 'a'], [e('m', 'a')], [{ title: 'Orders' }, { title: 'Apple', contextIds: ['c1'] }]);
  expect(computeVisible({ model: m, selection: sel({ martId: 'm' }), search: 'apple', contextIds: [] }).ids).toEqual(['m', 'a']);
  expect(computeVisible({ model: m, selection: sel({ martId: 'm' }), search: '', contextIds: ['c1'] }).ids).toEqual(['m', 'a']);
});

test('the main mart is the first id whatever the search, the context or the ranking says', () => {
  const m = modelOf(['z', 'a', 'b'], [e('a', 'b'), e('b', 'a'), e('a', 'z')], [{ title: 'Zeta' }, { title: 'Alpha', contextIds: ['c1'] }, { title: 'Beta', contextIds: ['c1'] }]);
  for (const [search, contextIds] of [['', []], ['a', []], ['', ['c1']], ['beta', ['c1']]] as const) {
    expect(computeVisible({ model: m, selection: sel({ martId: 'z' }), search, contextIds: [...contextIds] }).ids[0]).toBe('z');
  }
});

test('a smart search shows the marts it found, in its order, and not the title match', () => {
  const model = modelOf(['a', 'b', 'c', 'd'], [e('a', 'b')]);
  const r = computeVisible({ model, selection: sel({ martId: 'c' }), search: 'who buys', contextIds: [], found: ['c', 'a', 'd'] });
  expect(r.ids).toEqual(['c', 'a', 'd']);
});

test('a smart search leaves out a found mart whose storage is unticked or that the member cannot open, but keeps the joined and filtered ones', () => {
  const model = modelOf(['a', 'b', 'c', 'j'], [], [{ storageId: 's1' }, { storageId: 's2' }, { accessible: false }, {}]);
  const r = computeVisible({ model, selection: sel({ martId: 'a' }), search: 'q', contextIds: [], storageIds: ['s1'], found: ['a', 'b', 'c'], joined: ['j'] });
  expect(r.ids).toEqual(['a', 'j']);
});

test('with no mart found the title match applies as before', () => {
  const model = modelOf(['alpha', 'beta'], []);
  expect(computeVisible({ model, selection: sel(), search: 'alp', contextIds: [], found: [] }).ids).toEqual(['alpha']);
});

test('after the found marts come the marts whose title matches the query, without repeats', () => {
  const model = modelOf(['a', 'b', 'c', 'd'], [], [{ title: 'Sessions GA4' }, { title: 'Ads' }, { title: 'GA4 events' }, { title: 'GA4 secret', accessible: false }]);
  const r = computeVisible({ model, selection: sel({ martId: 'b' }), search: 'ga4', contextIds: [], found: ['b', 'c'] });
  expect(r.ids).toEqual(['b', 'c', 'a']);
});

const runWith = (model: Model, selection: Selection, o: Partial<VisibleInput> = {}) =>
  computeVisible({ model, selection, search: '', contextIds: [], ...o });

describe('joinable', () => {
  test('rule 2 with the joinable set known: the main mart and every mart it can join, at any depth', () => {
    const m = modelOf(['a', 'b', 'c', 'd', 'z'], [e('a', 'b'), e('b', 'c'), e('z', 'a')]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: ['b', 'c'] });
    expect(r.ids[0]).toBe('a');
    expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c']));
    expect(r.joinable).toEqual(new Set(['b', 'c']));
  });

  test('rule 2 falls back to one hop while the joinable set is loading', () => {
    const m = modelOf(['a', 'b', 'c', 'z'], [e('a', 'b'), e('b', 'c'), e('z', 'a')]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: null });
    expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'z']));
    expect(r.joinable).toBeNull();
  });

  test('rule 2 leaves out joinable marts the member cannot open', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{}, { accessible: false }]);
    expect(runWith(m, sel({ martId: 'a' }), { joinable: ['b'] }).ids).toEqual(['a']);
  });

  test('rule 0: the main mart and its joined marts come before the smart search hits', () => {
    const m = modelOf(['a', 'b', 'c', 'd'], [e('a', 'b')]);
    const r = runWith(m, sel({ martId: 'a' }), { found: ['c', 'd'], joined: ['b'], search: 'zzz' });
    expect(r.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  test('rule 0 with a main mart in an unticked storage: the main mart is still first', () => {
    const m = modelOf(['a', 'b', 'c', 'd'], [e('a', 'b')], [{ storageId: 's2' }, {}, {}, {}]);
    const r = runWith(m, sel({ martId: 'a' }), { found: ['c', 'd'], joined: ['b'], search: 'zzz', storageIds: ['s'] });
    expect(r.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  test('rule 2 with a joinable set that is empty shows the main mart and the always-shown marts only', () => {
    const m = modelOf(['a', 'b', 'c', 'd'], [e('a', 'b'), e('a', 'c')]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: [], filtered: ['d'] });
    expect(r.ids).toEqual(['a', 'd']);
    expect(r.joinable).toEqual(new Set());
  });

  test('rule 1 with a main mart: a match shows only when the main mart can join it', () => {
    const m = modelOf(['a', 'b', 'c', 'cz'], [e('a', 'b')]);
    const r = runWith(m, sel({ martId: 'a' }), { search: 'c', joinable: ['b', 'cz'] });
    expect(r.ids).toEqual(['a', 'cz']);
    expect(r.joinable).toEqual(new Set(['b', 'cz']));
  });

  test('rule 1 with a main mart whose joins are still loading: every match shows', () => {
    const m = modelOf(['a', 'b', 'c'], [e('a', 'b')]);
    expect(runWith(m, sel({ martId: 'a' }), { search: 'c', joinable: null }).ids).toEqual(['a', 'c']);
  });

  test('a mart reachable at depth 2 shows and an unreachable one is hidden, with or without a search', () => {
    const m = modelOf(['a', 'b', 'deep', 'lone'], [e('a', 'b'), e('b', 'deep')]);
    expect(new Set(runWith(m, sel({ martId: 'a' }), { joinable: ['b', 'deep'] }).ids)).toEqual(new Set(['a', 'b', 'deep']));
    expect(runWith(m, sel({ martId: 'a' }), { search: 'e', joinable: ['b', 'deep'] }).ids).toEqual(['a', 'deep']);
  });

  test('rule 0 with a main mart: smart search hits the main mart cannot join are left out', () => {
    const m = modelOf(['a', 'b', 'c'], [e('a', 'b')]);
    expect(runWith(m, sel({ martId: 'a' }), { found: ['c', 'b'], search: 'zzz', joinable: ['b'] }).ids).toEqual(['a', 'b']);
  });

  test('with no main mart the joinable set is null', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{ sourceKey: 's1' }, { sourceKey: 's1' }], [{ key: 's1', name: 'S', logo: null, martIds: ['a', 'b'] }]);
    expect(runWith(m, sel({ sourceKey: 's1' }), { joinable: ['b'] }).joinable).toBeNull();
  });

  test('a main mart in an unticked storage is still put first, with the joinable band', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{ storageId: 's2' }, {}]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: ['b'], storageIds: ['s'] });
    expect(r.ids).toEqual(['a', 'b']);
  });
});

test('the neighbours of every mart are built once per edges array', () => {
  const edges = [e('a', 'b'), e('c', 'a'), e('a', 'a')];
  const first = adjacencyOf(edges);
  expect(adjacencyOf(edges)).toBe(first);
  expect(neighbours('a', edges)).toEqual(['b', 'c']);
  expect(neighbours('z', edges)).toEqual([]);
  expect(adjacencyOf([...edges])).not.toBe(first);
});
