import { vi } from 'vitest';
import type { ColumnFilter } from '../filters/build';
import type { Field, Schema } from '../model/types';
import type { SortKey } from '../model/sort';
import { createExporter, buildReportPayload, exportTitle, ExportError, isPublishedSheetUrl, parseSheetUrl, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, sheetUrl, type ExportedReport, type ReportPayload } from './exports';
import { stubCtx } from './test-ctx';

const f = (name: string, type: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
const schema: Schema = [f('id', 'INT64', 'number', { isPrimaryKey: true }), f('status', 'STRING', 'string'), f('amount', 'NUMERIC', 'number'), f('created_at', 'TIMESTAMP', 'date')];

describe('buildReportPayload', () => {
  test('shown columns in the grid\'s order, with the opt-out set to the same columns', () => {
    const { payload } = buildReportPayload(schema, ['amount', 'id'], [], []);
    expect(payload.columnConfig).toEqual(['amount', 'id']);
    expect(payload.autoAggregationOptOut).toEqual(['amount', 'id']);
    expect(payload.filterConfig).toBeNull();
    expect(payload.sortConfig).toBeNull();
  });

  test('complete filters map as the grid query maps them; incomplete ones are left out', () => {
    const filters: ColumnFilter[] = [
      { field: 'amount', op: 'between', value: { from: '1', to: '5' } },
      { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } },
      { field: 'status', op: 'contains', value: '' },
      { field: 'status', op: 'is_blank' },
    ];
    expect(buildReportPayload(schema, ['id'], filters, []).payload.filterConfig).toEqual([
      { column: 'amount', operator: 'between', value: { from: 1, to: 5 } },
      { column: 'created_at', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } },
      { column: 'status', operator: 'is_blank' },
    ]);
  });

  test('joined columns are exported like any shown column: columnConfig, filterConfig, sortConfig and the opt-out, by blended name', () => {
    const joined = f('customers__email', 'STRING', 'string', { alias: 'email', joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers' } });
    const withJoined: Schema = [...schema, joined, f('products__price', 'NUMERIC', 'number', { joined: { martId: 'products', label: 'Products', aliasPath: 'products' } })];
    const r = buildReportPayload(withJoined, ['id', 'customers__email', 'products__price'], [{ field: 'customers__email', op: 'contains', value: 'example' }, { field: 'products__price', op: 'gt', value: '10' }], [{ field: 'customers__email', direction: 'asc' }]);
    expect(r.payload).toEqual({
      columnConfig: ['id', 'customers__email', 'products__price'],
      filterConfig: [{ column: 'customers__email', operator: 'contains', value: 'example' }, { column: 'products__price', operator: 'gt', value: 10 }],
      sortConfig: [{ column: 'customers__email', direction: 'asc' }],
      autoAggregationOptOut: ['id', 'customers__email', 'products__price'],
    });
  });

  test('sorts are the reader\'s own, without primary key tie-breakers, capped at 10 with a note', () => {
    const sorts: SortKey[] = [{ field: 'amount', direction: 'desc' }, { field: 'status', direction: 'asc' }];
    const r = buildReportPayload(schema, ['id', 'amount', 'status'], [], sorts);
    expect(r.payload.sortConfig).toEqual([{ column: 'amount', direction: 'desc' }, { column: 'status', direction: 'asc' }]);
    expect(r.notes).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i): SortKey => ({ field: `c${i}`, direction: 'asc' }));
    const capped = buildReportPayload(schema, ['id'], [], many);
    expect(capped.payload.sortConfig).toHaveLength(10);
    expect(capped.payload.sortConfig![9]!.column).toBe('c9');
    expect(capped.notes).toEqual(['Only the first 10 sorts were exported.']);
  });
});

test('exportTitle names the mart, the plugin and the minute', () => {
  expect(exportTitle('Orders', new Date(2026, 10, 5, 9, 7))).toBe('Orders · Data Explorer · 2026-11-05 09:07');
});

test.each([
  ['https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=456', { spreadsheetId: 'abc_DEF-123', sheetId: 456 }],
  ['https://docs.google.com/spreadsheets/d/abc123/edit', { spreadsheetId: 'abc123', sheetId: 0 }],
  ['https://docs.google.com/spreadsheets/d/abc123/edit?gid=9', { spreadsheetId: 'abc123', sheetId: 9 }],
  ['  https://docs.google.com/spreadsheets/u/1/d/abc123/edit#gid=0  ', { spreadsheetId: 'abc123', sheetId: 0 }],
])('parseSheetUrl %s', (url, expected) => { expect(parseSheetUrl(url)).toEqual(expected); });

