import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ExportedReport } from '../../api/exports';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

type Call = string;

function setup(sheets: 0 | 1 | 2, remembered: ExportedReport[] = []) {
  const base = createMockCtx(demoFixtures({ sheets }), { latencyMs: 0 });
  const calls: Call[] = [];
  const open = vi.fn(async () => {});
  const o = base.owox;
  const ctx: Ctx = {
    ...base,
    ui: { openExternal: open },
    owox: {
      ...o,
        postJson: ((path: string, body: unknown) => { calls.push(`POST ${path}`); return o.postJson(path, body); }) as Ctx['owox']['postJson'],
      putJson: ((path: string, body: unknown) => { calls.push(`PUT ${path}`); return o.putJson(path, body); }) as Ctx['owox']['putJson'],
      getJson: ((path: string, q?: Record<string, string>) => { if (path.startsWith('/api/reports')) calls.push(`GET ${path}`); return o.getJson(path, q); }) as Ctx['owox']['getJson'],
    },
  };
  const seeded = remembered.length ? ctx.collections('exports').put('orders', { reports: remembered }) : Promise.resolve();
  const view = () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  return { ctx, calls, open, view, seeded };
}
const data = () => document.getElementById('band-data')!;
const rowsLoaded = () => waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
const REPORT: ExportedReport = { reportId: 'mock-report-1', destinationId: 'd-sheets-team', spreadsheetId: 'mock-sheet-1', sheetId: 0, title: 'Orders weekly' };

test('with no Google Sheets destination there is no Export control', async () => {
  const t = setup(0);
  t.view();
  await rowsLoaded();
  expect(within(data()).queryByText('Export')).toBeNull();
  expect(within(data()).queryByLabelText('Export to Google Sheets')).toBeNull();
});

test('one destination and no report: one click makes the spreadsheet, the report, runs it and opens the sheet', async () => {
  const t = setup(1);
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByRole('button', { name: 'Export to Google Sheets' }));
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 5000 });
  const writes = t.calls.filter((c) => /^(POST|PUT) \/api\/(reports|data-destinations)/.test(c));
  expect(writes).toEqual(['POST /api/data-destinations/d-sheets-team/google-sheets/documents', 'POST /api/reports', 'POST /api/reports/mock-report-1/run']);
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  expect(within(data()).getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
});

test('two destinations: the first level lists them, each with its New report entry', async () => {
  const t = setup(2);
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByText('Export'));
  expect(await within(data()).findByRole('menuitem', { name: /Team Sheets/ })).toBeInTheDocument();
  expect(within(data()).getByRole('menuitem', { name: /Finance Sheets/ })).toBeInTheDocument();
  expect(within(data()).queryByText(/Looker/)).toBeNull();
  expect(within(data()).queryByRole('menuitem', { name: /New report/ })).toBeNull();
  await userEvent.click(within(data()).getByRole('menuitem', { name: /Finance Sheets/ }));
  expect(within(data()).getByRole('menuitem', { name: /New report/ })).toBeInTheDocument();
});

test('a remembered report is offered as an update, which PUTs it and runs it', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  // seed the mock report the remembered entry points at
  await t.ctx.owox.postJson('/api/reports', { title: 'Orders weekly', dataMartId: 'orders' });
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /Update “Orders weekly”/ }));
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 5000 });
  const writes = t.calls.filter((c) => /^(PUT|POST \/api\/reports\/)/.test(c));
  expect(writes).toEqual(['PUT /api/reports/mock-report-1', 'POST /api/reports/mock-report-1/run']);
});

test('a remembered report OWOX no longer has is not offered', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByText('Export'));
  await waitFor(() => expect(within(data()).queryByRole('menuitem', { name: /Update/ })).toBeNull());
  expect(within(data()).getByRole('menuitem', { name: /New report/ })).toBeInTheDocument();
  await waitFor(async () => expect((await t.ctx.collections<{ reports: ExportedReport[] }>('exports').get('orders'))?.document.reports).toEqual([]));
});

