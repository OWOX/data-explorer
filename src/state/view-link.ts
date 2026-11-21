import { MAX_FOUND } from '../config';
import type { ColumnFilter, FilterValue } from '../filters/build';
import { isOpId } from '../filters/catalogue';
import { isRecord } from '../model/guards';
import { isAggFn, isDateBucket, isTimeZone, type AggFn, type AggregationRule, type DateBucket, type DateTruncRule } from '../model/aggregation';
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
  g: null | { c: Col[]; fl: unknown[][]; /** Slices, the same tuple as a filter's but without the function slot. */ sl?: unknown[][]; s: [Col, 1 | -1][] | null; l: number; /** Aggregations: [column, function]. */ ag?: [Col, AggFn][]; /** Date buckets: [column, unit, time zone?]. */ dt?: [Col, DateBucket, string?][]; /** Charts view; absent is the table. */ vw?: 1 };
};

/** At most this many aggregation rules and this many date buckets are read from a link; the rest count as dropped. */
export const MAX_AGG_RULES = 64;

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

/** A rule as its tuple: [column, op, value?, fn?, 1?] for a filter, [column, op, value?, 1?] for a slice; trailing empty slots are left off. */
export function ruleTuple(column: Col, f: ColumnFilter, withFn: boolean): unknown[] {
  const t: unknown[] = [column, f.op, f.value === undefined ? undefined : f.value];
  if (withFn) t.push(f.fn);
  if (f.list) t.push(1);
  let n = t.length;
  while (n > 2 && t[n - 1] === undefined) n--;
  return t.slice(0, n).map((x, i) => (x === undefined && i >= 2 ? null : x));
}

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
    ...(view.found?.length ? { fd: view.found.slice(0, MAX_FOUND) } : {}),
    ctx: view.contextIds,
    st: view.storageIds,
    f: view.folded,
    g: g && {
      c: g.columns.map(col),
      fl: Object.entries(g.filters).map(([field, f]): unknown[] => ruleTuple(col(field), f, true)),
      ...(g.slices && Object.keys(g.slices).length ? { sl: Object.entries(g.slices).map(([field, f]): unknown[] => ruleTuple(col(field), f, false)) } : {}),
      s: g.sorts && g.sorts.map((x) => [col(x.field), x.direction === 'asc' ? 1 : -1]),
      l: g.limit,
      ...(g.aggregations?.length ? { ag: g.aggregations.map((r): [Col, AggFn] => [col(r.column), r.function]) } : {}),
      ...(g.dateTrunc?.length ? { dt: g.dateTrunc.map((r): [Col, DateBucket, string?] => (r.timeZone ? [col(r.column), r.unit, r.timeZone] : [col(r.column), r.unit])) } : {}),
      ...(g.view === 'charts' ? { vw: 1 as const } : {}),
    },
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return `${ROUTE_PATH}?s=${toBase64Url(packed)}`;
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const isPlain = (v: unknown): v is Record<string, unknown> => isRecord(v) && Object.getPrototypeOf(v) === Object.prototype;
/** A filter value the grid can render and query: a scalar, or a flat object of strings and numbers (ranges, relative presets). */
const isFilterValue = (v: unknown): boolean =>
  v === undefined || isScalar(v) || (isPlain(v) && Object.entries(v).every(([k, x]) => !(k in Object.prototype) && (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))));

/**
 * One rule from its tuple: a filter is [column, op, value?, fn?, 1?]; a slice is [column, op, value?, 1?]. A null value or function is an empty slot before a later one.
 * The trailing 1 marks a list (`a, b` is any of the two). Null when the tuple is malformed.
 */
