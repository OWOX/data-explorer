import type { ColumnFilter, FilterValue } from '../filters/build';
import type { OpId } from '../filters/catalogue';
import { AGGREGATE_FUNCTIONS, DATE_BUCKETS, isTimeZone, type AggFn, type AggregationRule, type DateBucket, type DateTruncRule } from '../model/aggregation';
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
  /** The marts a smart search found, best first (at most 5); absent for a link of a plain view. */
  found?: string[];
  contextIds: string[];
  storageIds: string[] | null;
  folded: Folded;
  grid: GridState | null;
  dropped: number;
  /** The aggregation functions and date buckets left out (malformed, repeated, past the cap), counted apart from `dropped`. */
  droppedAggregations: number;
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
  /** The marts a smart search found: with them `q` is only the text shown in the box, not a title filter. */
  fd?: string[];
  ctx: string[];
  st: string[] | null;
  f: Folded;
  g: null | { c: Col[]; fl: [Col, string, unknown?][]; s: [Col, 1 | -1][] | null; l: number; /** Aggregations: [column, function]. */ ag?: [Col, AggFn][]; /** Date buckets: [column, unit, time zone?]. */ dt?: [Col, DateBucket, string?][] };
};

/** At most this many aggregation rules and this many date buckets are read from a link; the rest count as dropped. */
export const MAX_AGG_RULES = 64;
/** At most this many found marts are carried by a link. */
export const MAX_FOUND_IDS = 5;

const ROUTE_PATH = '/v';
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

/** Inflated output past this is refused, so a small link can't expand into memory. */
export const MAX_DECODED_BYTES = 64 * 1024;

class TooBig extends Error {}

