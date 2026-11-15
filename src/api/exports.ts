import { toTraverseFilters, type ColumnFilter } from '../filters/build';
import type { SortKey } from '../model/sort';
import type { Schema } from '../model/types';
import type { Ctx, DestinationDto, TraverseFilter } from '../sdk/types';

export const EXPORTS_COLLECTION = 'exports';
export const MAX_EXPORT_SORTS = 10;
export const MAX_EXPORT_FILTERS = 50;
export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 3 * 60_000;

/** A report this member created through the plugin, remembered per data mart. */
export type ExportedReport = { reportId: string; destinationId: string; spreadsheetId: string; sheetId: number; title: string };
type ExportsDoc = { reports: ExportedReport[] };

/** The grid state as an OWOX report carries it. */
export type ReportPayload = {
  columnConfig: string[];
  filterConfig: TraverseFilter[] | null;
  sortConfig: { column: string; direction: 'asc' | 'desc' }[] | null;
  /** The exported columns: without it the run collapses rows into DISTINCT/aggregates and the sheet differs from the grid. */
  autoAggregationOptOut: string[];
};

export type PayloadResult = { payload: ReportPayload; notes: string[] };

/** The report that reproduces what the grid shows: shown columns, complete filters, the reader's own sorts. */
export function buildReportPayload(schema: Schema, visible: string[], filters: ColumnFilter[], sorts: SortKey[]): PayloadResult {
  const notes: string[] = [];
  const columnConfig = schema.map((f) => f.name).filter((n) => visible.includes(n));
  let filter = toTraverseFilters(schema, filters);
  if (filter.length > MAX_EXPORT_FILTERS) { notes.push(`Only the first ${MAX_EXPORT_FILTERS} filters were exported.`); filter = filter.slice(0, MAX_EXPORT_FILTERS); }
  let sort = sorts.map((s) => ({ column: s.field, direction: s.direction }));
  if (sort.length > MAX_EXPORT_SORTS) { notes.push(`Only the first ${MAX_EXPORT_SORTS} sorts were exported.`); sort = sort.slice(0, MAX_EXPORT_SORTS); }
  return {
    payload: { columnConfig, filterConfig: filter.length ? filter : null, sortConfig: sort.length ? sort : null, autoAggregationOptOut: [...columnConfig] },
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

export const sheetUrl = (t: SheetTarget) => `https://docs.google.com/spreadsheets/d/${t.spreadsheetId}/edit#gid=${t.sheetId}`;

export const isSheetsDestination = (d: DestinationDto) => d.type === 'GOOGLE_SHEETS' && d.availableForUse !== false;

type LiveReportDto = { title?: string; dataDestinationAccess?: { id?: string }; destinationConfig?: { spreadsheetId?: unknown; sheetId?: unknown } };
type ReportDto = { id: string; lastRunAt?: string | null; lastRunStatus?: string | null; lastRunError?: string | null };
type DocumentDto = { spreadsheetId: string; sheetId: number };

export type Stage = 'sheet' | 'report' | 'run';
/** A failure at a named step, so the caller can tell a spreadsheet that could not be created from a run that failed. */
export class ExportError extends Error {
  constructor(public stage: Stage, message: string) { super(message); }
}
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The SDK transport puts the HTTP status on `payload`; a plain `status` is kept as a fallback. */
const isNotFound = (e: unknown) => { const x = e as { payload?: { status?: number }; status?: number } | null; return (x?.payload?.status ?? x?.status) === 404; };

export type Outcome = { state: 'success' | 'failed' | 'timeout' | 'busy'; error?: string };
export type ExportSource =
  | { kind: 'new' }
  | { kind: 'existing'; target: SheetTarget }
  | { kind: 'update'; report: ExportedReport };

export interface Exporter {
  /** The member's usable Google Sheets destinations; read once per session until `invalidate()`. */
  destinations(): Promise<DestinationDto[]>;
  invalidate(): void;
  /** The remembered reports for a mart, with the ones OWOX no longer has dropped (the cleaned list is saved). */
  reports(martId: string, verify?: boolean): Promise<ExportedReport[]>;
  run(a: {
    martId: string; destination: DestinationDto; title: string; source: ExportSource; payload: ReportPayload;
    onStage?: (s: Stage) => void; signal?: AbortSignal;
  }): Promise<{ report: ExportedReport; outcome: Outcome }>;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createExporter(ctx: Ctx): Exporter {
  const col = ctx.collections<ExportsDoc>(EXPORTS_COLLECTION);
  const cache = new Map<string, ExportedReport[]>();
  let destinations: Promise<DestinationDto[]> | null = null;

  async function load(martId: string): Promise<ExportedReport[]> {
    const hit = cache.get(martId);
    if (hit) return hit;
    try {
      const found = await col.get(martId);
      const list = Array.isArray(found?.document.reports) ? found.document.reports.filter((r) => r && typeof r.reportId === 'string') : [];
      if (!cache.has(martId)) cache.set(martId, list);
    } catch (e) {
      console.warn('Reading the exported reports failed', e);
      if (!cache.has(martId)) cache.set(martId, []);
    }
    return cache.get(martId)!;
  }
  async function save(martId: string, reports: ExportedReport[]) {
    cache.set(martId, reports);
    try { await col.put(martId, { reports }); } catch (e) { console.warn('Saving the exported reports failed', e); }
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
    invalidate() { destinations = null; },

    async reports(martId, verify = false) {
      const list = await load(martId);
      if (!verify || list.length === 0) return list;
      // Each is read live: gone ones drop, and a title, destination or sheet edited in OWOX replaces the remembered copy.
      const live = await Promise.all(list.map(async (r): Promise<ExportedReport | null> => {
        try {
          const d = await ctx.owox.getJson<LiveReportDto>(`/api/reports/${encodeURIComponent(r.reportId)}`);
          const cfg = d.destinationConfig;
          return {
            reportId: r.reportId,
            destinationId: d.dataDestinationAccess?.id ?? r.destinationId,
            spreadsheetId: typeof cfg?.spreadsheetId === 'string' ? cfg.spreadsheetId : r.spreadsheetId,
            sheetId: typeof cfg?.sheetId === 'number' ? cfg.sheetId : r.sheetId,
            title: typeof d.title === 'string' && d.title ? d.title : r.title,
          };
        } catch (e) { return isNotFound(e) ? null : r; }
      }));
      const kept = live.filter((r): r is ExportedReport => r !== null);
      if (JSON.stringify(kept) !== JSON.stringify(list)) await save(martId, kept);
      return kept;
    },

    async run({ martId, destination, title, source, payload, onStage, signal }) {
      let report: ExportedReport;
      if (source.kind === 'update') {
        onStage?.('report');
        const r = source.report;
        try {
          await ctx.owox.putJson(`/api/reports/${encodeURIComponent(r.reportId)}`, {
            title: r.title, dataDestinationId: r.destinationId, destinationConfig: destinationConfig(r), ...payload,
            // PUT replaces the report: what an earlier edit in OWOX left behind must not change the sheet.
            limitConfig: null, aggregationConfig: null, dateTruncConfig: null, uniqueCountConfig: null,
          });
        } catch (e) { throw new ExportError('report', messageOf(e)); }
        report = r;
      } else {
        let target: SheetTarget;
        if (source.kind === 'existing') target = source.target;
        else {
          onStage?.('sheet');
          try {
            const d = await ctx.owox.postJson<DocumentDto>(`/api/data-destinations/${encodeURIComponent(destination.id)}/google-sheets/documents`, { title });
            target = { spreadsheetId: d.spreadsheetId, sheetId: d.sheetId };
          } catch (e) { throw new ExportError('sheet', messageOf(e)); }
        }
        onStage?.('report');
        try {
          const created = await ctx.owox.postJson<ReportDto>('/api/reports', { title, dataMartId: martId, dataDestinationId: destination.id, destinationConfig: destinationConfig(target), ...payload });
          report = { reportId: created.id, destinationId: destination.id, spreadsheetId: target.spreadsheetId, sheetId: target.sheetId, title };
        } catch (e) { throw new ExportError('report', messageOf(e)); }
        // Remembered before the run: a failed run leaves a report the member can update.
        await save(martId, [...(await load(martId)), report]);
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
    },
  };
}