export function decodeRule(e: unknown, withFn: boolean, name: (c: unknown) => string | null): ColumnFilter | null {
  const arity = Array.isArray(e) ? e.length : 0;
  const field = arity >= 2 && arity <= (withFn ? 5 : 4) ? name((e as unknown[])[0]) : null;
  const op = (e as unknown[])[1];
  if (field === null || !isOpId(op) || UNSAFE_KEYS.has(field)) return null;
  const entry: ColumnFilter = { field, op };
  const value = (e as unknown[])[2] as FilterValue | null | undefined;
  const fn = withFn ? (e as unknown[])[3] : undefined;
  const listFlag = (e as unknown[])[withFn ? 4 : 3];
  const fnOk = fn === undefined || fn === null || isAggFn(fn);
  // A relative filter needs a preset object; any other value must be safe to render and query. A function must be a known one.
  const ok = (listFlag === undefined || listFlag === 1) && isFilterValue(value ?? undefined) && (entry.op !== 'relative' || (isPlain(value) && typeof (value as { kind?: unknown }).kind === 'string')) && fnOk;
  if (!ok) return null;
  if (value !== undefined && value !== null) entry.value = value;
  if (isAggFn(fn)) entry.fn = fn;
  if (listFlag === 1 && typeof entry.value === 'string' && (entry.op === 'eq' || entry.op === 'neq')) entry.list = true;
  return entry;
}

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
  if (!isRecord(raw) || raw.v !== 1) throw new Error('bad version');
  const { P, src, m, r, q, ctx, st, f, g, fd } = raw;
  if (!isStringList(P)) throw new Error('bad P');
  if (!(src === null || typeof src === 'string') || !(m === null || typeof m === 'string')) throw new Error('bad ids');
  if (!(r === null || isRecord(r)) || typeof q !== 'string') throw new Error('bad record or search');
  if (!Array.isArray(ctx) || !(st === null || Array.isArray(st))) throw new Error('bad lists');
  if (!isRecord(f) || (['sources', 'marts', 'data', 'row'] as const).some((k) => typeof f[k] !== 'boolean')) throw new Error('bad folds');
  if (!(g === null || isRecord(g))) throw new Error('bad grid');

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
    // A filter is [column, op, value?, fn?, 1?]; a slice is [column, op, value?, 1?]. A null value or function is an empty slot before a later one. The trailing 1 marks a list (`a, b` is any of the two).
    const decodeRules = (list: unknown[], withFn: boolean): [string, ColumnFilter][] => {
      const out: [string, ColumnFilter][] = [];
      for (const e of list) {
        const entry = decodeRule(e, withFn, name);
        if (entry) out.push([entry.field, entry]); else dropped++;
      }
      return out;
    };
    if (g.sl !== undefined && !Array.isArray(g.sl)) throw new Error('bad slices');
    const filterEntries = decodeRules(g.fl, true);
    const sliceEntries = decodeRules((g.sl as unknown[] | undefined) ?? [], false);
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
      const fn: unknown = Array.isArray(e) ? e[1] : undefined;
      const column = Array.isArray(e) && e.length === 2 && isAggFn(fn) ? name(e[0]) : null;
      if (column === null || !isAggFn(fn) || UNSAFE_KEYS.has(column) || i >= MAX_AGG_RULES || seen.has(`${column}\0${fn}`)) { droppedAggregations++; continue; }
      seen.add(`${column}\0${fn}`);
      aggregations.push({ column, function: fn });
    }
    const bucketed = new Set<string>();
    for (const [i, e] of ((g.dt as unknown[] | undefined) ?? []).entries()) {
      const unit: unknown = Array.isArray(e) ? e[1] : undefined;
      const zone: unknown = Array.isArray(e) ? e[2] : undefined;
      const ok = Array.isArray(e) && (e.length === 2 || e.length === 3) && isDateBucket(unit) && (zone === undefined || isTimeZone(zone));
      const column = ok ? name((e as unknown[])[0]) : null;
      // One bucket per column, and a date takes functions or a bucket, never both.
      if (column === null || UNSAFE_KEYS.has(column) || i >= MAX_AGG_RULES || !isDateBucket(unit) || bucketed.has(column) || aggregations.some((r) => r.column === column)) { droppedAggregations++; continue; }
      bucketed.add(column);
      dateTrunc.push({ column, unit, ...(typeof zone === 'string' && zone ? { timeZone: zone } : {}) });
    }
    // Only 1 means charts; any other value is left out and counted, so a newer link still opens as the table.
    if (g.vw !== undefined && g.vw !== 1) dropped++;
    grid = { columns, filters: Object.fromEntries(filterEntries), ...(sliceEntries.length ? { slices: Object.fromEntries(sliceEntries) } : {}), sorts, limit: g.l, ...(aggregations.length ? { aggregations } : {}), ...(dateTrunc.length ? { dateTrunc } : {}), ...(g.vw === 1 ? { view: 'charts' as const } : {}) };
  }

  const found = Array.isArray(fd) ? [...new Set(fd.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_FOUND) : [];
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