test('New report… opens the dialog; a bad link is refused, a good one is used without creating a spreadsheet', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  await t.ctx.owox.postJson('/api/reports', { title: 'x', dataMartId: 'orders' });
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /New report/ }));
  const dialog = await screen.findByRole('dialog', { name: 'New report' });
  expect((within(dialog).getByLabelText('Report title') as HTMLInputElement).value).toMatch(/^Orders · Data Explorer · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
  expect(within(dialog).getByText(/Share it with the destination’s account as Editor/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/Paste the link/);
  await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/mine/edit#gid=5');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mine/edit#gid=5'), { timeout: 5000 });
  expect(t.calls.some((c) => c.includes('google-sheets/documents'))).toBe(false);
});

test('when the spreadsheet cannot be created the New report dialog opens with the message', async () => {
  const t = setup(1);
  const real = t.ctx.owox.postJson;
  (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => (path.endsWith('/google-sheets/documents') ? Promise.reject(new Error('No Drive folder is configured')) : real(path, body))) as Ctx['owox']['postJson'];
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByRole('button', { name: 'Export to Google Sheets' }));
  const dialog = await screen.findByRole('dialog', { name: 'New report' });
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not create a spreadsheet: No Drive folder is configured');
  expect(within(dialog).getByLabelText('Existing spreadsheet')).toBeInTheDocument();
  expect(t.calls.some((c) => c === 'POST /api/reports')).toBe(false);
});

test('a failure after the report exists closes the dialog and reports in the header, so a retry cannot make a second report', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  const real = t.ctx.owox.postJson;
  (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => (path.endsWith('/run') ? Promise.reject(new Error('run refused')) : real(path, body))) as Ctx['owox']['postJson'];
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /New report/ }));
  const dialog = await screen.findByRole('dialog', { name: 'New report' });
  await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
  await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/published-to-web/);
  await userEvent.clear(within(dialog).getByLabelText('Spreadsheet link'));
  await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/mine/edit');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await within(data()).findByText(/The run could not be followed: run refused/)).toBeInTheDocument();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
});

test('a remembered report with an unrecognised target is not updated and nothing is opened', async () => {
  const t = setup(1, [{ ...REPORT, spreadsheetId: '../../url?q=https://evil.example' }]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  await t.ctx.owox.postJson('/api/reports', { title: 'x', dataMartId: 'orders' });
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /Update/ }));
  expect(await within(data()).findByText(/unrecognised spreadsheet/)).toBeInTheDocument();
  expect(t.open).not.toHaveBeenCalled();
  expect(t.calls.some((c) => c.startsWith('PUT'))).toBe(false);
});

const martCard = (title: string) => within(document.getElementById('band-marts')!).getByText(title).closest('article')!;
const toMart = async (title: string) => { fireEvent.click(martCard(title)); await within(data()).findByRole('heading', { name: title }); };
const exportControl = () => within(data()).findByLabelText('Export to Google Sheets');

test('leaving the mart and coming back keeps the export busy: no second export, and the outcome opens the sheet', async () => {
  const t = setup(1);
  t.view();
  await rowsLoaded();
  await userEvent.click(await exportControl());
  await within(data()).findByText('Exporting…');
  await toMart('Customers');
  await toMart('Orders');
  await exportControl();
  expect(within(data()).getByText('Exporting…')).toBeInTheDocument();
  expect(within(data()).getByText(/…$/, { selector: '[role="status"]' })).toBeInTheDocument();
  await userEvent.click(await exportControl());
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 6000 });
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  await waitFor(() => expect(within(data()).queryByText('Exporting…')).toBeNull());
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
}, 15000);

test('an export that finishes while the member is on another mart does not open the sheet; the result waits on that mart', async () => {
  const t = setup(1);
  t.view();
  await rowsLoaded();
  await userEvent.click(await exportControl());
  await toMart('Customers');
  await waitFor(() => expect(t.calls).toContain('POST /api/reports/mock-report-1/run'), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 3500));
  expect(t.open).not.toHaveBeenCalled();
  await toMart('Orders');
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  expect(within(data()).getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
  expect(t.open).not.toHaveBeenCalled();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
}, 20000);

