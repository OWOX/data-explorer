import type { ColumnFilter, FilterValue } from '../filters/build';
import type { OpId } from '../filters/catalogue';
import type { GridState } from './store';
import type { SortKey } from '../model/sort';

/** The host refuses a route longer than this, `/v?s=` included. */
export const MAX_ROUTE_LENGTH = 2048;

type Folded = { sources: boolean; marts: boolean; data: boolean; row: boolean };

/** A view read from a link, with full column names. `dropped` counts the malformed entries left out. */
export type DecodedView = {
  sourceKey: string | null;
  martId: string | null;
  record: Record<string, unknown> | null;
  search: string;
  contextIds: string[];
  storageIds: string[] | null;
  folded: Folded;
  grid: GridState | null;
  dropped: number;
};

// A plain name, or [index into P, field suffix].
type Col = string | [number, string];
type ViewLinkV1 = {
  v: 1;
  P: string[];
  src: string | null;
  m: string | null;
  r: Record<string, unknown> | null;
  q: string;
  ctx: string[];
  st: string[] | null;
  f: Folded;
  g: null | { c: Col[]; fl: [Col, string, unknown?][]; s: [Col, 1 | -1][] | null; l: number };
};

const ROUTE_PATH = '/v';

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const pipe = async (input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> => {
  const writer = stream.writable.getWriter();
  // Errors surface on the read side; a failed write would otherwise be an unhandled rejection.
  writer.write(input as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

/** A joined column is `<joinPath>__<field>`, split at the last `__`; other names stay whole. */
const splitName = (name: string): [string, string] | null => {
  const i = name.lastIndexOf('__');
  return i > 0 && i + 2 < name.length ? [name.slice(0, i), name.slice(i + 2)] : null;
};

export async function encodeViewLink(view: Omit<DecodedView, 'dropped'>): Promise<string> {
  const P: string[] = [];
  const col = (name: string): Col => {
    const parts = splitName(name);
    if (!parts) return name;
    let i = P.indexOf(parts[0]);
    if (i < 0) i = P.push(parts[0]) - 1;
    return [i, parts[1]];
  };
  const g = view.grid;
  const payload: ViewLinkV1 = {
    v: 1,
    P,
    src: view.sourceKey,
    m: view.martId,
    r: view.record,
    q: view.search,
    ctx: view.contextIds,
    st: view.storageIds,
    f: view.folded,
    g: g && {
      c: g.columns.map(col),
      fl: Object.entries(g.filters).map(([field, f]) => (f.value === undefined ? [col(field), f.op] : [col(field), f.op, f.value])),
      s: g.sorts && g.sorts.map((x) => [col(x.field), x.direction === 'asc' ? 1 : -1]),
      l: g.limit,
    },
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return `${ROUTE_PATH}?s=${toBase64Url(packed)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The route's `s` param, or null when the route isn't a view link. */
function payloadOf(route: string | undefined): string | null {
  if (!route) return null;
  const q = route.indexOf('?');
  if ((q < 0 ? route : route.slice(0, q)) !== ROUTE_PATH || q < 0) return null;
  return new URLSearchParams(route.slice(q + 1)).get('s');
}

export async function decodeViewLink(route: string | undefined): Promise<DecodedView | 'not-a-link' | 'unreadable'> {
  const s = payloadOf(route);
  if (s === null) return 'not-a-link';
  if (route!.length > MAX_ROUTE_LENGTH) return 'unreadable';
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(fromBase64Url(s), new DecompressionStream('deflate-raw')));
    return shape(JSON.parse(json));
  } catch {
    return 'unreadable';
  }
}

/** Checks the top-level types, then drops malformed entries one by one. Throws on a bad top level. */
function shape(raw: unknown): DecodedView {
  if (!isObject(raw) || raw.v !== 1) throw new Error('bad version');
  const { P, src, m, r, q, ctx, st, f, g } = raw;
  if (!isStringList(P)) throw new Error('bad P');
  if (!(src === null || typeof src === 'string') || !(m === null || typeof m === 'string')) throw new Error('bad ids');
  if (!(r === null || isObject(r)) || typeof q !== 'string') throw new Error('bad record or search');
  if (!Array.isArray(ctx) || !(st === null || Array.isArray(st))) throw new Error('bad lists');
  if (!isObject(f) || (['sources', 'marts', 'data', 'row'] as const).some((k) => typeof f[k] !== 'boolean')) throw new Error('bad folds');
  if (!(g === null || isObject(g))) throw new Error('bad grid');

  let dropped = 0;
  const keepStrings = (list: unknown[]): string[] => list.filter((x): x is string => typeof x === 'string' || (dropped++, false));
  const name = (c: unknown): string | null => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && typeof c[1] === 'string' && c[0] >= 0 && c[0] < P.length) return `${P[c[0]]}__${c[1]}`;
    return null;
  };

  let grid: GridState | null = null;
  if (g) {
    if (!Array.isArray(g.c) || !Array.isArray(g.fl) || !(g.s === null || Array.isArray(g.s)) || typeof g.l !== 'number' || !Number.isFinite(g.l)) throw new Error('bad grid parts');
    const columns: string[] = [];
    for (const c of g.c) { const n = name(c); if (n === null) dropped++; else columns.push(n); }
    const filters: Record<string, ColumnFilter> = {};
    for (const e of g.fl) {
      const field = Array.isArray(e) && (e.length === 2 || e.length === 3) ? name(e[0]) : null;
      if (field === null || typeof (e as unknown[])[1] !== 'string') { dropped++; continue; }
      const entry: ColumnFilter = { field, op: (e as unknown[])[1] as OpId };
      const value = (e as unknown[])[2] as FilterValue | null | undefined;
      if (value !== undefined && value !== null) entry.value = value;
      filters[field] = entry;
    }
    let sorts: SortKey[] | null = null;
    if (g.s) {
      sorts = [];
      for (const e of g.s) {
        const field = Array.isArray(e) && e.length === 2 && (e[1] === 1 || e[1] === -1) ? name(e[0]) : null;
        if (field === null) dropped++; else sorts.push({ field, direction: (e as unknown[])[1] === 1 ? 'asc' : 'desc' });
      }
    }
    grid = { columns, filters, sorts, limit: g.l };
  }

  return {
    sourceKey: src,
    martId: m,
    record: r,
    search: q,
    contextIds: keepStrings(ctx),
    storageIds: st === null ? null : keepStrings(st),
    folded: { sources: f.sources as boolean, marts: f.marts as boolean, data: f.data as boolean, row: f.row as boolean },
    grid,
    dropped,
  };
}