const pipe = async (input: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> => {
  const writer = stream.writable.getWriter();
  // Errors surface on the read side; a failed write would otherwise be an unhandled rejection.
  writer.write(input as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { reader.cancel().catch(() => {}); throw new TooBig(); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
};

/** A joined column is `<joinPath>__<field>`, split at the last `__`; other names stay whole. */
const splitName = (name: string): [string, string] | null => {
  const i = name.lastIndexOf('__');
  return i > 0 && i + 2 < name.length ? [name.slice(0, i), name.slice(i + 2)] : null;
};

export async function encodeViewLink(view: Omit<DecodedView, 'dropped' | 'droppedAggregations'>): Promise<string> {
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
    ...(view.found?.length ? { fd: view.found.slice(0, MAX_FOUND_IDS) } : {}),
    ctx: view.contextIds,
    st: view.storageIds,
    f: view.folded,
    g: g && {
      c: g.columns.map(col),
      fl: Object.entries(g.filters).map(([field, f]) => (f.value === undefined ? [col(field), f.op] : [col(field), f.op, f.value])),
      s: g.sorts && g.sorts.map((x) => [col(x.field), x.direction === 'asc' ? 1 : -1]),
      l: g.limit,
      ...(g.aggregations?.length ? { ag: g.aggregations.map((r): [Col, AggFn] => [col(r.column), r.function]) } : {}),
      ...(g.dateTrunc?.length ? { dt: g.dateTrunc.map((r): [Col, DateBucket, string?] => (r.timeZone ? [col(r.column), r.unit, r.timeZone] : [col(r.column), r.unit])) } : {}),
    },
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return `${ROUTE_PATH}?s=${toBase64Url(packed)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const isPlain = (v: unknown): v is Record<string, unknown> => isObject(v) && Object.getPrototypeOf(v) === Object.prototype;
/** A filter value the grid can render and query: a scalar, or a flat object of strings and numbers (ranges, relative presets). */
const isFilterValue = (v: unknown): boolean =>
  v === undefined || isScalar(v) || (isPlain(v) && Object.entries(v).every(([k, x]) => !(k in Object.prototype) && (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))));

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
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(fromBase64Url(s), new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES));
    return shape(JSON.parse(json));
  } catch {
    return 'unreadable';
  }
}

/** Checks the top-level types, then drops malformed entries one by one. Throws on a bad top level. */
function shape(raw: unknown): DecodedView {
  if (!isObject(raw) || raw.v !== 1) throw new Error('bad version');
  const { P, src, m, r, q, ctx, st, f, g, fd } = raw;
  if (!isStringList(P)) throw new Error('bad P');
  if (!(src === null || typeof src === 'string') || !(m === null || typeof m === 'string')) throw new Error('bad ids');
  if (!(r === null || isObject(r)) || typeof q !== 'string') throw new Error('bad record or search');
  if (!Array.isArray(ctx) || !(st === null || Array.isArray(st))) throw new Error('bad lists');
  if (!isObject(f) || (['sources', 'marts', 'data', 'row'] as const).some((k) => typeof f[k] !== 'boolean')) throw new Error('bad folds');
  if (!(g === null || isObject(g))) throw new Error('bad grid');

  let dropped = 0;
  let droppedAggregations = 0;
  let record: Record<string, unknown> | null = null;
  if (r !== null) {
    if (isPlain(r) && Object.keys(r).length > 0 && Object.entries(r).every(([k, x]) => !(k in Object.prototype) && isScalar(x))) record = r;
    else dropped++;
  }
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
    // Built as entries: a decoded key like __proto__ must never reach an object's prototype.
    const filterEntries: [string, ColumnFilter][] = [];
    for (const e of g.fl) {
      const field = Array.isArray(e) && (e.length === 2 || e.length === 3) ? name(e[0]) : null;
      if (field === null || typeof (e as unknown[])[1] !== 'string' || UNSAFE_KEYS.has(field)) { dropped++; continue; }
      const entry: ColumnFilter = { field, op: (e as unknown[])[1] as OpId };
      const value = (e as unknown[])[2] as FilterValue | null | undefined;
      // A relative filter needs a preset object; any other value must be safe to render and query.
      const ok = isFilterValue(value ?? undefined) && (entry.op !== 'relative' || (isPlain(value) && typeof (value as { kind?: unknown }).kind === 'string'));
      if (!ok) { dropped++; continue; }
      if (value !== undefined && value !== null) entry.value = value;
      filterEntries.push([field, entry]);
    }
    let sorts: SortKey[] | null = null;
    if (g.s) {
      sorts = [];
      for (const e of g.s) {
        const field = Array.isArray(e) && e.length === 2 && (e[1] === 1 || e[1] === -1) ? name(e[0]) : null;
        if (field === null) dropped++; else sorts.push({ field, direction: (e as unknown[])[1] === 1 ? 'asc' : 'desc' });
      }
    }
    // Rules with an unknown function or bucket, a bad column, a repeat, or past the cap are left out and counted.
    const aggregations: AggregationRule[] = [];
    const dateTrunc: DateTruncRule[] = [];
    const seen = new Set<string>();
    if (g.ag !== undefined && !Array.isArray(g.ag)) throw new Error('bad aggregations');
    if (g.dt !== undefined && !Array.isArray(g.dt)) throw new Error('bad buckets');
    for (const [i, e] of ((g.ag as unknown[] | undefined) ?? []).entries()) {
      const column = Array.isArray(e) && e.length === 2 && (AGGREGATE_FUNCTIONS as readonly unknown[]).includes(e[1]) ? name(e[0]) : null;
      if (column === null || UNSAFE_KEYS.has(column) || i >= MAX_AGG_RULES || seen.has(`${column}\0${(e as unknown[])[1]}`)) { droppedAggregations++; continue; }
      seen.add(`${column}\0${(e as unknown[])[1]}`);
      aggregations.push({ column, function: (e as unknown[])[1] as AggFn });
    }
    const bucketed = new Set<string>();
    for (const [i, e] of ((g.dt as unknown[] | undefined) ?? []).entries()) {
      const ok = Array.isArray(e) && (e.length === 2 || e.length === 3) && (DATE_BUCKETS as readonly unknown[]).includes(e[1]) && (e[2] === undefined || isTimeZone(e[2]));
      const column = ok ? name((e as unknown[])[0]) : null;
      // One bucket per column, and a date takes functions or a bucket, never both.
      if (column === null || UNSAFE_KEYS.has(column) || i >= MAX_AGG_RULES || bucketed.has(column) || aggregations.some((r) => r.column === column)) { droppedAggregations++; continue; }
      bucketed.add(column);
      const zone = (e as unknown[])[2] as string | undefined;
      dateTrunc.push({ column, unit: (e as unknown[])[1] as DateBucket, ...(zone ? { timeZone: zone } : {}) });
    }
    grid = { columns, filters: Object.fromEntries(filterEntries), sorts, limit: g.l, ...(aggregations.length ? { aggregations } : {}), ...(dateTrunc.length ? { dateTrunc } : {}) };
  }

  const found = Array.isArray(fd) ? [...new Set(fd.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_FOUND_IDS) : [];
  return {
    sourceKey: src,
    martId: m,
    record,
    search: q,
    ...(found.length ? { found } : {}),
    contextIds: keepStrings(ctx),
    storageIds: st === null ? null : keepStrings(st),
    folded: { sources: f.sources as boolean, marts: f.marts as boolean, data: f.data as boolean, row: f.row as boolean },
    grid,
    dropped,
    droppedAggregations,
  };
}
