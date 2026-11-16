import { describe, expect, it } from 'vitest';
import { decodeViewLink, encodeViewLink, MAX_ROUTE_LENGTH, type DecodedView } from './view-link';

const folded = { sources: false, marts: true, data: false, row: true };
const base: Omit<DecodedView, 'dropped'> = {
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
    expect(await decodeViewLink(r)).toEqual({ ...base, dropped: 0 });
  });

  it('round trips null sorts, empty sorts and a null grid', async () => {
    const g = base.grid!;
    for (const v of [{ ...base, grid: { ...g, sorts: null } }, { ...base, grid: { ...g, sorts: [] } }, { ...base, grid: null, record: null, storageIds: null }]) {
      expect(await decodeViewLink(await encodeViewLink(v))).toEqual({ ...v, dropped: 0 });
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

  it('encodes a real-sized view under the cap', async () => {
    const cols = Array.from({ length: 20 }, (_, i) => `${'join_path_segment_'.repeat(5)}${i}_${Math.round(Math.sin(i) * 1e6)}__field_${i}`);
    const filters = Object.fromEntries(cols.slice(0, 4).map((c, i) => [c, { field: c, op: 'contains' as const, value: `value ${i}` }]));
    const r = await encodeViewLink({ ...base, grid: { columns: cols, filters, sorts: [{ field: cols[0]!, direction: 'asc' }], limit: 200 } });
    expect(r.length).toBeLessThan(MAX_ROUTE_LENGTH);
  });
});
