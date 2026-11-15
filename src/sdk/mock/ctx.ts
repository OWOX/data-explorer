import type { Ctx, Row, TraverseOptions } from '../types';
import { matchesFilter } from './evaluate';
import { demoFixtures, type Fixtures } from './fixtures';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockCtx(f: Fixtures = demoFixtures(), opts: { latencyMs?: number } = {}): Ctx {
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
  const RUN_MS = 1000;

  function traverse(id: string, o: TraverseOptions): Row[] {
    const m = byId.get(id);
    if (!m) throw new Error(`Data Mart ${id} not found`);
    if (!m.accessible) throw new Error('You do not have access to this Data Mart');
    let rows = m.rows.filter((r) => (o.filter ?? []).every((flt) => matchesFilter(r, flt)));
    if (o.uniqueCount) return [{ 'Unique Count': rows.length }];
    if (o.aggregation?.length) {
      const a = o.aggregation[0]!;
      return [{ [`${a.column} | COUNT`]: rows.filter((r) => r[a.column] != null).length }];
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
    ui: { openExternal: async (url) => { window.open(url, '_blank', 'noopener'); } },
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
