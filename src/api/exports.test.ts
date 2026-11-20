import { vi } from 'vitest';
import type { ColumnFilter } from '../filters/build';
import type { Field, Schema } from '../model/types';
import type { SortKey } from '../model/sort';
import { createExporter, buildReportPayload, exportTitle, ExportError, isPublishedSheetUrl, parseSheetUrl, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, sheetUrl, isGone, type ReportPayload, type StoredReport } from './exports';
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

const stored = (ctx: ReturnType<typeof stubCtx>, martId = 'orders') => ctx.collections<{ reports: StoredReport[] }>('exports').get(martId).then((d) => d?.document.reports);
const NOW = '2026-03-01T10:00:00.000Z';
const live = (id: string, over: object = {}) => ({ id, title: `T-${id}`, dataDestinationAccess: { id: 'd1' }, destinationConfig: { spreadsheetId: `s-${id}`, sheetId: 1 }, ...over });
const notFound = () => Object.assign(new Error('Report not found'), { payload: { code: 'HTTP_ERROR', status: 404 } });

const dest = { id: 'd1', title: 'Team Sheets', type: 'GOOGLE_SHEETS' };
const payload: ReportPayload = { columnConfig: ['id'], filterConfig: null, sortConfig: null, autoAggregationOptOut: ['id'] };

