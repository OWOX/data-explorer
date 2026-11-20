import type { Aggregation, AggregationRule, DateTruncRule } from '../model/aggregation';
import { toTraverseFilters, type ColumnFilter } from '../filters/build';
import type { SortKey } from '../model/sort';
import type { Schema } from '../model/types';
import type { Ctx, DestinationDto, TraverseFilter } from '../sdk/types';

export const EXPORTS_COLLECTION = 'exports';
export const MAX_EXPORT_SORTS = 10;
export const MAX_EXPORT_FILTERS = 50;
export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 3 * 60_000;

/** What is remembered of a report this member exported to, per data mart. Everything else is read live from OWOX. */
export type StoredReport = { reportId: string; /** ISO time of the last export into this report; absent means never used. */ usedAt?: string };
type ExportsDoc = { reports: StoredReport[] };

/** A report as OWOX has it now, plus the stored `usedAt`. An unrecognised spreadsheet target has `spreadsheetId: ''`. */
export type ExportedReport = { reportId: string; destinationId: string; spreadsheetId: string; sheetId: number; title: string; usedAt?: string };

/** One remembered report in the session cache: `report` is set only when `state` is `'ready'`. */
export type ReportEntry = { reportId: string; usedAt?: string; state: 'loading' | 'ready' | 'failed'; report?: ExportedReport };

/** The grid state as an OWOX report carries it. */
export type ReportPayload = {
  columnConfig: string[];
  filterConfig: TraverseFilter[] | null;
  sortConfig: { column: string; direction: 'asc' | 'desc' }[] | null;
  /** The exported columns: without it the run collapses rows into DISTINCT/aggregates and the sheet differs from the grid. */
  autoAggregationOptOut: string[];
  /** Present only for a grouped grid, as the report carries them: the same rules the grid sent. */
  aggregationConfig?: AggregationRule[];
  dateTruncConfig?: DateTruncRule[];
};

export type PayloadResult = { payload: ReportPayload; notes: string[] };

/** The report that reproduces what the grid shows: shown columns, complete filters (HAVING ones with their aggregation) and slices, the reader's own sorts. */
export function buildReportPayload(schema: Schema, visible: string[], filters: ColumnFilter[], sorts: SortKey[], agg?: Aggregation, slices: ColumnFilter[] = []): PayloadResult {
  const notes: string[] = [];
  const known = new Set(schema.map((f) => f.name));
  // In the grid's order (the main mart's columns, then each joined mart's), keeping the names the schema has.
  const columnConfig = visible.filter((n) => known.has(n));
  const aggregations = (agg?.aggregations ?? []).filter((r) => columnConfig.includes(r.column));
  const dateTrunc = (agg?.dateTrunc ?? []).filter((r) => columnConfig.includes(r.column));
  let filter = toTraverseFilters(schema, filters, slices, aggregations);
  if (filter.length > MAX_EXPORT_FILTERS) { notes.push(`Only the first ${MAX_EXPORT_FILTERS} filters were exported.`); filter = filter.slice(0, MAX_EXPORT_FILTERS); }
  let sort = sorts.map((s) => ({ column: s.field, direction: s.direction }));
  if (sort.length > MAX_EXPORT_SORTS) { notes.push(`Only the first ${MAX_EXPORT_SORTS} sorts were exported.`); sort = sort.slice(0, MAX_EXPORT_SORTS); }
  return {
    payload: {
      columnConfig, filterConfig: filter.length ? filter : null, sortConfig: sort.length ? sort : null,
      // Without the opt-out the run collapses rows on its own and the sheet differs from the grid. With a rule of its own the
      // run is already aggregated (auto-collapse stands down), so the opt-out lists the columns the member aggregated by nothing.
      autoAggregationOptOut: columnConfig.filter((c) => !aggregations.some((r) => r.column === c)),
      ...(aggregations.length ? { aggregationConfig: aggregations } : {}),
      ...(dateTrunc.length ? { dateTruncConfig: dateTrunc } : {}),
    },
    notes,
  };
}

