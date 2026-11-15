import { render, screen, waitFor, within } from '@testing-library/react';
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
