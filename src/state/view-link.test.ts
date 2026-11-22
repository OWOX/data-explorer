import { describe, expect, it } from 'vitest';
import { decodeViewLink, encodeViewLink, MAX_AGG_RULES, MAX_DECODED_BYTES, MAX_ROUTE_LENGTH, type DecodedView } from './view-link';

const folded = { sources: false, marts: true, data: false, row: true };
const base: Omit<DecodedView, 'dropped' | 'droppedAggregations'> = {
  sourceKey: 'src1', martId: 'm1', record: { id: 7 }, search: 'sales', contextIds: ['c1'], storageIds: ['s1', 's2'], folded,
  grid: {
    columns: ['id', 'orders__customers__name', 'orders__customers__email', 'orders__total'],
    filters: {
      id: { field: 'id', op: 'gt', value: 5 },
      orders__total: { field: 'orders__total', op: 'between', value: { from: 1, to: 9 } },
      'orders__customers__name': { field: 'orders__customers__name', op: 'contains', value: 'ann' },
      created: { field: 'created', op: 'relative', value: { kind: 'last', n: 7, unit: 'day' } as never },
      email: { field: 'email', op: 'is_blank' },
    },
    sorts: [{ field: 'id', direction: 'desc' }, { field: 'orders__total', direction: 'asc' }],
    limit: 400,
  },
};

const raw = async (bytes: Uint8Array, kind: 'c' | 'd') => {
  const s = kind === 'c' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw');
  const w = s.writable.getWriter(); w.write(bytes as BufferSource).catch(() => {}); w.close().catch(() => {});
  return new Uint8Array(await new Response(s.readable).arrayBuffer());
};
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const route = async (obj: unknown) => `/v?s=${b64u(await raw(new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj)), 'c'))}`;
const valid = (over: Record<string, unknown> = {}) => ({ v: 1, P: ['a'], src: null, m: 'm1', r: null, q: '', ctx: [], st: null, f: folded, g: null, ...over });