test.each(['', 'abc', 'https://example.com/spreadsheets/d/abc/edit', 'http://docs.google.com/spreadsheets/d/abc/edit', 'https://docs.google.com/document/d/abc/edit'])('parseSheetUrl rejects %j', (url) => {
  expect(parseSheetUrl(url)).toBeNull();
});

test('isPublishedSheetUrl spots /d/e/ links', () => { expect(isPublishedSheetUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml')).toBe(true); expect(isPublishedSheetUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(false); });

test('sheetUrl opens the tab', () => { expect(sheetUrl({ spreadsheetId: 'x', sheetId: 3 })).toBe('https://docs.google.com/spreadsheets/d/x/edit#gid=3'); });

test.each([
  ['../../url?q=https://evil.example', 0], ['a?b', 0], ['a#b', 0], ['a/b', 0], ['', 0], ['ok', -1], ['ok', NaN], ['ok', 1.5], ['ok', Infinity],
])('sheetUrl refuses %j / %s', (spreadsheetId, sheetId) => { expect(sheetUrl({ spreadsheetId, sheetId })).toBeNull(); });

const dest = { id: 'd1', title: 'Team Sheets', type: 'GOOGLE_SHEETS' };
const payload: ReportPayload = { columnConfig: ['id'], filterConfig: null, sortConfig: null, autoAggregationOptOut: ['id'] };

/** A ctx whose reports run for `runs` polls before they finish with `final`. */
function exportCtx(final: { status: string; error?: string } = { status: 'SUCCESS' }, runs = 1, stored: ExportedReport[] = []) {
  const calls: string[] = [];
  let polls = -1;
  let lastRunAt: string | null = '2026-01-01T00:00:00.000Z';
  const done = { n: 0 };
  const ctx = stubCtx({
    destinations: { list: vi.fn(async () => [dest, { id: 'd2', title: 'Looker', type: 'LOOKER_STUDIO' }, { id: 'd3', title: 'Off', type: 'GOOGLE_SHEETS', availableForUse: false }]) },
    postJson: vi.fn(async (path: string) => {
      calls.push(`POST ${path}`);
      if (path.endsWith('/google-sheets/documents')) return { spreadsheetId: 'sheet1', sheetId: 7 };
      if (path === '/api/reports') return { id: 'r1' };
      if (path.endsWith('/run')) { polls = 0; done.n += 1; }
      return undefined;
    }),
    putJson: vi.fn(async (path: string) => { calls.push(`PUT ${path}`); return {}; }),
    getJson: vi.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      if (polls >= 0) { polls += 1; if (polls >= runs) { lastRunAt = '2026-02-01T00:00:00.000Z'; return { id: 'r1', lastRunAt, lastRunStatus: final.status, lastRunError: final.error }; } return { id: 'r1', lastRunAt, lastRunStatus: 'RUNNING' }; }
      return { id: 'r1', lastRunAt, lastRunStatus: 'SUCCESS' };
    }),
  });
  if (stored.length) void ctx.collections('exports').put('orders', { reports: stored });
  return { ctx, calls };
}

describe('exporter', () => {
  test('lists only usable Google Sheets destinations, once until invalidated', async () => {
    const { ctx } = exportCtx();
    const ex = createExporter(ctx);
    expect((await ex.destinations()).map((d) => d.id)).toEqual(['d1']);
    await ex.destinations();
    expect(ctx.owox.destinations.list).toHaveBeenCalledTimes(1);
    ex.invalidate();
    await ex.destinations();
    expect(ctx.owox.destinations.list).toHaveBeenCalledTimes(2);
  });

  test('a new export creates the spreadsheet, then the report, then runs it, and remembers the report', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = exportCtx();
      const ex = createExporter(ctx);
      const stages: string[] = [];
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload, onStage: (s) => stages.push(s) });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      const { report, outcome } = await p;
      expect(outcome).toEqual({ state: 'success' });
      expect(stages).toEqual(['sheet', 'report', 'run']);
      expect(calls.filter((c) => !c.startsWith('GET /api/reports/r1'))).toEqual(['POST /api/data-destinations/d1/google-sheets/documents', 'POST /api/reports', 'POST /api/reports/r1/run']);
      expect(ctx.owox.postJson).toHaveBeenCalledWith('/api/reports', { title: 'T', dataMartId: 'orders', dataDestinationId: 'd1', destinationConfig: { type: 'google-sheets-config', spreadsheetId: 'sheet1', sheetId: 7 }, ...payload });
      expect(report).toEqual({ reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'T' });
      expect(await ex.reports('orders')).toEqual([report]);
      expect((await ctx.collections<{ reports: ExportedReport[] }>('exports').get('orders'))?.document.reports).toEqual([report]);
      expect(ctx.owox.dataMarts.traverseData).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  test('an existing spreadsheet creates no document', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = exportCtx();
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'existing', target: { spreadsheetId: 'mine', sheetId: 2 } }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      expect((await p).report).toMatchObject({ spreadsheetId: 'mine', sheetId: 2 });
      expect(calls.some((c) => c.includes('google-sheets/documents'))).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  test('an update PUTs the remembered report with the current state and runs it', async () => {
    vi.useFakeTimers();
    try {
      const remembered: ExportedReport = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [remembered]);
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      expect(calls.filter((c) => !c.startsWith('GET'))).toEqual(['PUT /api/reports/r1', 'POST /api/reports/r1/run']);
      expect(ctx.owox.putJson).toHaveBeenCalledWith('/api/reports/r1', expect.objectContaining({ title: 'Old', dataDestinationId: 'd1', destinationConfig: { type: 'google-sheets-config', spreadsheetId: 'sheet1', sheetId: 7 }, columnConfig: ['id'], autoAggregationOptOut: ['id'], limitConfig: null }));
      expect(ctx.owox.postJson).not.toHaveBeenCalledWith('/api/reports', expect.anything());
    } finally { vi.useRealTimers(); }
  });

  test('a failed spreadsheet creation is an ExportError at the sheet step and leaves no report behind', async () => {
    const { ctx } = exportCtx();
    (ctx.owox.postJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('No Drive folder is configured'));
    const ex = createExporter(ctx);
    const err = await ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload }).catch((e) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect(err).toMatchObject({ stage: 'sheet', message: 'No Drive folder is configured' });
    expect(await ex.reports('orders')).toEqual([]);
  });

  test('polling: an ERROR run reports its message', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = exportCtx({ status: 'ERROR', error: 'Sheet is protected' }, 2);
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      expect((await p).outcome).toEqual({ state: 'failed', error: 'Sheet is protected' });
    } finally { vi.useRealTimers(); }
  });

  test('polling: a run that never finishes times out after 3 minutes', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = exportCtx({ status: 'SUCCESS' }, 10_000);
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS * 2);
      expect((await p).outcome).toEqual({ state: 'timeout' });
    } finally { vi.useRealTimers(); }
  });

  test('a remembered report OWOX no longer has is dropped and the cleaned list is saved; other errors keep it', async () => {
    const keep: ExportedReport = { reportId: 'keep', destinationId: 'd1', spreadsheetId: 'a', sheetId: 0, title: 'Keep' };
    const gone: ExportedReport = { reportId: 'gone', destinationId: 'd1', spreadsheetId: 'b', sheetId: 0, title: 'Gone' };
    const flaky: ExportedReport = { reportId: 'flaky', destinationId: 'd1', spreadsheetId: 'c', sheetId: 0, title: 'Flaky' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [keep, gone, flaky]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === '/api/reports/gone') throw Object.assign(new Error('Report not found'), { payload: { code: 'HTTP_ERROR', status: 404 } });
      if (path === '/api/reports/flaky') throw Object.assign(new Error('Bad gateway'), { payload: { code: 'HTTP_ERROR', status: 502 } });
      return { id: 'keep' };
    });
    const ex = createExporter(ctx);
    expect(await ex.reports('orders', true)).toEqual([keep, flaky]);
    expect((await ctx.collections<{ reports: ExportedReport[] }>('exports').get('orders'))?.document.reports).toEqual([keep, flaky]);
  });

  test('verifying marks a live target that is not a plain id as unrecognised instead of storing it', async () => {
    const stale: ExportedReport = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'old', sheetId: 0, title: 'Old' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [stale]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', destinationConfig: { spreadsheetId: '../../url?q=https://evil.example', sheetId: 0 } });
    const [r] = await createExporter(ctx).reports('orders', true);
    expect(r).toMatchObject({ reportId: 'r1', spreadsheetId: '', sheetId: 0 });
    expect(sheetUrl(r!)).toBeNull();
  });

  test('a report that is already running is not run again', async () => {
    const remembered: ExportedReport = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
    const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [remembered]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'RUNNING' });
    const { outcome } = await createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload });
    expect(outcome.state).toBe('busy');
    expect(calls.some((c) => c.endsWith('/run'))).toBe(false);
    expect(ctx.owox.putJson).toHaveBeenCalled();
  });

  test('verifying takes the live title, destination and sheet over the remembered copy', async () => {
    const stale: ExportedReport = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'old', sheetId: 0, title: 'Old' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [stale]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', title: 'Renamed', dataDestinationAccess: { id: 'd2' }, destinationConfig: { spreadsheetId: 'new', sheetId: 4 } });
    const ex = createExporter(ctx);
    const live = { reportId: 'r1', destinationId: 'd2', spreadsheetId: 'new', sheetId: 4, title: 'Renamed' };
    expect(await ex.reports('orders', true)).toEqual([live]);
    expect((await ctx.collections<{ reports: ExportedReport[] }>('exports').get('orders'))?.document.reports).toEqual([live]);
  });

  test('a failure while following the run is an ExportError at the run step, after the report was remembered', async () => {
    const { ctx } = exportCtx();
    (ctx.owox.postJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.endsWith('/google-sheets/documents')) return { spreadsheetId: 's', sheetId: 0 };
      if (path === '/api/reports') return { id: 'r1' };
      throw new Error('run refused');
    });
    const ex = createExporter(ctx);
    const err = await ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload }).catch((e) => e);
    expect(err).toMatchObject({ stage: 'run', message: 'run refused' });
    expect(await ex.reports('orders')).toHaveLength(1);
  });

  test('one export at a time per mart: a second run is refused while the first is in flight, and the flight can be followed', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = exportCtx();
      const ex = createExporter(ctx);
      const first = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload, notes: ['n'] });
      const flight = ex.inFlight('orders')!;
      expect(flight).toMatchObject({ stage: 'sheet', sourceKind: 'new', notes: ['n'], settled: false });
      const seen: string[] = [];
      flight.subscribe((s) => seen.push(s));
      await expect(ex.run({ martId: 'orders', destination: dest, title: 'T2', source: { kind: 'new' }, payload })).rejects.toThrow(/already in progress/);
      expect(ex.inFlight('other')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      expect((await flight.promise).outcome).toEqual({ state: 'success' });
      await first;
      expect(seen).toEqual(['report', 'run']);
      expect(calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
      // Settled and not taken yet: still listed, so a menu that mounts later can show it; acknowledged, it is gone.
      expect(ex.inFlight('orders')).toMatchObject({ settled: true });
      ex.acknowledge('orders');
      expect(ex.inFlight('orders')).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  test('acknowledge leaves a running export listed', async () => {
    const { ctx } = exportCtx();
    const ex = createExporter(ctx);
    void ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload, signal: AbortSignal.abort() }).catch(() => undefined);
    ex.acknowledge('orders');
    expect(ex.inFlight('orders')).toBeDefined();
  });

  test('a failed report step carries the transport code and the spreadsheet it leaves behind', async () => {
    const { ctx } = exportCtx();
    (ctx.owox.postJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.endsWith('/google-sheets/documents')) return { spreadsheetId: 'made', sheetId: 3 };
      throw Object.assign(new Error('Request timed out'), { payload: { code: 'TIMEOUT' } });
    });
    const err = await createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload }).catch((e) => e);
    expect(err).toMatchObject({ stage: 'report', code: 'TIMEOUT', target: { spreadsheetId: 'made', sheetId: 3 } });
  });
});

test('the report lists the columns in the grid\'s order: the main mart\'s, then each joined mart\'s in the order added', () => {
  const wide: Schema = [...schema, f('customers__city', 'STRING', 'string'), f('products__sku', 'STRING', 'string')];
  const { payload } = buildReportPayload(wide, ['id', 'status', 'products__sku', 'customers__city', 'gone'], [], []);
  expect(payload.columnConfig).toEqual(['id', 'status', 'products__sku', 'customers__city']);
  expect(payload.autoAggregationOptOut).toEqual(['id', 'status', 'products__sku', 'customers__city']);
});