/** "Orders · Data Explorer · 2026-11-15 14:05" */
export function exportTitle(martTitle: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${martTitle} · Data Explorer · ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

export type SheetTarget = { spreadsheetId: string; sheetId: number };

/** The spreadsheet id and tab (`#gid=`, default 0) in a pasted Google Sheets URL, or null. */
export function parseSheetUrl(raw: string): SheetTarget | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const id = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1];
  if (!id) return null;
  const gid = /(?:^#|[#&?])gid=(\d+)/.exec(url.hash)?.[1] ?? url.searchParams.get('gid');
  return { spreadsheetId: id, sheetId: gid && /^\d+$/.test(gid) ? Number(gid) : 0 };
}

/** A published-to-web link (`/d/e/…`) is not the spreadsheet's id and cannot be written to. */
export const isPublishedSheetUrl = (raw: string) => /\/spreadsheets\/d\/e\//.test(raw);

const SPREADSHEET_ID = /^[A-Za-z0-9_-]+$/;
export const isSheetTarget = (t: { spreadsheetId: unknown; sheetId: unknown }): t is SheetTarget =>
  typeof t.spreadsheetId === 'string' && SPREADSHEET_ID.test(t.spreadsheetId) && typeof t.sheetId === 'number' && Number.isSafeInteger(t.sheetId) && t.sheetId >= 0;

/** The tab's address, or null when the id is not a plain spreadsheet id: an id read from OWOX must not steer the link elsewhere. */
export const sheetUrl = (t: { spreadsheetId: string; sheetId: number }): string | null =>
  isSheetTarget(t) ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(t.spreadsheetId)}/edit#gid=${t.sheetId}` : null;

export const isSheetsDestination = (d: DestinationDto) => d.type === 'GOOGLE_SHEETS' && d.availableForUse !== false;

type LiveReportDto = { title?: string; dataDestinationAccess?: { id?: string }; destinationConfig?: { spreadsheetId?: unknown; sheetId?: unknown } };
type ReportDto = { id: string; lastRunAt?: string | null; lastRunStatus?: string | null; lastRunError?: string | null };
type DocumentDto = { spreadsheetId: string; sheetId: number };

export type Stage = 'sheet' | 'report' | 'run';
/** A failure at a named step, so the caller can tell a spreadsheet that could not be created from a run that failed. */
export class ExportError extends Error {
  /** `code` is the SDK transport code (`TIMEOUT`...); `target` is the spreadsheet a failed report step leaves behind. */
  constructor(public stage: Stage, message: string, public code?: string, public target?: SheetTarget, /** The report to update no longer exists in OWOX (the exporter has forgotten it). */ public gone = false) { super(message); }
}
export const REPORT_GONE = 'This report no longer exists in OWOX';
/** The update failed because OWOX no longer has the report. */
export const isGone = (e: unknown): e is ExportError => e instanceof ExportError && e.gone;
/** The SDK transport puts its code on `payload`; a plain `code` is kept as a fallback. */
const codeOf = (e: unknown) => {
  const x = e as { payload?: { code?: string; status?: number }; code?: string } | null;
  const status = x?.payload?.status;
  // A gateway error says nothing about whether the request got through.
  if (status === 502 || status === 504) return `HTTP_${status}`;
  return x?.payload?.code ?? x?.code;
};
/** The answer to a report POST was lost or came from a gateway: the report may exist, so the step must not be retried. */
export const reportMayExist = (e: unknown) => e instanceof ExportError && e.stage === 'report' && ['TIMEOUT', 'NETWORK_ERROR', 'HTTP_502', 'HTTP_504'].includes(e.code ?? '');
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The SDK transport puts the HTTP status on `payload`; a plain `status` is kept as a fallback. */
export const isNotFound = (e: unknown) => { const x = e as { payload?: { status?: number }; status?: number } | null; return (x?.payload?.status ?? x?.status) === 404; };

export type Outcome = { state: 'success' | 'failed' | 'timeout' | 'busy'; error?: string };
export type ExportSource =
  | { kind: 'new' }
  | { kind: 'existing'; target: SheetTarget }
  | { kind: 'update'; report: ExportedReport };

export type RunResult = { report: ExportedReport; outcome: Outcome };