describe('view link codec', () => {
  it('round trips native and joined columns, filter shapes, sorts and record', async () => {
    const r = await encodeViewLink(base);
    expect(r.startsWith('/v?s=')).toBe(true);
    expect(await decodeViewLink(r)).toEqual({ ...base, dropped: 0, droppedAggregations: 0 });
  });

  it('round trips the Unique Count paths, with a sort on their row keys', async () => {
    const withCounts = { ...base, grid: { ...base.grid!, uniqueCount: ['', 'orders.customers'], sorts: [{ field: 'Unique Count', direction: 'desc' as const }, { field: 'orders_customers__unique_count', direction: 'asc' as const }] } };
    expect(await decodeViewLink(await encodeViewLink(withCounts))).toEqual({ ...withCounts, dropped: 0, droppedAggregations: 0 });
    // A link without the part (made before it existed) opens with none.
    expect((await decodeViewLink(await encodeViewLink(base)))!).not.toHaveProperty('grid.uniqueCount');
  });

  it('leaves out and counts a malformed or repeated Unique Count path', async () => {
    const g = { c: ['id'], fl: [], s: null, l: 200, uc: ['', '', 7, '__proto__', 'a'] };
    const out = await decodeViewLink(await route(valid({ g })));
    expect(out).toMatchObject({ grid: { uniqueCount: ['', 'a'] }, droppedAggregations: 3 });
    expect(await decodeViewLink(await route(valid({ g: { ...g, uc: 'x' } })))).toBe('unreadable');
  });

  it('round trips null sorts, empty sorts and a null grid', async () => {
    const g = base.grid!;
    for (const v of [{ ...base, grid: { ...g, sorts: null } }, { ...base, grid: { ...g, sorts: [] } }, { ...base, grid: null, record: null, storageIds: null }]) {
      expect(await decodeViewLink(await encodeViewLink(v))).toEqual({ ...v, dropped: 0, droppedAggregations: 0 });
    }
  });

  it('accepts a percent-encoded route and extra params', async () => {
    const r = await encodeViewLink(base);
    expect(await decodeViewLink(`${r}&x=1`)).toMatchObject({ martId: 'm1' });
    expect(await decodeViewLink(encodeURI(r))).toMatchObject({ martId: 'm1' });
  });

  it('shares join-path prefixes', async () => {
    // Distinct long paths that only differ in a short tail, so deflate alone finds little to reuse.
    const paths = Array.from({ length: 4 }, (_, i) => Array.from({ length: 6 }, (_, j) => `j${i}x${(j * 7919 + i * 104729) % 9973}`).join('__'));
    const names = paths.flatMap((p) => ['a', 'b', 'c', 'd', 'e'].map((f) => `${p}__${f}`));
    const grid = { columns: names, filters: {}, sorts: names.map((field) => ({ field, direction: 'asc' as const })), limit: 200 };
    const withPrefixes = await encodeViewLink({ ...base, grid });
    const plain = JSON.stringify({ v: 1, P: [], src: null, m: 'm1', r: null, q: '', ctx: [], st: null, f: folded, g: { c: names, fl: [], s: names.map((n) => [n, 1]), l: 200 } });
    expect(withPrefixes.length).toBeLessThan((await route(plain)).length);
  });

  it('returns not-a-link for other routes', async () => {
    for (const r of [undefined, '', '/', '/x?s=abc', '/v', '/vv?s=abc', '/v?t=abc']) expect(await decodeViewLink(r)).toBe('not-a-link');
  });

  it('returns unreadable for payloads that do not decode', async () => {
    const cases = [
      '/v?s=!!!',
      '/v?s=AAAA',
      await route('not json'),
      await route(valid({ v: 2 })),
      await route([]),
      await route(valid({ P: 'x' })),
      await route(valid({ m: 5 })),
      await route(valid({ f: { sources: 1 } })),
      await route(valid({ g: { c: 'x', fl: [], s: null, l: 200 } })),
      `/v?s=${'A'.repeat(MAX_ROUTE_LENGTH)}`,
    ];
    for (const c of cases) expect(await decodeViewLink(c)).toBe('unreadable');
  });

  it('drops only the malformed entry and counts it', async () => {
    const g = { c: ['id', 5, [9, 'x'], [0, 'ok'], [0]], fl: [['id', 'gt', 1], ['id'], [['bad'], 'eq'], ['name', 3, 'x'], 'junk'], s: [['id', 1], ['id', 2], [[7, 'z'], -1], ['n', -1]], l: 200 };
    const out = await decodeViewLink(await route(valid({ g, ctx: ['c1', 4], st: ['s1', null] })));
    expect(out).toMatchObject({
      contextIds: ['c1'], storageIds: ['s1'],
      grid: { columns: ['id', 'a__ok'], filters: { id: { field: 'id', op: 'gt', value: 1 } }, sorts: [{ field: 'id', direction: 'asc' }, { field: 'n', direction: 'desc' }] },
    });
    // columns 3 (5, [9,'x'], [0]), filters 4, sorts 2, ctx 1, st 1
    expect((out as DecodedView).dropped).toBe(3 + 4 + 2 + 1 + 1);
  });

  it('drops a filter on a prototype key and keeps a normal filters object', async () => {
    const g = { c: ['id'], fl: [['__proto__', 'eq', 'x'], ['constructor', 'eq', 'y'], ['id', 'eq', 'z']], s: null, l: 200 };
    const out = (await decodeViewLink(await route(valid({ g })))) as DecodedView;
    expect(out.dropped).toBe(2);
    expect(Object.keys(out.grid!.filters)).toEqual(['id']);
    expect(Object.getPrototypeOf(out.grid!.filters)).toBe(Object.prototype);
    expect((out.grid!.filters as Record<string, unknown>).op).toBeUndefined();
  });

  it('refuses a payload that inflates past the cap', async () => {
    const big = await route(valid({ q: 'a'.repeat(MAX_DECODED_BYTES + 36 * 1024) }));
    expect(big.length).toBeLessThan(MAX_ROUTE_LENGTH);
    expect(await decodeViewLink(big)).toBe('unreadable');
  });

  it('encodes a real-sized view under the cap', async () => {
    const cols = Array.from({ length: 20 }, (_, i) => `${'join_path_segment_'.repeat(5)}${i}_${Math.round(Math.sin(i) * 1e6)}__field_${i}`);
    const filters = Object.fromEntries(cols.slice(0, 4).map((c, i) => [c, { field: c, op: 'contains' as const, value: `value ${i}` }]));
    const r = await encodeViewLink({ ...base, grid: { columns: cols, filters, sorts: [{ field: cols[0]!, direction: 'asc' }], limit: 200 } });
    expect(r.length).toBeLessThan(MAX_ROUTE_LENGTH);
  });

  describe('values that would break rendering', () => {
    const gridWith = (fl: unknown[]) => ({ c: ['id'], fl, s: null, l: 100 });
    const decodeOk = async (o: unknown) => (await decodeViewLink(await route(o))) as DecodedView;

    it('drops a filter whose operator is not one the grid knows', async () => {
      const d = await decodeOk(valid({ g: gridWith([['id', 'matches_regex', 'a'], ['id', 'eq', 1]]) }));
      expect(Object.values(d.grid!.filters).map((f) => f.op)).toEqual(['eq']);
      expect(d.dropped).toBe(1);
    });

    it('drops a relative filter with no value', async () => {
      const d = await decodeOk(valid({ g: gridWith([['id', 'relative']]) }));
      expect(d.grid!.filters).toEqual({});
      expect(d.dropped).toBe(1);
    });

    it('drops a relative filter whose kind is not a string', async () => {
      const d = await decodeOk(valid({ g: gridWith([['id', 'relative', { kind: { a: 1 } }]]) }));
      expect(d.grid!.filters).toEqual({});
      expect(d.dropped).toBe(1);
    });

    it('drops a filter value with a non-scalar toString', async () => {
      const d = await decodeOk(valid({ g: gridWith([['id', 'eq', { toString: 1 }]]) }));
      expect(d.grid!.filters).toEqual({});
      expect(d.dropped).toBe(1);
    });

    it('drops a record whose value is not a scalar', async () => {
      const d = await decodeOk(valid({ r: { id: { toString: 1 } } }));
      expect(d.record).toBeNull();
      expect(d.dropped).toBe(1);
    });

    it('drops an empty record', async () => {
      const d = await decodeOk(valid({ r: {} }));
      expect(d.record).toBeNull();
      expect(d.dropped).toBe(1);
    });

    it('keeps real value shapes', async () => {
      const fl = [['a', 'eq', 'x'], ['b', 'gt', 3], ['c', 'is_true'], ['d', 'between', { from: 1, to: 2 }], ['e', 'relative', { kind: 'last_n_days', n: 7 }], ['f', 'relative', { kind: 'today' }]];
      const d = await decodeOk(valid({ r: { id: 1, k: 'x', b: true }, g: gridWith(fl) }));
      expect(d.dropped).toBe(0);
      expect(Object.keys(d.grid!.filters)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      expect(d.record).toEqual({ id: 1, k: 'x', b: true });
    });
  });

  describe('aggregations and date buckets', () => {
    const withAgg = (over: Record<string, unknown>) => ({ c: ['id', 'total', 'orders__customers__city', 'created'], fl: [], s: null, l: 100, ...over });
    const decodeOk = async (o: unknown) => (await decodeViewLink(await route(o))) as DecodedView;

    it('round trips functions and buckets, joined columns and a time zone included', async () => {
      const grid = {
        ...base.grid!,
        columns: ['id', 'orders__total', 'created', 'orders__customers__city'],
        filters: {},
        sorts: null,
        aggregations: [{ column: 'orders__total', function: 'SUM' as const }, { column: 'orders__total', function: 'P95' as const }, { column: 'orders__customers__city', function: 'COUNT_DISTINCT' as const }],
        dateTrunc: [{ column: 'created', unit: 'MONTH' as const, timeZone: 'Europe/Kyiv' }],
      };
      const view = { ...base, grid };
      expect(await decodeViewLink(await encodeViewLink(view))).toEqual({ ...view, dropped: 0, droppedAggregations: 0 });
    });

    it('a link without them still opens, and a grid without them encodes none', async () => {
      const d = await decodeOk(valid({ g: withAgg({}) }));
      expect(d.dropped).toBe(0);
      expect(d.grid).not.toHaveProperty('aggregations');
      expect(d.grid).not.toHaveProperty('dateTrunc');
    });

    it('drops unknown functions and buckets, bad shapes and unsafe time zones, and counts them', async () => {
      const g = withAgg({
        ag: [['total', 'SUM'], ['total', 'NOPE'], ['total', 7], 'x', ['total', 'SUM'], [9, 'AVG']],
        dt: [['created', 'HOUR'], ['created', 'MONTH', 'UTC; drop'], ['created', 'QUARTER', '1UTC'], ['created', 'QUARTER', 'Europe//Kyiv'], ['created', 'WEEK', 'UTC']],
      });
      const d = await decodeOk(valid({ g }));
      expect(d.grid!.aggregations).toEqual([{ column: 'total', function: 'SUM' }]);
      expect(d.grid!.dateTrunc).toEqual([{ column: 'created', unit: 'WEEK', timeZone: 'UTC' }]);
      expect(d.droppedAggregations).toBe(9);
      expect(d.dropped).toBe(0);
    });

    it('keeps one bucket per column and never both a bucket and functions on a column', async () => {
      const d = await decodeOk(valid({ g: withAgg({ ag: [['total', 'SUM']], dt: [['created', 'DAY'], ['created', 'YEAR'], ['total', 'DAY']] }) }));
      expect(d.grid!.dateTrunc).toEqual([{ column: 'created', unit: 'DAY' }]);
      expect(d.grid!.aggregations).toEqual([{ column: 'total', function: 'SUM' }]);
      expect(d.droppedAggregations).toBe(2);
      expect(d.dropped).toBe(0);
    });

    it('caps the rules read from a link', async () => {
      const ag = Array.from({ length: MAX_AGG_RULES + 10 }, (_, i) => [`c${i}`, 'SUM']);
      const d = await decodeOk(valid({ g: withAgg({ ag }) }));
      expect(d.grid!.aggregations).toHaveLength(MAX_AGG_RULES);
      expect(d.droppedAggregations).toBe(10);
    });

    it('refuses rules that are not lists', async () => {
      expect(await decodeViewLink(await route(valid({ g: withAgg({ ag: { a: 1 } }) })))).toBe('unreadable');
      expect(await decodeViewLink(await route(valid({ g: withAgg({ dt: 'x' }) })))).toBe('unreadable');
    });
  });
});

describe('found marts in a link', () => {
  it('a smart search link carries the found ids, in order, and a link without them decodes without the field', async () => {
    const withFound = { ...base, found: ['m3', 'm1', 'm2'] };
    expect(await decodeViewLink(await encodeViewLink(withFound))).toEqual({ ...withFound, dropped: 0, droppedAggregations: 0 });
    const plain = await decodeViewLink(await encodeViewLink(base));
    expect(plain).not.toHaveProperty('found');
    expect(await decodeViewLink(await route(valid()))).not.toHaveProperty('found');
  });

  it('on decode the ids are strings only, at most five, with no repeats, and a bad list is ignored', async () => {
    const r = (await decodeViewLink(await route(valid({ fd: ['a', 3, 'a', 'b', null, 'c', 'd', 'e', 'f'] })))) as DecodedView;
    expect(r.found).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await decodeViewLink(await route(valid({ fd: 'nope' })))).not.toHaveProperty('found');
    expect(await decodeViewLink(await route(valid({ fd: [] })))).not.toHaveProperty('found');
  });
});

