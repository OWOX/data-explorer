import type { AvailableSourceDto, BlendableSchemaDto, BlendedFieldDto, Ctx, EdgeDto, Row, TraverseOptions } from '../types';
import { aggregatedKey, allowedFunctions, knownFunctions } from '../../model/aggregation';
import { categorizeFieldType } from '../../model/field-category';
import { aggregateRows, distinctKeys, sortRows, type UniqueSource } from './aggregate';
import { matchesFilter } from './evaluate';
import { createFakeAi } from './ai';
import { demoFixtures, demoReports, type Fixtures, type MockReportFixture } from './fixtures';
import { mockSearch } from './search';
import { sleep } from '../../api/sleep';

declare global { interface Window { __copiedLink?: string; __routeSet?: string } }

export function createMockCtx(f: Fixtures = demoFixtures(), opts: { latencyMs?: number; runMs?: number; /** false: no AI credential, as in a project that has not configured one. */ ai?: boolean; /** How many hops a joined mart may be from the main one (2 by default). */ maxJoinDepth?: number } = {}): Ctx {
  const latency = opts.latencyMs ?? 0;
  const byId = new Map(f.marts.map((m) => [m.id, m]));
  const docs = new Map<string, unknown>();
  const slow = async <T,>(v: () => T): Promise<T> => { if (latency) await sleep(latency); return v(); };

  type MockReport = Record<string, unknown> & { id: string; dataMartId: string; lastRunAt: string | null; lastRunStatus: string | null; lastRunError: string | null };
  const reports = new Map<string, MockReport>(demoReports(f).map((r) => [r.id, r]));
  let sheetSerial = 0;
  let reportSerial = 0;
  let martSerial = 0;
  const runs = new Map<string, string>();
  let runSeq = 0;
  const mockSql = (id: string, o: TraverseOptions) =>
    `SELECT ${(o.column ?? ['*']).map((c) => (c === '*' ? c : `\`${c}\``)).join(', ')}\nFROM \`mock.${id}\`${o.limit ? `\nLIMIT ${o.limit}` : ''}`;
  const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { payload: { code: 'HTTP_ERROR', status: 404 } });
  /** OWOX answers a report with its destination as `dataDestinationAccess`, whatever the write called it (`dataDestinationId`). */
  const accessOf = (body: unknown) => { const id = (body as { dataDestinationId?: string }).dataDestinationId; return id ? { dataDestinationAccess: { id } } : {}; };
  const report = (id: string) => reports.get(id) ?? (() => { throw notFound('Report'); })();
  // How long a report run takes before it reports success.
  const RUN_MS = opts.runMs ?? 1000;

  // The data marts a mart can pull fields from: its outgoing many-to-one links, and theirs, two hops deep. Each is named by the
  // dotted path of the marts it passes through, like OWOX's alias path, and its fields by that path and the field (`customers__email`).
  const MAX_JOIN_DEPTH = opts.maxJoinDepth ?? 2;
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
  const covers = (key: string[], pks: string[]) => pks.length > 0 && pks.every((k) => key.includes(k));
  const pkOf = (id: string) => byId.get(id)!.fields.filter((x) => x.isPrimaryKey).map((x) => x.name);
  /** One-to-many, as the backend's hopGrain: a hop keyed by its parent's primary key ('none') adds no rows to the parent; any other key fans out. */
  const keyedByParentPk = (e: EdgeDto): boolean => covers(e.joinConditions.map((j) => j.sourceFieldName), pkOf(e.sourceDataMartId));
  /** Lookup, as the backend's hopGrain: a hop keyed by its target's primary key ('none') matches a parent row to at most one target row. */
  const keyedByTargetPk = (e: EdgeDto): boolean => covers(e.joinConditions.map((j) => j.targetFieldName), pkOf(e.targetDataMartId));
  const blendedName = (aliasPath: string, field: string) => `${aliasPath.replaceAll('.', '__')}__${field}`;

  function blendableSchema(martId: string): BlendableSchemaDto {
    if (!byId.has(martId)) throw notFound('Data Mart');
    const hops = joinTree(martId);
    const availableSources: AvailableSourceDto[] = hops.map((h) => {
      const t = byId.get(h.martId)!;
      return { aliasPath: h.aliasPath, title: t.title, defaultAlias: t.title, depth: h.depth, dataMartId: t.id, relationshipId: h.edges.at(-1)!.id, isIncluded: true, isAccessibleForReporting: t.accessible, uniqueCountAvailability: t.fields.some((x) => x.isPrimaryKey) ? 'available' : 'no-primary-key', mainGrainMultiplication: h.edges.every(keyedByParentPk) ? 'none' : 'multiplies', mainGrainCollapse: h.edges.every(keyedByTargetPk) ? 'none' : 'collapses' };
    });
    const blendedFields: BlendedFieldDto[] = hops.flatMap((h) => {
      const t = byId.get(h.martId)!;
      return t.fields.filter((x) => !x.isHiddenForReporting).map((x): BlendedFieldDto => ({
        name: blendedName(h.aliasPath, x.name), sourceDataMartId: t.id, sourceDataMartTitle: t.title, originalFieldName: x.name, type: x.type,
        alias: x.alias ?? '', description: x.description ?? '', isHidden: false, isCalculated: false, aliasPath: h.aliasPath, outputPrefix: t.title, transitiveDepth: h.depth,
        // The backend always sends the post-join list: join-level config clamped to the effective type (here, the type's defaults).
        // The joined mart's own per-field list does not govern a blended column.
        postJoinAggregations: governedByType(x.type),
        aggregateFunction: defaultJoinFunction(x.type),
      }));
    });
    return { blendedFields, availableSources };
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
  const hiddenSets = new Map<string, Set<string>>();
  function hiddenOf(martId: string): Set<string> {
    let hidden = hiddenSets.get(martId);
    if (!hidden) {
      hidden = new Set();
      byId.get(martId)?.fields.filter((x) => x.isHiddenForReporting).forEach((x) => hidden!.add(x.name));
      for (const h of joinTree(martId)) byId.get(h.martId)!.fields.filter((x) => x.isHiddenForReporting).forEach((x) => hidden!.add(blendedName(h.aliasPath, x.name)));
      hiddenSets.set(martId, hidden);
    }
    return hidden;
  }
  function rejectHidden(martId: string, names: string[]) {
    const hidden = hiddenOf(martId);
    const bad = names.find((n) => hidden.has(n));
    if (bad) throw badRequest(`Unknown column: ${bad}`);
  }
  const blendedIndexes = new Map<string, Map<string, { hop: Hop; field: string }>>();
  const blendedIndex = (martId: string) => {
    let index = blendedIndexes.get(martId);
    if (!index) {
      index = new Map();
      for (const h of joinTree(martId)) for (const x of byId.get(h.martId)!.fields) index.set(blendedName(h.aliasPath, x.name), { hop: h, field: x.name });
      blendedIndexes.set(martId, index);
    }
    return index;
  };
  /** Every column a request names: its columns, then the columns of its filters and sorts. */
  const named = (b: { column?: string[]; columnConfig?: string[]; filter?: { column: string }[]; filterConfig?: { column: string }[] | null; sort?: { column: string }[]; sortConfig?: { column: string }[] | null }) =>
    [...(b.column ?? b.columnConfig ?? []), ...(b.filter ?? b.filterConfig ?? []).map((x) => x.column), ...(b.sort ?? b.sortConfig ?? []).map((x) => x.column)];

  /** The backend's default join-level roll-up: SUM for numbers, MAX for dates and times, else STRING_AGG. */
  const defaultJoinFunction = (type: string): string => { const c = categorizeFieldType(type); return c === 'number' ? 'SUM' : c === 'date' || c === 'time' ? 'MAX' : 'STRING_AGG'; };
  /** What the backend allows on a blended column: the effective type's defaults (the mock has no join-level overrides). */
  const governedByType = (type: string): string[] => allowedFunctions({ category: categorizeFieldType(type) });
  /** What the backend allows on a field of the mart itself: its own list, else the type's defaults. */
  const governedOwn = (x: { type: string; allowedAggregations?: string[] }): string[] => allowedFunctions({ category: categorizeFieldType(x.type), ...(x.allowedAggregations ? { allowedAggregations: knownFunctions(x.allowedAggregations) } : {}) });
  function rejectUngoverned(martId: string, rules: { column: string; function: string }[]) {
    const index = blendedIndex(martId);
    const own = new Map(byId.get(martId)!.fields.map((x) => [x.name, x]));
    for (const r of rules) {
      const hit = index.get(r.column);
      const field = hit ? byId.get(hit.hop.martId)!.fields.find((x) => x.name === hit.field) : own.get(r.column);
      const allowed = field && (hit ? governedByType(field.type) : governedOwn(field));
      if (allowed && !allowed.includes(r.function)) throw badRequest(`Aggregation ${r.function} is not allowed for field ${r.column}`);
    }
  }

  function traverse(id: string, o: TraverseOptions): Row[] {
    const m = byId.get(id);
    if (!m) throw new Error(`Data Mart ${id} not found`);
    if (!m.accessible) throw new Error('You do not have access to this Data Mart');
    // Columns, filters and sorts may name fields of joined marts: those are read off the joined row and added to each row.
    rejectHidden(id, named(o));
    const index = blendedIndex(id);
    // Like the backend: a slice (pre-join rule) must name a joined field and takes no function; a HAVING rule must match an aggregation.
    const slices = (o.filter ?? []).filter((x) => x.placement === 'pre-join');
    const having = (o.filter ?? []).filter((x) => x.placement !== 'pre-join' && x.function);
    const plain = (o.filter ?? []).filter((x) => x.placement !== 'pre-join' && !x.function);
    for (const sl of slices) {
      if (sl.function) throw badRequest(`A pre-join filter cannot have a function: ${sl.column}`);
      if (!index.has(sl.column)) throw badRequest(`A pre-join filter must name a field of a joined data mart: ${sl.column}`);
    }
    for (const h of having) if (!(o.aggregation ?? []).some((a) => a.column === h.column && a.function === h.function)) throw badRequest(`No aggregation matches the filter on ${h.function}(${h.column})`);
    // A unique count per source: the main mart (`''`) by its primary key, a joined one by its alias path, its key read off the joined row.
    const uniq: UniqueSource[] = (o.uniqueCount ?? []).map((path) => {
      if (!path) return { key: 'Unique Count', pk: m.fields.filter((x) => x.isPrimaryKey).map((x) => x.name) };
      const hop = joinTree(id).find((h) => h.aliasPath === path);
      if (!hop) throw badRequest(`Unknown source: ${path}`);
      return { key: `${path.replaceAll('.', '_')}__unique_count`, pk: byId.get(hop.martId)!.fields.filter((x) => x.isPrimaryKey).map((x) => blendedName(path, x.name)) };
    });
    const wanted = [...new Set([...named(o), ...uniq.flatMap((u) => u.pk)].filter((n) => index.has(n)))];
    const underPath = (path: string, of: string) => path === of || path.startsWith(`${of}.`);
    const source = wanted.length ? m.rows.map((r) => {
      const row: Row = { ...r, ...Object.fromEntries(wanted.map((n) => [n, blendedValue(r, index.get(n)!.hop, index.get(n)!.field)])) };
      // The mock evaluates a slice on the joined value, which equals the raw value for its many-to-one joins.
      // A slice acts as a LEFT JOIN: where the joined values fail it, the row stays and the alias path and its descendants are empty.
      const failed = slices.filter((sl) => !matchesFilter({ [sl.column]: row[sl.column] }, { ...sl, placement: undefined })).map((sl) => index.get(sl.column)!.hop.aliasPath);
      if (failed.length) for (const n of wanted) if (failed.some((p) => underPath(index.get(n)!.hop.aliasPath, p))) row[n] = null;
      return row;
    }) : m.rows;
    let rows = source.filter((r) => plain.every((flt) => matchesFilter(r, flt)));
    if (uniq.length && !o.column?.length) return [Object.fromEntries(uniq.map((u) => [u.key, distinctKeys(rows, u.pk)]))];
    if (uniq.length || o.aggregation?.length || o.dateTrunc?.length) {
      if (!o.column?.length) throw badRequest('Aggregation requires an explicit column list');
      rejectUngoverned(id, o.aggregation ?? []);
      let grouped = aggregateRows(rows, o.column, o.aggregation ?? [], o.dateTrunc ?? [], o.sort ?? [], uniq);
      // HAVING compares the grouped row's aggregate output column.
      if (having.length) grouped = grouped.filter((g) => having.every((h) => matchesFilter(g, { ...h, column: aggregatedKey(h.column, h.function!), function: undefined, placement: undefined })));
      return o.limit !== undefined ? grouped.slice(0, o.limit) : grouped;
    }
    rows = sortRows(rows, o.sort ?? [], (s) => s.column);
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
    credentials: opts.ai === false ? {} : { ai: createFakeAi(latency) },
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
          const runId = `mock-run-${++runSeq}`;
          runs.set(runId, mockSql(id, o));
          // Only when asked, like the backend; the count is the same read without its limit.
          const totalRowCount = o.includeTotalRowCount ? traverse(id, { ...o, limit: undefined }).length : undefined;
          return {
            runId,
            ...(totalRowCount !== undefined ? { totalRowCount } : {}),
            async *rowChunks() { for (let i = 0; i < rows.length; i += 100) { if (latency) await sleep(latency / 4); yield rows.slice(i, i + 100); } },
            cancel: async () => {},
          };
        },
      },
      destinations: { list: () => slow(() => f.destinations) },
      getJson: <T,>(path: string, query?: Record<string, string>) => slow(() => {
        // Reports created through the mock POST carry no `dataMart`, so the mock search skips them.
        if (path === '/api/search') return mockSearch(f, query, [...reports.values()].filter((r): r is MockReportFixture => typeof r.title === 'string' && 'dataMart' in r)) as T;
        if (/^\/api\/data-marts\/[^/]+\/schema-actualize-triggers\/[^/]+\/status$/.test(path)) return { status: 'SUCCESS' } as T;
        if (/^\/api\/data-marts\/[^/]+\/schema-actualize-triggers\/[^/]+$/.test(path)) return { success: true } as T;
        const run = /^\/api\/data-marts\/([^/]+)\/runs\/([^/]+)$/.exec(path);
        if (run) {
          const sql = runs.get(decodeURIComponent(run[2]!));
          if (sql === undefined) throw notFound('Run');
          return { id: decodeURIComponent(run[2]!), additionalParams: { httpData: { executionSqlQuery: sql } } } as T;
        }
        const one = /^\/api\/reports\/([^/]+)$/.exec(path);
        if (one) return report(decodeURIComponent(one[1]!)) as T;
        if (path === '/api/contexts') return f.contexts as T;
        if (path === '/api/connectors') return f.connectors as T;
        if (path === '/api/connectors/custom/summaries') {
          const wanted = new Set((query?.names ?? '').split(',').filter(Boolean).map((n) => n.toLowerCase()));
          return f.customConnectors.filter((c) => wanted.has(c.name.toLowerCase())) as T;
        }
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
        if (/^\/api\/data-marts\/[^/]+\/(definition|publish|availability)$/.test(path)) return {} as T;
        const m = /^\/api\/reports\/([^/]+)$/.exec(path);
        if (!m) throw new Error(`Mock: unhandled PUT ${path}`);
        const cur = report(decodeURIComponent(m[1]!));
        const b = body as { columnConfig?: string[]; filterConfig?: { column: string }[] | null; sortConfig?: { column: string }[] | null };
        rejectHidden(cur.dataMartId, named(b));
        Object.assign(cur, body, accessOf(body));
        return cur as T;
      }),
      deleteJson: <T,>(path: string) => slow(() => {
        if (/^\/api\/data-marts\/[^/]+$/.test(path)) return {} as T;
        throw new Error(`Mock: unhandled DELETE ${path}`);
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
          rejectHidden(b.dataMartId, named(b));
          reportSerial += 1;
          const r: MockReport = { ...(body as object), ...accessOf(body), id: `mock-report-${reportSerial}`, dataMartId: (body as { dataMartId: string }).dataMartId, lastRunAt: null, lastRunStatus: null, lastRunError: null };
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
        if (path === '/api/data-marts') { martSerial += 1; return { id: `mock-mart-${martSerial}`, title: (body as { title: string }).title } as T; }
        if (/^\/api\/data-marts\/[^/]+\/schema-actualize-triggers$/.test(path)) return { triggerId: 'mock-trigger' } as T;
        if (path !== '/api/data-marts/data-quality/summaries') throw new Error(`Mock: unhandled POST ${path}`);
        const ids = (body as { dataMartIds: string[] }).dataMartIds;
        return { items: ids.flatMap((id) => { const dq = byId.get(id)?.dq; return dq ? [{ dataMartId: id, summary: dq }] : []; }) } as T;
      }),
    },
  };
}