/** A ctx whose reports run for `runs` polls before they finish with `final`. */
function exportCtx(final: { status: string; error?: string } = { status: 'SUCCESS' }, runs = 1, stored: StoredReport[] = []) {
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
      expect(report).toEqual({ reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'T', usedAt: expect.any(String) });
      // Only the id and usedAt are stored.
      expect(await stored(ctx)).toEqual([{ reportId: 'r1', usedAt: report.usedAt }]);
      expect(await ex.stored('orders')).toEqual([{ reportId: 'r1', usedAt: report.usedAt }]);
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
      const remembered = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }]);
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      const { report } = await p;
      expect(report.usedAt).toEqual(expect.any(String));
      expect((await stored(ctx))).toEqual([{ reportId: 'r1', usedAt: report.usedAt }]);
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
    expect(await ex.stored('orders')).toEqual([]);
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

  test('reading tolerates old documents: only the id and a string usedAt are kept, and the next save writes the slim shape', async () => {
    const { ctx } = exportCtx();
    await ctx.collections('exports').put('orders', { reports: [{ reportId: 'a', destinationId: 'd1', spreadsheetId: 's', sheetId: 0, title: 'A', usedAt: NOW }, { reportId: 'b', title: 'B', usedAt: 5 }, null, { nope: 1 }] });
    const ex = createExporter(ctx);
    expect(await ex.stored('orders')).toEqual([{ reportId: 'a', usedAt: NOW }, { reportId: 'b' }]);
    await ex.forget('orders', 'b');
    expect(await stored(ctx)).toEqual([{ reportId: 'a', usedAt: NOW }]);
  });

  test('load reads every remembered report live, in parallel, once; entries go loading then ready with the live data and stored usedAt', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a', usedAt: NOW }, { reportId: 'b' }]);
    const resolvers: Record<string, (v: unknown) => void> = {};
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation((path: string) => new Promise((res) => { resolvers[path.split('/').pop()!] = res; }));
    const ex = createExporter(ctx);
    const seen = vi.fn();
    ex.subscribe('orders', seen);
    expect(ex.entries('orders')).toEqual([]);
    ex.load('orders');
    ex.load('orders');
    await vi.waitFor(() => expect(Object.keys(resolvers)).toEqual(['a', 'b']));
    expect(ctx.owox.getJson).toHaveBeenCalledTimes(2);
    expect(ex.entries('orders')).toEqual([{ reportId: 'a', usedAt: NOW, state: 'loading' }, { reportId: 'b', state: 'loading' }]);
    resolvers.b!(live('b', { dataDestinationAccess: { id: 'd2' } }));
    await vi.waitFor(() => expect(ex.entries('orders')[1]!.state).toBe('ready'));
    expect(ex.entries('orders')[0]!.state).toBe('loading');
    expect(ex.entries('orders')[1]!.report).toEqual({ reportId: 'b', destinationId: 'd2', spreadsheetId: 's-b', sheetId: 1, title: 'T-b' });
    resolvers.a!(live('a'));
    await vi.waitFor(() => expect(ex.entries('orders')[0]!.state).toBe('ready'));
    expect(ex.entries('orders')[0]!.report).toEqual({ reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a', usedAt: NOW });
    expect(seen).toHaveBeenCalled();
    // A later load reads nothing.
    ex.load('orders');
    expect(ctx.owox.getJson).toHaveBeenCalledTimes(2);
  });

  test('a 404 read drops the report from the entries and the stored document; another error is failed, and retry re-reads only that report', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'keep' }, { reportId: 'gone' }, { reportId: 'flaky' }]);
    let flaky = true;
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === '/api/reports/gone') throw notFound();
      if (path === '/api/reports/flaky' && flaky) throw Object.assign(new Error('Bad gateway'), { payload: { code: 'HTTP_ERROR', status: 502 } });
      return live(path.split('/').pop()!);
    });
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders').map((e) => `${e.reportId}:${e.state}`)).toEqual(['keep:ready', 'flaky:failed']));
    expect(await stored(ctx)).toEqual([{ reportId: 'keep' }, { reportId: 'flaky' }]);
    flaky = false;
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockClear();
    ex.retry('orders', 'flaky');
    await vi.waitFor(() => expect(ex.entries('orders')[1]!.state).toBe('ready'));
    expect(ctx.owox.getJson).toHaveBeenCalledTimes(1);
    ex.retry('orders', 'keep');
    expect(ctx.owox.getJson).toHaveBeenCalledTimes(1);
  });

  test('a live target that is not a plain id is listed as unrecognised instead of being passed on', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockResolvedValue(live('r1', { destinationConfig: { spreadsheetId: '../../url?q=https://evil.example', sheetId: 0 } }));
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders')[0]!.state).toBe('ready'));
    const r = ex.entries('orders')[0]!.report!;
    expect(r).toMatchObject({ spreadsheetId: '', sheetId: 0 });
    expect(sheetUrl(r)).toBeNull();
  });

  test('forget removes the report from the cache and the document; subscribers are told', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => live(path.split('/').pop()!));
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders').length === 2 && ex.entries('orders').every((e) => e.state === 'ready')).toBe(true));
    const cb = vi.fn();
    ex.subscribe('orders', cb);
    await ex.forget('orders', 'a');
    expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['b']);
    expect(await stored(ctx)).toEqual([{ reportId: 'b' }]);
    expect(cb).toHaveBeenCalled();
  });

  test('invalidate drops every mart\'s live cache and tells subscribers; load reads again', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => live(path.split('/').pop()!));
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders')[0]?.state).toBe('ready'));
    const cb = vi.fn();
    ex.subscribe('orders', cb);
    ex.invalidate();
    expect(cb).toHaveBeenCalled();
    expect(ex.entries('orders')).toEqual([]);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders')[0]?.state).toBe('ready'));
    expect(ctx.owox.getJson).toHaveBeenCalledTimes(2);
  });

  test('after an export settles, the mart\'s reports are read again', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = exportCtx();
      const ex = createExporter(ctx);
      ex.load('orders');
      await vi.advanceTimersByTimeAsync(0);
      expect(ex.entries('orders')).toEqual([]);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      await vi.advanceTimersByTimeAsync(0);
      expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['r1']);
    } finally { vi.useRealTimers(); }
  });

  test('a report an export just made gets an entry (and a read) at once, while the export is still running', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = exportCtx();
      const ex = createExporter(ctx);
      ex.load('orders');
      await vi.advanceTimersByTimeAsync(0);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(10);
      expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['r1']);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
    } finally { vi.useRealTimers(); }
  });

  test('storedNow is undefined until the document was read, then the remembered reports', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a', usedAt: '2026-01-01T00:00:00.000Z' }]);
    const ex = createExporter(ctx);
    expect(ex.storedNow('orders')).toBeUndefined();
    await ex.stored('orders');
    expect(ex.storedNow('orders')).toEqual([{ reportId: 'a', usedAt: '2026-01-01T00:00:00.000Z' }]);
  });

  test('a grouped update PUT carries the aggregation and date rules; an ungrouped one resets them to null', async () => {
    const remembered = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
    for (const grouped of [true, false]) {
      const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }]);
      const ex = createExporter(ctx);
      const rules = { aggregationConfig: [{ column: 'id', function: 'COUNT' }], dateTruncConfig: [{ column: 'd', granularity: 'MONTH' }] };
      vi.useFakeTimers();
      try {
        const p = ex.run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload: { ...payload, ...(grouped ? rules : {}) } as ReportPayload });
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
        await p;
      } finally { vi.useRealTimers(); }
      const body = (ctx.owox.putJson as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
      if (grouped) expect(body).toMatchObject({ ...rules, limitConfig: null, uniqueCountConfig: null });
      else expect(body).toMatchObject({ aggregationConfig: null, dateTruncConfig: null, limitConfig: null, uniqueCountConfig: null });
    }
  });

  test('a report another tab stored since the first read survives a local change', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    const ex = createExporter(ctx);
    await ex.stored('orders');
    await ctx.collections('exports').put('orders', { reports: [{ reportId: 'a' }, { reportId: 'elsewhere', usedAt: NOW }] });
    await ex.forget('orders', 'a');
    expect(await stored(ctx)).toEqual([{ reportId: 'elsewhere', usedAt: NOW }]);
  });

  test('a change is refused when the document cannot be read again, and nothing is written', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    const base = ctx.collections;
    const col = base('exports');
    const put = vi.fn(col.put);
    let fail = false;
    (ctx as { collections: unknown }).collections = () => ({ get: async (id: string) => { if (fail) throw new Error('down'); return col.get(id); }, put });
    const ex = createExporter(ctx);
    await ex.stored('orders');
    fail = true;
    await ex.forget('orders', 'a');
    expect(put).not.toHaveBeenCalled();
  });

  test('a load and a stored call in the same tick make one document read', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    const col = ctx.collections('exports');
    const get = vi.fn(col.get);
    (ctx as { collections: unknown }).collections = () => ({ get, put: col.put });
    const ex = createExporter(ctx);
    ex.load('orders');
    await ex.stored('orders');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('a 404 read leaves the list even when the forget is refused because the document cannot be read again', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
    const col = ctx.collections('exports');
    let reads = 0;
    // The first document read (the load) works; every later one (the forget's re-read) fails.
    (ctx as { collections: unknown }).collections = () => ({ get: async (id: string) => { if (reads++ > 0) throw new Error('down'); return col.get(id); }, put: col.put });
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => { const id = path.split('/').pop()!; if (id === 'a') throw notFound(); return live(id); });
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders').map((e) => [e.reportId, e.state])).toEqual([['b', 'ready']]));
    expect(ex.storedNow('orders')?.map((r) => r.reportId)).toEqual(['b']);
    expect((await ex.stored('orders')).map((r) => r.reportId)).toEqual(['b']);
  });

  const liveGet = (ctx: ReturnType<typeof stubCtx>) => (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => live(path.split('/').pop()!));
  const allReady = (ex: ReturnType<typeof createExporter>) => vi.waitFor(() => { const e = ex.entries('orders'); expect(e.length > 0 && e.every((x) => x.state === 'ready')).toBe(true); });

  test('concurrent forgets both survive, in the document and in the entries', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }, { reportId: 'c' }]);
    liveGet(ctx);
    const ex = createExporter(ctx);
    ex.load('orders');
    await allReady(ex);
    await Promise.all([ex.forget('orders', 'a'), ex.forget('orders', 'b')]);
    expect(await stored(ctx)).toEqual([{ reportId: 'c' }]);
    expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['c']);
  });

  test('an update touching usedAt while another report is forgotten keeps both changes, and the entry carries the new usedAt', async () => {
    vi.useFakeTimers();
    try {
      const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a' };
      const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
      (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        const ran = (ctx.owox.postJson as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith('/run'));
        return { ...live(path.split('/').pop()!), lastRunAt: ran ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', lastRunStatus: 'SUCCESS' };
      });
      const ex = createExporter(ctx);
      ex.load('orders');
      await vi.advanceTimersByTimeAsync(0);
      expect(ex.entries('orders').every((e) => e.state === 'ready')).toBe(true);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T-a', source: { kind: 'update', report: remembered }, payload });
      void ex.forget('orders', 'b');
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      const { report } = await p;
      await vi.advanceTimersByTimeAsync(0);
      expect(await stored(ctx)).toEqual([{ reportId: 'a', usedAt: report.usedAt }]);
      expect(ex.entries('orders')).toMatchObject([{ reportId: 'a', usedAt: report.usedAt, state: 'ready', report: { usedAt: report.usedAt } }]);
    } finally { vi.useRealTimers(); }
  });

  test('an export reads only its own report again, not every remembered one', async () => {
    vi.useFakeTimers();
    try {
      const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a' };
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }, { reportId: 'c' }]);
      (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        calls.push(`GET ${path}`);
        const ran = (ctx.owox.postJson as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith('/run'));
        return { ...live(path.split('/').pop()!), lastRunAt: ran ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', lastRunStatus: 'SUCCESS' };
      });
      const ex = createExporter(ctx);
      ex.load('orders');
      await vi.advanceTimersByTimeAsync(0);
      const gets = (id: string) => calls.filter((c) => c === `GET /api/reports/${id}`).length;
      expect([gets('a'), gets('b'), gets('c')]).toEqual([1, 1, 1]);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T-a', source: { kind: 'update', report: remembered }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      await vi.advanceTimersByTimeAsync(0);
      expect([gets('b'), gets('c')]).toEqual([1, 1]);
      // The update's own report: the pre-run read, one poll, and one read after the run.
      expect(gets('a')).toBe(4);
      expect(ex.entries('orders').map((e) => e.state)).toEqual(['ready', 'ready', 'ready']);
    } finally { vi.useRealTimers(); }
  });

  test('an update PUTs the title and sheet OWOX has now, not the cached ones', async () => {
    vi.useFakeTimers();
    try {
      const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'Old' };
      const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
      (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        const ran = (ctx.owox.postJson as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith('/run'));
        return { ...live(path.split('/').pop()!, { title: 'Renamed in OWOX', dataDestinationAccess: { id: 'd2' }, destinationConfig: { spreadsheetId: 'moved', sheetId: 9 } }), lastRunAt: ran ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', lastRunStatus: 'SUCCESS' };
      });
      const p = createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      const { report } = await p;
      expect(report).toMatchObject({ title: 'Renamed in OWOX', destinationId: 'd2', spreadsheetId: 'moved', sheetId: 9 });
      expect(ctx.owox.putJson).toHaveBeenCalledWith('/api/reports/a', expect.objectContaining({ title: 'Renamed in OWOX', dataDestinationId: 'd2', destinationConfig: { type: 'google-sheets-config', spreadsheetId: 'moved', sheetId: 9 } }));
    } finally { vi.useRealTimers(); }
  });

  test('a new report is read once after its export when the cache has started: touch already read it', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
      (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        calls.push(`GET ${path}`);
        const ran = (ctx.owox.postJson as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith('/run'));
        return { ...live(path.split('/').pop()!), lastRunAt: ran ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', lastRunStatus: 'SUCCESS' };
      });
      const ex = createExporter(ctx);
      ex.load('orders');
      await vi.advanceTimersByTimeAsync(0);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      await vi.advanceTimersByTimeAsync(0);
      // The read `touch` started, and one poll; no third read after the run.
      expect(calls.filter((c) => c === 'GET /api/reports/r1')).toHaveLength(2);
      expect(calls.filter((c) => c === 'GET /api/reports/a')).toHaveLength(1);
      expect(ex.entries('orders').map((e) => e.state)).toEqual(['ready', 'ready']);
    } finally { vi.useRealTimers(); }
  });

  test('a rejected run reads every remembered report again', async () => {
    const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a' };
    const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => { calls.push(`GET ${path}`); return live(path.split('/').pop()!); });
    const ex = createExporter(ctx);
    ex.load('orders');
    await allReady(ex);
    const gets = (id: string) => calls.filter((c) => c === `GET /api/reports/${id}`).length;
    expect(gets('b')).toBe(1);
    (ctx.owox.putJson as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await ex.run({ martId: 'orders', destination: dest, title: 'T-a', source: { kind: 'update', report: remembered }, payload }).catch(() => undefined);
    await vi.waitFor(() => expect(gets('b')).toBe(2));
    await allReady(ex);
    expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['a', 'b']);
  });

  test('an export whose cache never started reads every remembered report', async () => {
    vi.useFakeTimers();
    try {
      const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a' };
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
      (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        calls.push(`GET ${path}`);
        const ran = (ctx.owox.postJson as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith('/run'));
        return { ...live(path.split('/').pop()!), lastRunAt: ran ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', lastRunStatus: 'SUCCESS' };
      });
      const ex = createExporter(ctx);
      // No `load` before the run: the menu was never opened.
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T-a', source: { kind: 'update', report: remembered }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.filter((c) => c === 'GET /api/reports/b')).toHaveLength(1);
      expect(ex.entries('orders').map((e) => [e.reportId, e.state])).toEqual([['a', 'ready'], ['b', 'ready']]);
    } finally { vi.useRealTimers(); }
  });

  test('a new report is not read before its run: the create response already has its run status', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1);
      const ex = createExporter(ctx);
      const p = ex.run({ martId: 'orders', destination: dest, title: 'T', source: { kind: 'new' }, payload });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
      await p;
      const afterCreate = calls.slice(calls.indexOf('POST /api/reports') + 1);
      expect(afterCreate[0]).toBe('POST /api/reports/r1/run');
    } finally { vi.useRealTimers(); }
  });

  test('a read that returns after invalidate() is ignored', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    let release: (v: unknown) => void = () => {};
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const ex = createExporter(ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(ex.entries('orders')).toHaveLength(1));
    ex.invalidate();
    release(live('a'));
    await new Promise((r) => setTimeout(r, 10));
    expect(ex.entries('orders')).toEqual([]);
  });

  test('an update whose PUT is a 404 also removes the entry from the cache', async () => {
    const remembered = { reportId: 'a', destinationId: 'd1', spreadsheetId: 's-a', sheetId: 1, title: 'T-a' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
    liveGet(ctx);
    const ex = createExporter(ctx);
    ex.load('orders');
    await allReady(ex);
    (ctx.owox.putJson as ReturnType<typeof vi.fn>).mockRejectedValue(notFound());
    await ex.run({ martId: 'orders', destination: dest, title: 'T-a', source: { kind: 'update', report: remembered }, payload }).catch(() => undefined);
    await vi.waitFor(() => expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['b']));
  });

  test('a failed read of the stored document is not cached and nothing is written over it; the next call reads again', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    liveGet(ctx);
    const col = ctx.collections<{ reports: StoredReport[] }>('exports');
    const realGet = col.get.bind(col);
    const put = vi.spyOn(col, 'put');
    const get = vi.spyOn(col, 'get').mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx2 = { ...ctx, collections: () => col } as typeof ctx;
    const ex = createExporter(ctx2);
    await ex.forget('orders', 'a');
    expect(put).not.toHaveBeenCalled();
    expect(await ex.stored('orders')).toEqual([{ reportId: 'a' }]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(realGet).toBeDefined();
  });

  test('a load whose stored read failed leaves no cache behind: the next load reads again', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }]);
    liveGet(ctx);
    const col = ctx.collections<{ reports: StoredReport[] }>('exports');
    vi.spyOn(col, 'get').mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ex = createExporter({ ...ctx, collections: () => col } as typeof ctx);
    ex.load('orders');
    await vi.waitFor(() => expect(col.get).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(ex.entries('orders')).toEqual([]);
    ex.load('orders');
    await allReady(ex);
    expect(ex.entries('orders').map((e) => e.reportId)).toEqual(['a']);
  });

  test('a change that throws does not block later changes, and its caller sees the error', async () => {
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'a' }, { reportId: 'b' }]);
    liveGet(ctx);
    const ex = createExporter(ctx);
    ex.load('orders');
    await allReady(ex);
    const off = ex.subscribe('orders', () => { throw new Error('listener broke'); });
    await expect(ex.forget('orders', 'a')).rejects.toThrow('listener broke');
    off();
    await ex.forget('orders', 'b');
    expect(await stored(ctx)).toEqual([]);
  });

  test('an update whose PUT is a 404 forgets the report and throws a gone ExportError at the report step', async () => {
    const remembered = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }, { reportId: 'r2' }]);
    (ctx.owox.putJson as ReturnType<typeof vi.fn>).mockRejectedValue(notFound());
    const ex = createExporter(ctx);
    const err = await ex.run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload }).catch((e) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect(isGone(err)).toBe(true);
    expect(err).toMatchObject({ stage: 'report', message: 'This report no longer exists in OWOX' });
    expect(await stored(ctx)).toEqual([{ reportId: 'r2' }]);
    expect(ctx.owox.postJson).not.toHaveBeenCalled();
    expect(isGone(new ExportError('report', 'x'))).toBe(false);
  });

  test('an update that fails for another reason is not gone and keeps the report', async () => {
    const remembered = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
    const { ctx } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }]);
    (ctx.owox.putJson as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const err = await createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload }).catch((e) => e);
    expect(isGone(err)).toBe(false);
    expect(await stored(ctx)).toEqual([{ reportId: 'r1' }]);
  });

  test('a report that is already running is not run again', async () => {
    const remembered = { reportId: 'r1', destinationId: 'd1', spreadsheetId: 'sheet1', sheetId: 7, title: 'Old' };
    const { ctx, calls } = exportCtx({ status: 'SUCCESS' }, 1, [{ reportId: 'r1' }]);
    (ctx.owox.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'RUNNING' });
    const { outcome } = await createExporter(ctx).run({ martId: 'orders', destination: dest, title: 'Old', source: { kind: 'update', report: remembered }, payload });
    expect(outcome.state).toBe('busy');
    expect(calls.some((c) => c.endsWith('/run'))).toBe(false);
    expect(ctx.owox.putJson).toHaveBeenCalled();
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
    expect(await ex.stored('orders')).toHaveLength(1);
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

test('a grouped grid exports its rules: aggregationConfig, dateTruncConfig, and the opt-out only for columns with no function', () => {
  const agg = { aggregations: [{ column: 'amount', function: 'SUM' as const }, { column: 'amount', function: 'AVG' as const }, { column: 'gone', function: 'MIN' as const }], dateTrunc: [{ column: 'created_at', unit: 'MONTH' as const, timeZone: 'UTC' }] };
  const { payload } = buildReportPayload(schema, ['status', 'amount', 'created_at'], [], [{ field: 'amount', direction: 'desc' }], agg);
  expect(payload.columnConfig).toEqual(['status', 'amount', 'created_at']);
  expect(payload.aggregationConfig).toEqual([{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'AVG' }]);
  expect(payload.dateTruncConfig).toEqual([{ column: 'created_at', unit: 'MONTH', timeZone: 'UTC' }]);
  expect(payload.autoAggregationOptOut).toEqual(['status', 'created_at']);
  expect(payload.sortConfig).toEqual([{ column: 'amount', direction: 'desc' }]);
  // an ungrouped grid carries neither key
  const plain = buildReportPayload(schema, ['status'], [], []).payload;
  expect('aggregationConfig' in plain).toBe(false);
  expect('dateTruncConfig' in plain).toBe(false);
});

describe('buildReportPayload with slices and HAVING', () => {
  const joinedSchema: Schema = [...schema, f('customers__country_code', 'STRING', 'string', { joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers', originalName: 'country_code', sourceType: 'STRING' } })];
  test('a slice goes out pre-join after the filters, and a HAVING filter goes out with its aggregation', () => {
    const filters: ColumnFilter[] = [{ field: 'status', op: 'eq', value: 'paid' }, { field: 'amount', op: 'gt', value: '100', fn: 'SUM' }];
    const slices: ColumnFilter[] = [{ field: 'customers__country_code', op: 'eq', value: 'PL' }];
    const { payload } = buildReportPayload(joinedSchema, ['status', 'amount', 'customers__country_code'], filters, [], { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] }, slices);
    expect(payload.filterConfig).toEqual([
      { column: 'status', operator: 'eq', value: 'paid' },
      { column: 'amount', operator: 'gt', value: 100, function: 'SUM' },
      { column: 'customers__country_code', operator: 'eq', value: 'PL', placement: 'pre-join' },
    ]);
  });
  test('a HAVING filter without its aggregation among the exported columns is left out', () => {
    const { payload } = buildReportPayload(joinedSchema, ['status'], [{ field: 'amount', op: 'gt', value: '100', fn: 'SUM' }], [], { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [] });
    expect(payload.filterConfig).toBeNull();
  });
  test('the filter cap counts filters and slices together', () => {
    const many: ColumnFilter[] = Array.from({ length: 50 }, () => ({ field: 'status', op: 'is_blank' as const }));
    const { notes } = buildReportPayload(joinedSchema, ['status'], many, [], undefined, [{ field: 'customers__country_code', op: 'eq', value: 'PL' }]);
    expect(notes.length).toBe(1);
  });
});