describe('view mode in a link', () => {
  const g = (over: Record<string, unknown> = {}) => ({ c: ['id'], fl: [], s: null, l: 100, ...over });
  const decode = async (gridPart: unknown) => (await decodeViewLink(await route(valid({ g: gridPart })))) as DecodedView;

  it('round trips the charts view', async () => {
    const view = { ...base, grid: { ...base.grid!, view: 'charts' as const } };
    expect(await decodeViewLink(await encodeViewLink(view))).toEqual({ ...view, dropped: 0, droppedAggregations: 0 });
  });

  it('a table grid has no view key', async () => {
    const d = (await decodeViewLink(await encodeViewLink(base))) as DecodedView;
    expect('view' in d.grid!).toBe(false);
  });

  it('a vw other than 1 is ignored and counted', async () => {
    for (const vw of [2, 'x', null, true]) {
      const d = await decode(g({ vw }));
      expect('view' in d.grid!).toBe(false);
      expect(d.dropped).toBe(1);
    }
    expect((await decode(g({ vw: 1 }))).grid!.view).toBe('charts');
    expect((await decode(g())).dropped).toBe(0);
  });
});

describe('view link slices and HAVING filters', () => {
  const g = (over: Record<string, unknown> = {}) => ({ c: ['id'], fl: [], s: null, l: 100, ...over });
  const decode = async (gridPart: unknown) => (await decodeViewLink(await route(valid({ g: gridPart })))) as DecodedView;
  const withRules = {
    ...base,
    grid: {
      ...base.grid!,
      filters: { ...base.grid!.filters, orders__total: { field: 'orders__total', op: 'gt' as const, value: 100, fn: 'SUM' as const }, id: { field: 'id', op: 'is_blank' as const, fn: 'COUNT' as const } },
      slices: { orders__customers__name: { field: 'orders__customers__name', op: 'contains' as const, value: 'ann' }, orders__total: { field: 'orders__total', op: 'is_blank' as const } },
    },
  };
  it('round trips slices and the function of a HAVING filter, with or without a value', async () => {
    const d = (await decodeViewLink(await encodeViewLink(withRules))) as DecodedView;
    expect(d).toEqual({ ...withRules, dropped: 0, droppedAggregations: 0 });
  });
  it('a grid with no slices has no slices key', async () => {
    const d = (await decodeViewLink(await encodeViewLink(base))) as DecodedView;
    expect('slices' in d.grid!).toBe(false);
  });
  it('an old link (filters with two or three slots, no sl) decodes unchanged', async () => {
    const d = await decode(g({ fl: [['a', 'gt', 5], ['b', 'is_blank']] }));
    expect(d.grid!.filters).toEqual({ a: { field: 'a', op: 'gt', value: 5 }, b: { field: 'b', op: 'is_blank' } });
    expect('slices' in d.grid!).toBe(false);
    expect(d.dropped).toBe(0);
  });
  it('an unknown function in the fourth slot drops the filter; a slice takes no function slot', async () => {
    const d = await decode(g({ fl: [['a', 'gt', 5, 'NOPE'], ['b', 'gt', 5, 'SUM']], sl: [['c', 'eq', 'x', 'SUM'], ['d', 'eq', 'x']] }));
    expect(Object.keys(d.grid!.filters)).toEqual(['b']);
    expect(Object.keys(d.grid!.slices!)).toEqual(['d']);
    expect(d.dropped).toBe(2);
  });
  it('a malformed sl is refused', async () => {
    expect(await decodeViewLink(await route(valid({ g: g({ sl: 'x' }) })))).toBe('unreadable');
  });
});

describe('list rules in a link', () => {
  it('round trips the list marker on a filter (with and without a function slot) and a slice, and an unmarked comma value stays unmarked', async () => {
    const view = { ...base, grid: { ...base.grid!, filters: {
      a: { field: 'a', op: 'eq' as const, value: 'x, y', list: true as const },
      b: { field: 'b', op: 'neq' as const, value: 'x, y', list: true as const },
      c: { field: 'c', op: 'eq' as const, value: 'x, y' },
    }, slices: { d: { field: 'd', op: 'eq' as const, value: 'x, y', list: true as const } } } };
    const d = (await decodeViewLink(await encodeViewLink(view))) as DecodedView;
    expect(d.grid!.filters).toEqual(view.grid.filters);
    expect(d.grid!.slices).toEqual(view.grid.slices);
  });
});