/** The dialog route with a new spreadsheet; `fail` decides what POST /api/reports does the first time. */
async function newReportFailing(fail: () => Error) {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  const real = t.ctx.owox.postJson;
  let failed = false;
  (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => {
    if (path === '/api/reports' && !failed) { failed = true; t.calls.push(`POST ${path}`); return Promise.reject(fail()); }
    return real(path, body);
  }) as Ctx['owox']['postJson'];
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /New report/ }));
  const dialog = await screen.findByRole('dialog', { name: 'New report' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  return { t, dialog };
}

test('a retry after the report step failed reuses the spreadsheet already made', async () => {
  const { t, dialog } = await newReportFailing(() => new Error('report refused'));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('report refused'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 6000 });
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1);
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(2);
}, 15000);

test.each([
  ['NETWORK_ERROR', { payload: { code: 'NETWORK_ERROR' } }],
  ['a 504', { payload: { code: 'HTTP_ERROR', status: 504 } }],
  ['a 502', { payload: { code: 'HTTP_ERROR', status: 502 } }],
])('%s on the report step is treated like a timeout: no retry', async (_n, extra) => {
  const { t } = await newReportFailing(() => Object.assign(new Error('gateway'), extra));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await within(data()).findByText('The report may have been created; check OWOX before trying again.')).toBeInTheDocument();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
});

test('a timeout on the report step closes the dialog and warns that the report may exist, with no retry', async () => {
  const { t } = await newReportFailing(() => Object.assign(new Error('Request timed out'), { payload: { code: 'TIMEOUT' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await within(data()).findByText('The report may have been created; check OWOX before trying again.')).toBeInTheDocument();
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1);
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
});

test('Update stays disabled until the live check of the remembered reports has finished, so no stale title is sent', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  await t.ctx.owox.postJson('/api/reports', { title: 'Renamed in OWOX', dataMartId: 'orders' });
  const real = t.ctx.owox.getJson;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  (t.ctx.owox as { getJson: Ctx['owox']['getJson'] }).getJson = (async (path: string, q?: Record<string, string>) => {
    if (path === '/api/reports/mock-report-1') await gate;
    return real(path, q);
  }) as Ctx['owox']['getJson'];
  await userEvent.click(await within(data()).findByText('Export'));
  const update = await within(data()).findByRole('menuitem', { name: /Update/ });
  expect(update).toBeDisabled();
  expect(update).toHaveTextContent('Checking…');
  await userEvent.click(update);
  expect(t.calls.some((c) => c.startsWith('PUT'))).toBe(false);
  release();
  await waitFor(() => expect(within(data()).getByRole('menuitem', { name: /Update “Renamed in OWOX”/ })).toBeEnabled());
  await userEvent.click(within(data()).getByRole('menuitem', { name: /Update “Renamed in OWOX”/ }));
  await waitFor(() => expect(t.calls).toContain('PUT /api/reports/mock-report-1'), { timeout: 5000 });
});

test('the spreadsheet a failed report step left is reused even after the menu was remounted', async () => {
  const { t, dialog } = await newReportFailing(() => new Error('report refused'));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('report refused'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await toMart('Customers');
  await toMart('Orders');
  await rowsLoaded();
  // The remembered report is not in the mock OWOX, so the live check leaves the one-click button.
  await userEvent.click(await within(data()).findByRole('button', { name: 'Export to Google Sheets' }));
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 6000 });
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1);
}, 15000);

test('Update is disabled from the first render of an opened menu, before any toggle handler ran', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  await t.ctx.owox.postJson('/api/reports', { title: 'Orders weekly', dataMartId: 'orders' });
  await within(data()).findByText('Export');
  expect(within(data()).getByRole('menuitem', { name: /Update/, hidden: true })).toBeDisabled();
});
