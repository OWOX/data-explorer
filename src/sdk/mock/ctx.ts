import type { AvailableSourceDto, BlendableSchemaDto, BlendedFieldDto, Ctx, EdgeDto, Row, TraverseOptions } from '../types';
import { aggregateRows, distinctKeys, type UniqueSource } from './aggregate';
import { matchesFilter } from './evaluate';
import { createFakeAi } from './ai';
import { demoFixtures, type Fixtures } from './fixtures';
import { mockSearch } from './search';

declare global { interface Window { __copiedLink?: string; __routeSet?: string } }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockCtx(f: Fixtures = demoFixtures(), opts: { latencyMs?: number; runMs?: number; /** false: no AI credential, as in a project that has not configured one. */ ai?: boolean } = {}): Ctx {
  const latency = opts.latencyMs ?? 0;
  const byId = new Map(f.marts.map((m) => [m.id, m]));
  const docs = new Map<string, unknown>();
  const slow = async <T,>(v: () => T): Promise<T> => { if (latency) await wait(latency); return v(); };

  type MockReport = Record<string, unknown> & { id: string; dataMartId: string; lastRunAt: string | null; lastRunStatus: string | null; lastRunError: string | null };
  const reports = new Map<string, MockReport>();
  let sheetSerial = 0;
  let reportSerial = 0;
  const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { payload: { code: 'HTTP_ERROR', status: 404 } });
  const report = (id: string) => reports.get(id) ?? (() => { throw notFound('Report'); })();
  // How long a report run takes before it reports success.
  const RUN_MS = opts.runMs ?? 1000;

  // The data marts a mart can pull fields from: its outgoing many-to-one links, and theirs, two hops deep. Each is named by the
  // dotted path of the marts it passes through, like OWOX's alias path, and its fields by that path and the field (`customers__email`).
  const MAX_JOIN_DEPTH = 2;
  type Hop = { aliasPath: string; martId: string; depth: number; edges: EdgeDto[] };
  const joinTrees = new Map<string, Hop[]>();
  function joinTree(martId: string): Hop[] {
    const hit = joinTrees.get(martId);
    if (hit) return hit;
    const out: Hop[] = [];
    const walk = (from: string, path: string, edges: EdgeDto[], seen: string[]) => {
      if (edges.length >= MAX_JOIN_DEPTH) return;
      for (const e of f.edges.filter((x) => x.sourceDataMartId === from && !seen.includes(x.targetDataMartId))) {
        const aliasPath = path ? `${path}.${e.targetDataMartId}` : e.targetDataMartId;
        const chain = [...edges, e];
        out.push({ aliasPath, martId: e.targetDataMartId, depth: chain.length, edges: chain });
        walk(e.targetDataMartId, aliasPath, chain, [...seen, e.targetDataMartId]);
      }
    };
    walk(martId, '', [], [martId]);
    joinTrees.set(martId, out);
    return out;
  }
  const blendedName = (aliasPath: string, field: string) => `${aliasPath.replaceAll('.', '__')}__${field}`;

  function blendableSchema(martId: string): BlendableSchemaDto {
    if (!byId.has(martId)) throw notFound('Data Mart');
    const hops = joinTree(martId);
    const availableSources: AvailableSourceDto[] = hops.map((h) => {
      const t = byId.get(h.martId)!;
      return { aliasPath: h.aliasPath, title: t.title, defaultAlias: t.title, depth: h.depth, dataMartId: t.id, relationshipId: h.edges.at(-1)!.id, isIncluded: true, isAccessibleForReporting: t.accessible, mainGrainMultiplication: 'none' };
    });
    const blendedFields: BlendedFieldDto[] = hops.flatMap((h) => {
      const t = byId.get(h.martId)!;
      return t.fields.filter((x) => !x.isHiddenForReporting).map((x): BlendedFieldDto => ({
        name: blendedName(h.aliasPath, x.name), sourceDataMartId: t.id, sourceDataMartTitle: t.title, originalFieldName: x.name, type: x.type,
        alias: x.alias ?? '', description: x.description ?? '', isHidden: false, isCalculated: false, aliasPath: h.aliasPath, outputPrefix: t.title, transitiveDepth: h.depth,
      }));
    });
    const hiddenFieldNames = hops.flatMap((h) => byId.get(h.martId)!.fields.filter((x) => x.isHiddenForReporting).map((x) => blendedName(h.aliasPath, x.name)));
    return { blendedFields, availableSources, hiddenFieldNames };
  }

  // One row of a joined mart per value of the join key, built once per link.
  const joinIndexes = new Map<string, Map<string, Row>>();
  function joinIndex(e: EdgeDto): Map<string, Row> {
    let idx = joinIndexes.get(e.id);
    if (!idx) {
      idx = new Map();
      const key = (r: Row, fields: string[]) => JSON.stringify(fields.map((x) => r[x] ?? null));
      for (const r of byId.get(e.targetDataMartId)!.rows) idx.set(key(r, e.joinConditions.map((j) => j.targetFieldName)), r);
      joinIndexes.set(e.id, idx);
    }
    return idx;
  }
  /** The value of a blended column for one row of the main mart: follow each link to its joined row, then read the field. */
  function blendedValue(main: Row, hop: Hop, field: string): unknown {
    let cur: Row | undefined = main;
    for (const e of hop.edges) {
      if (!cur) return null;
      cur = joinIndex(e).get(JSON.stringify(e.joinConditions.map((j) => cur![j.sourceFieldName] ?? null)));
    }
    return cur?.[field] ?? null;
  }
  /** Like the backend: a field hidden for reporting is not a column a query or a report may name. */
  const badRequest = (message: string) => Object.assign(new Error(message), { payload: { code: 'HTTP_ERROR', status: 400 } });
  function rejectHidden(martId: string, names: string[]) {
    const hidden = new Set<string>();
    byId.get(martId)?.fields.filter((x) => x.isHiddenForReporting).forEach((x) => hidden.add(x.name));
    for (const h of joinTree(martId)) byId.get(h.martId)!.fields.filter((x) => x.isHiddenForReporting).forEach((x) => hidden.add(blendedName(h.aliasPath, x.name)));
    const bad = names.find((n) => hidden.has(n));
    if (bad) throw badRequest(`Unknown column: ${bad}`);
  }
  const blendedIndex = (martId: string) => {
    const index = new Map<string, { hop: Hop; field: string }>();
    for (const h of joinTree(martId)) for (const x of byId.get(h.martId)!.fields) index.set(blendedName(h.aliasPath, x.name), { hop: h, field: x.name });
    return index;
  };

  function traverse(id: string, o: TraverseOptions): Row[] {
    const m = byId.get(id);
    if (!m) throw new Error(`Data Mart ${id} not found`);
    if (!m.accessible) throw new Error('You do not have access to this Data Mart');
    // Columns, filters and sorts may name fields of joined marts: those are read off the joined row and added to each row.
    rejectHidden(id, [...(o.column ?? []), ...(o.filter ?? []).map((x) => x.column), ...(o.sort ?? []).map((x) => x.column)]);
    const index = blendedIndex(id);
    // A unique count per source: the main mart (`''`) by its primary key, a joined one by its alias path, its key read off the joined row.
    const uniq: UniqueSource[] = (o.uniqueCount ?? []).map((path) => {
      if (!path) return { key: 'Unique Count', pk: m.fields.filter((x) => x.isPrimaryKey).map((x) => x.name) };
      const hop = joinTree(id).find((h) => h.aliasPath === path);
      if (!hop) throw badRequest(`Unknown source: ${path}`);
      return { key: `${path.replaceAll('.', '_')}__unique_count`, pk: byId.get(hop.martId)!.fields.filter((x) => x.isPrimaryKey).map((x) => blendedName(path, x.name)) };
    });
    const wanted = [...new Set([...(o.column ?? []), ...(o.filter ?? []).map((x) => x.column), ...(o.sort ?? []).map((x) => x.column), ...uniq.flatMap((u) => u.pk)].filter((n) => index.has(n)))];
    const source = wanted.length ? m.rows.map((r) => ({ ...r, ...Object.fromEntries(wanted.map((n) => [n, blendedValue(r, index.get(n)!.hop, index.get(n)!.field)])) })) : m.rows;
    let rows = source.filter((r) => (o.filter ?? []).every((flt) => matchesFilter(r, flt)));
    if (uniq.length && !o.column?.length) return [Object.fromEntries(uniq.map((u) => [u.key, distinctKeys(rows, u.pk)]))];
    if (uniq.length || o.aggregation?.length || o.dateTrunc?.length) {
      if (!o.column?.length) throw badRequest('Aggregation requires an explicit column list');
      const grouped = aggregateRows(rows, o.column, o.aggregation ?? [], o.dateTrunc ?? [], o.sort ?? [], uniq);
      return o.limit !== undefined ? grouped.slice(0, o.limit) : grouped;
    }
    const keys = o.sort ?? [];
    if (keys.length) {
      rows = [...rows].sort((x, y) => {
        for (const s of keys) {
          const a = x[s.column], b = y[s.column];
          const d = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
          if (d !== 0) return s.direction === 'asc' ? d : -d;
        }
        return 0;
      });
    }
    if (o.limit !== undefined) rows = rows.slice(0, o.limit);
    if (o.column) {
      const cols = o.column;
      rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return rows;
  }

  return {
    projectId: 'mock-project',
    theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    signal: new AbortController().signal,
    route: new URLSearchParams(location.search).get('route') ?? '/',
    ui: {
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); },
      copyLink: async (path) => {
        window.__copiedLink = path;
        try { await navigator.clipboard?.writeText(path ?? ''); } catch { /* the clipboard may be blocked */ }
      },
      setRoute: (path) => {
        window.__routeSet = path;
        const url = new URL(location.href);
        if (path === '/') url.searchParams.delete('route'); else url.searchParams.set('route', path);
        history.replaceState(history.state, '', url);
      },
    },
    credentials: opts.ai === false ? {} : { ai: createFakeAi() },
    collections: <T,>(name: string) => ({
      get: async (id: string) => { const k = `${name}/${id}`; return docs.has(k) ? { document: docs.get(k) as T } : null; },
      put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); return d; },
    }),
    owox: {
      storages: { list: () => slow(() => f.storages) },
      models: { getEdges: (sid) => slow(() => f.edges.filter((e) => byId.get(e.sourceDataMartId)?.storageId === sid)) },
      dataMarts: {
        list: () => slow(() => f.marts.filter((m) => m.accessible).map((m) => ({
          id: m.id, title: m.title, description: m.description, availableForReporting: true, definitionType: m.definitionType, connectorSourceName: m.connectorSourceName,
          contexts: m.contexts.map((cid) => { const c = f.contexts.find((x) => x.id === cid)!; return { id: c.id, name: c.name, icon: c.icon ?? null }; }),
        }))),
        traverseData: async (id, o) => {
          const rows = await slow(() => traverse(id, o));
          return {
            async *rowChunks() { for (let i = 0; i < rows.length; i += 100) { if (latency) await wait(latency / 4); yield rows.slice(i, i + 100); } },
            cancel: async () => {},
          };
        },
      },
      destinations: { list: () => slow(() => f.destinations) },
      getJson: <T,>(path: string, query?: Record<string, string>) => slow(() => {
        if (path === '/api/search') return mockSearch(f, query) as T;
        if (path === '/api/data-destinations') return f.destinations as T;
        const byMart = /^\/api\/reports\/data-mart\/([^/]+)$/.exec(path);
        if (byMart) return [...reports.values()].filter((r) => r.dataMartId === decodeURIComponent(byMart[1]!)) as T;
        const one = /^\/api\/reports\/([^/]+)$/.exec(path);
        if (one) return report(decodeURIComponent(one[1]!)) as T;
        if (path === '/api/contexts') return f.contexts as T;
        if (path === '/api/connectors') return f.connectors as T;
        if (path === '/api/model-canvas/data-marts') {
          const items = f.marts.filter((m) => m.storageId === query?.storageId).map((m) => ({
            id: m.id, title: m.title, description: m.description, icon: m.icon, fieldCount: m.fields.length, status: 'PUBLISHED',
            dataLastUpdated: m.dataLastUpdatedAt ? { dataLastUpdatedAt: m.dataLastUpdatedAt, computedAt: m.dataLastUpdatedAt } : null,
          }));
          return { items, total: items.length, nextOffset: null } as T;
        }
        const blend = /^\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(path);
        if (blend) return blendableSchema(decodeURIComponent(blend[1]!)) as T;
        const detail = /^\/api\/data-marts\/([^/]+)$/.exec(path);
        if (detail) {
          const m = byId.get(decodeURIComponent(detail[1]!));
          if (!m) throw new Error('Not found');
          return { id: m.id, schema: { fields: m.fields } } as T;
        }
        throw new Error(`Mock: unhandled GET ${path}`);
      }),
      putJson: <T,>(path: string, body: unknown) => slow(() => {
        const m = /^\/api\/reports\/([^/]+)$/.exec(path);
        if (!m) throw new Error(`Mock: unhandled PUT ${path}`);
        const cur = report(decodeURIComponent(m[1]!));
        const b = body as { columnConfig?: string[]; filterConfig?: { column: string }[] | null; sortConfig?: { column: string }[] | null };
        rejectHidden(cur.dataMartId, [...(b.columnConfig ?? []), ...(b.filterConfig ?? []).map((x) => x.column), ...(b.sortConfig ?? []).map((x) => x.column)]);
        Object.assign(cur, body);
        return cur as T;
      }),
      postJson: <T,>(path: string, body: unknown) => slow(() => {
        const doc = /^\/api\/data-destinations\/([^/]+)\/google-sheets\/documents$/.exec(path);
        if (doc) {
          if (!f.destinations.some((d) => d.id === decodeURIComponent(doc[1]!))) throw notFound('Destination');
          sheetSerial += 1;
          return { spreadsheetId: `mock-sheet-${sheetSerial}`, sheetId: 0, placedInRoot: false, sharedWithRequester: true } as T;
        }
        if (path === '/api/reports') {
          const b = body as { dataMartId: string; columnConfig?: string[]; filterConfig?: { column: string }[] | null; sortConfig?: { column: string }[] | null };
          rejectHidden(b.dataMartId, [...(b.columnConfig ?? []), ...(b.filterConfig ?? []).map((x) => x.column), ...(b.sortConfig ?? []).map((x) => x.column)]);
          reportSerial += 1;
          const r: MockReport = { ...(body as object), id: `mock-report-${reportSerial}`, dataMartId: (body as { dataMartId: string }).dataMartId, lastRunAt: null, lastRunStatus: null, lastRunError: null };
          reports.set(r.id, r);
          return r as T;
        }
        const run = /^\/api\/reports\/([^/]+)\/run$/.exec(path);
        if (run) {
          const r = report(decodeURIComponent(run[1]!));
          if (r.lastRunStatus !== 'RUNNING') {
            r.lastRunStatus = 'RUNNING';
            setTimeout(() => { r.lastRunAt = new Date().toISOString(); r.lastRunStatus = 'SUCCESS'; }, RUN_MS);
          }
          return undefined as T;
        }
        if (path !== '/api/data-marts/data-quality/summaries') throw new Error(`Mock: unhandled POST ${path}`);
        const ids = (body as { dataMartIds: string[] }).dataMartIds;
        return { items: ids.flatMap((id) => { const dq = byId.get(id)?.dq; return dq ? [{ dataMartId: id, summary: dq }] : []; }) } as T;
      }),
    },
  };
}