/** An export that has started for a mart. It outlives the menu that started it, so a remounted menu can pick it up. */
export interface Flight {
  stage: Stage;
  sourceKind: ExportSource['kind'];
  notes: string[];
  promise: Promise<RunResult>;
  /** The promise has settled (the result was not taken yet when the entry is still listed). */
  settled: boolean;
  subscribe(cb: (s: Stage) => void): () => void;
}

export interface Exporter {
  /** The member's usable Google Sheets destinations; read once per session until `invalidate()`. */
  destinations(): Promise<DestinationDto[]>;
  /** Drops the destinations and every mart's live report cache and notifies subscribers; a subscriber that still wants the reports calls `load` again. */
  invalidate(): void;
  /** The remembered reports for a mart (ids and `usedAt`), without any OWOX call. */
  stored(martId: string): Promise<StoredReport[]>;
  /** The remembered reports when the document is already known (no wait), else undefined. */
  storedNow(martId: string): StoredReport[] | undefined;
  /** Starts the live reads of a mart's remembered reports, all in parallel. Once per mart per session: later calls do nothing until `invalidate()` or an export to the mart finishes. */
  load(martId: string): void;
  /** The session cache for a mart: empty before `load`; reports OWOX no longer has (404) are removed here and from the stored document. The same array is returned until something changes. */
  entries(martId: string): ReportEntry[];
  /** Calls `cb` after each change to the mart's entries. Returns the unsubscribe. Subscriptions survive `invalidate()` and reloads. */
  subscribe(martId: string, cb: () => void): () => void;
  /** Re-reads one report whose read failed. */
  retry(martId: string, reportId: string): void;
  /** Removes a report from the cache and from the stored document. */
  forget(martId: string, reportId: string): Promise<void>;
  /** One export at a time per mart: a second `run` for a mart that has one in flight is refused. */
  run(a: {
    martId: string; destination: DestinationDto; title: string; source: ExportSource; payload: ReportPayload;
    notes?: string[]; onStage?: (s: Stage) => void; signal?: AbortSignal;
  }): Promise<RunResult>;
  /** The export in flight for a mart, or one that finished while nobody followed it, until `acknowledge`. */
  inFlight(martId: string): Flight | undefined;
  acknowledge(martId: string): void;
  /** The spreadsheet a failed report step left for this mart: a retry to the same destination reuses it (another destination's account may not reach it). Cleared when a report is made or another target is used. */
  made(martId: string, destinationId: string): SheetTarget | undefined;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createExporter(ctx: Ctx): Exporter {
  const col = ctx.collections<ExportsDoc>(EXPORTS_COLLECTION);
  /** The stored document per mart, read once. */
  const docs = new Map<string, StoredReport[]>();
  /** `started` is false until the stored document has been read and its reports listed; a change before that is picked up by the start itself. */
  type MartCache = { entries: ReportEntry[]; started: boolean };
  const caches = new Map<string, MartCache>();
  const listeners = new Map<string, Set<() => void>>();
  let destinations: Promise<DestinationDto[]> | null = null;
  const flights = new Map<string, Flight>();
  const leftBehind = new Map<string, { target: SheetTarget; destinationId: string }>();
  const NONE: ReportEntry[] = [];

  const emit = (martId: string) => listeners.get(martId)?.forEach((l) => l());

  /** The stored document as the slim list; older documents carried more fields, so only the id and a string `usedAt` are kept. */
  const parseDoc = (found: { document: ExportsDoc } | null | undefined): StoredReport[] =>
    (Array.isArray(found?.document.reports) ? found!.document.reports.filter((r) => r && typeof r.reportId === 'string') : [])
      .map((r) => ({ reportId: r.reportId, ...(typeof r.usedAt === 'string' ? { usedAt: r.usedAt } : {}) }));
  const reading = new Map<string, Promise<StoredReport[] | null>>();
  /** The stored document, read once (concurrent first reads share one request); null when the read failed (not cached, so the next call tries again, and nothing is written meanwhile). */
  function readDoc(martId: string): Promise<StoredReport[] | null> {
    const known = docs.get(martId);
    if (known) return Promise.resolve(known);
    let p = reading.get(martId);
    if (!p) {
      p = (async () => {
        try {
          const list = parseDoc(await col.get(martId));
          if (!docs.has(martId)) docs.set(martId, list);
        } catch (e) {
          console.warn('Reading the exported reports failed', e);
          return null;
        }
        return docs.get(martId)!;
      })().finally(() => { reading.delete(martId); });
      reading.set(martId, p);
    }
    return p;
  }
  const stored = async (martId: string) => (await readDoc(martId)) ?? [];
  /** One write at a time per mart: each change is computed from the list the previous one left, and its put finishes before the next starts. */
  const chains = new Map<string, Promise<void>>();
  /** Changes the stored list and keeps the live entries in step. Does nothing while the stored document could not be read. */
  function mutate(martId: string, fn: (list: StoredReport[]) => StoredReport[]): Promise<void> {
    const run = (chains.get(martId) ?? Promise.resolve()).then(async () => {
      // Another tab may have written since: the list is read again here, and a write is refused when that read fails.
      let current: StoredReport[];
      try { current = parseDoc(await col.get(martId)); } catch (e) { console.warn('Reading the exported reports failed', e); return; }
      const next = fn(current);
      docs.set(martId, next);
      let emitError: unknown;
      const cache = caches.get(martId);
      if (cache?.started) {
        const fresh: string[] = [];
        cache.entries = next.flatMap((r) => {
          const e = cache.entries.find((x) => x.reportId === r.reportId);
          if (e) return [{ ...e, usedAt: r.usedAt, ...(e.report ? { report: { ...e.report, usedAt: r.usedAt } } : {}) }];
          // A report new to the cache (an export just made it) is read like the others, so it never sits without an entry.
          fresh.push(r.reportId);
          return [{ reportId: r.reportId, usedAt: r.usedAt, state: 'loading' as const }];
        });
        try { emit(martId); } catch (e) { emitError = e; }
        fresh.forEach((id) => { void read(martId, cache, id); });
      }
      try { await col.put(martId, { reports: next }); } catch (e) { console.warn('Saving the exported reports failed', e); }
      // A listener that threw is the caller's error, but only after the change was saved.
      if (emitError) throw emitError;
    });
    // A change that threw does not block the later ones; its caller still gets the error.
    chains.set(martId, run.catch(() => undefined));
    return run;
  }
  const touch = (martId: string, reportId: string, usedAt: string) => mutate(martId, (l) => (l.some((r) => r.reportId === reportId) ? l.map((r) => (r.reportId === reportId ? { reportId, usedAt } : r)) : [...l, { reportId, usedAt }]));
  const forget = (martId: string, reportId: string) => mutate(martId, (l) => l.filter((r) => r.reportId !== reportId));

  /** Replaces one entry of a cache that is still the current one; a read that outlived `invalidate()` changes nothing. */
  function patch(martId: string, cache: MartCache, reportId: string, fn: (e: ReportEntry) => ReportEntry) {
    if (caches.get(martId) !== cache) return;
    cache.entries = cache.entries.map((e) => (e.reportId === reportId ? fn(e) : e));
    emit(martId);
  }
  async function read(martId: string, cache: MartCache, reportId: string) {
    patch(martId, cache, reportId, (e) => ({ reportId: e.reportId, usedAt: e.usedAt, state: 'loading' }));
    try {
      const d = await ctx.owox.getJson<LiveReportDto>(`/api/reports/${encodeURIComponent(reportId)}`);
      const cfg = d.destinationConfig;
      const target = { spreadsheetId: cfg?.spreadsheetId, sheetId: cfg?.sheetId };
      patch(martId, cache, reportId, (e) => ({
        ...e, state: 'ready',
        report: {
          reportId, destinationId: d.dataDestinationAccess?.id ?? '',
          // A target that is not a plain id is kept as "unrecognised" (empty id), never stored as given.
          ...(isSheetTarget(target) ? { spreadsheetId: target.spreadsheetId, sheetId: target.sheetId } : { spreadsheetId: '', sheetId: 0 }),
          title: typeof d.title === 'string' && d.title ? d.title : 'Untitled report',
          ...(e.usedAt ? { usedAt: e.usedAt } : {}),
        },
      }));
    } catch (e) {
      if (isNotFound(e)) {
        if (caches.get(martId) !== cache) return;
        await forget(martId, reportId);
        // The forget is refused when the stored document cannot be read again; the report is gone in OWOX all the same, so it leaves the list
        // and the in-memory document (nothing is written), which keeps a listener from waiting for an entry that will never come.
        if (caches.get(martId) === cache && cache.entries.some((x) => x.reportId === reportId)) {
          const d = docs.get(martId);
          if (d) docs.set(martId, d.filter((r) => r.reportId !== reportId));
          cache.entries = cache.entries.filter((x) => x.reportId !== reportId);
          emit(martId);
        }
      }
      else patch(martId, cache, reportId, (x) => ({ reportId: x.reportId, usedAt: x.usedAt, state: 'failed' }));
    }
  }
  function load(martId: string) {
    if (caches.has(martId)) return;
    const cache: MartCache = { entries: [], started: false };
    caches.set(martId, cache);
    const start = (list: StoredReport[]) => {
      cache.started = true;
      cache.entries = list.map((r) => ({ reportId: r.reportId, usedAt: r.usedAt, state: 'loading' as const }));
      emit(martId);
      list.forEach((r) => { void read(martId, cache, r.reportId); });
    };
    // When the document is already known the entries are there at once, so a re-read never shows an empty list.
    const known = docs.get(martId);
    if (known) { start(known); return; }
    void readDoc(martId).then((list) => {
      if (caches.get(martId) !== cache) return;
      // A failed read leaves no cache behind, so the next load tries again.
      if (list) start(list); else caches.delete(martId);
    });
  }

  const destinationConfig = (t: SheetTarget) => ({ type: 'google-sheets-config', spreadsheetId: t.spreadsheetId, sheetId: t.sheetId });

  async function poll(reportId: string, before: string | null, signal?: AbortSignal): Promise<Outcome> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      await sleep(POLL_INTERVAL_MS, signal);
      if (signal?.aborted) return { state: 'timeout' };
      const r = await ctx.owox.getJson<ReportDto>(`/api/reports/${encodeURIComponent(reportId)}`);
      const fresh = !!r.lastRunAt && (!before || Date.parse(r.lastRunAt) > Date.parse(before));
      if (fresh && r.lastRunStatus === 'SUCCESS') return { state: 'success' };
      if (fresh && r.lastRunStatus && r.lastRunStatus !== 'RUNNING') return { state: 'failed', error: r.lastRunError || `The run ended as ${r.lastRunStatus}.` };
      if (Date.now() >= deadline) return { state: 'timeout' };
    }
  }

  return {
    destinations() {
      destinations ??= ctx.owox.destinations.list().then((l) => l.filter(isSheetsDestination)).catch((e) => { destinations = null; throw e; });
      return destinations;
    },
    invalidate() { destinations = null; const marts = [...caches.keys()]; caches.clear(); marts.forEach(emit); },
    stored: async (martId) => [...(await stored(martId))],
    storedNow: (martId) => { const known = docs.get(martId); return known && [...known]; },
    load,
    entries: (martId) => caches.get(martId)?.entries ?? NONE,
    subscribe(martId, cb) {
      const set = listeners.get(martId) ?? new Set();
      listeners.set(martId, set.add(cb));
      return () => { set.delete(cb); };
    },
    retry(martId, reportId) {
      const cache = caches.get(martId);
      if (cache?.entries.some((e) => e.reportId === reportId && e.state === 'failed')) void read(martId, cache, reportId);
    },
    forget,

    inFlight: (martId) => flights.get(martId),
    made: (martId, destinationId) => { const kept = leftBehind.get(martId); return kept?.destinationId === destinationId ? kept.target : undefined; },
    acknowledge(martId) { if (flights.get(martId)?.settled) flights.delete(martId); },

    run(a) {
      if (flights.has(a.martId)) return Promise.reject(new Error('An export for this data mart is already in progress.'));
      const stageListeners = new Set<(s: Stage) => void>();
      const flight: Flight = {
        stage: a.source.kind === 'new' ? 'sheet' : 'report', sourceKind: a.source.kind, notes: a.notes ?? [], settled: false,
        promise: undefined as unknown as Promise<RunResult>,
        subscribe(cb) { stageListeners.add(cb); return () => stageListeners.delete(cb); },
      };
      const onStage = (s: Stage) => { flight.stage = s; a.onStage?.(s); stageListeners.forEach((l) => l(s)); };
      flight.promise = execute({ ...a, onStage }).finally(() => {
        flight.settled = true;
        // The report may have changed in OWOX (or be gone): read the mart's reports again.
        caches.delete(a.martId);
        load(a.martId);
        emit(a.martId);
      });
      // The entry is read, not awaited, by a remounted menu: a rejection nobody follows must not go unhandled.
      flight.promise.catch(() => undefined);
      flights.set(a.martId, flight);
      return flight.promise;
    },
  };

  async function execute({ martId, destination, title, source, payload, onStage, signal }: Parameters<Exporter['run']>[0]): Promise<RunResult> {
      let report: ExportedReport;
      if (source.kind === 'update') {
        onStage?.('report');
        const r = source.report;
        try {
          await ctx.owox.putJson(`/api/reports/${encodeURIComponent(r.reportId)}`, {
            title: r.title, dataDestinationId: r.destinationId, destinationConfig: destinationConfig(r),
            // PUT replaces the report: what an earlier edit in OWOX left behind must not change the sheet, so these reset
            // unless the payload carries them (a grouped grid's aggregation and date rules).
            limitConfig: null, aggregationConfig: null, dateTruncConfig: null, uniqueCountConfig: null,
            ...payload,
          });
        } catch (e) {
          if (isNotFound(e)) { await forget(martId, r.reportId); throw new ExportError('report', REPORT_GONE, undefined, undefined, true); }
          throw new ExportError('report', messageOf(e));
        }
        const usedAt = new Date().toISOString();
        await touch(martId, r.reportId, usedAt);
        report = { ...r, usedAt };
      } else {
        let target: SheetTarget;
        if (source.kind === 'existing') {
          target = source.target;
          const kept = leftBehind.get(martId);
          if (kept && (kept.target.spreadsheetId !== target.spreadsheetId || kept.target.sheetId !== target.sheetId)) leftBehind.delete(martId);
        } else {
          onStage?.('sheet');
          try {
            const d = await ctx.owox.postJson<DocumentDto>(`/api/data-destinations/${encodeURIComponent(destination.id)}/google-sheets/documents`, { title });
            if (!isSheetTarget(d)) throw new Error('OWOX returned an unrecognised spreadsheet');
            target = { spreadsheetId: d.spreadsheetId, sheetId: d.sheetId };
          } catch (e) { throw new ExportError('sheet', messageOf(e)); }
        }
        onStage?.('report');
        try {
          const created = await ctx.owox.postJson<ReportDto>('/api/reports', { title, dataMartId: martId, dataDestinationId: destination.id, destinationConfig: destinationConfig(target), ...payload });
          report = { reportId: created.id, destinationId: destination.id, spreadsheetId: target.spreadsheetId, sheetId: target.sheetId, title, usedAt: new Date().toISOString() };
        } catch (e) {
          const err = new ExportError('report', messageOf(e), codeOf(e), target);
          if (reportMayExist(err)) leftBehind.delete(martId); else leftBehind.set(martId, { target, destinationId: destination.id });
          throw err;
        }
        leftBehind.delete(martId);
        // Remembered before the run: a failed run leaves a report the member can update.
        await touch(martId, report.reportId, report.usedAt!);
      }
      onStage?.('run');
      try {
        const pre = await ctx.owox.getJson<ReportDto>(`/api/reports/${encodeURIComponent(report.reportId)}`);
        // The backend skips a run request while one is running, so the new settings would never run.
        if (pre.lastRunStatus === 'RUNNING') return { report, outcome: { state: 'busy' } };
        const before = pre.lastRunAt ?? null;
        await ctx.owox.postJson(`/api/reports/${encodeURIComponent(report.reportId)}/run`, {});
        return { report, outcome: await poll(report.reportId, before, signal) };
      } catch (e) { throw new ExportError('run', messageOf(e)); }
  }
}
