import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ExportedReport } from '../../api/exports';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { TooltipProvider } from '../Tooltip';
import type { Schema } from '../../model/types';
import type { Row } from '../../sdk/types';
import { ExportMenu } from './ExportMenu';

type Call = string;

function setup(sheets: 0 | 1 | 2, remembered: ExportedReport[] = [], runMs?: number) {
  const base = createMockCtx(demoFixtures({ sheets }), { latencyMs: 0, runMs });
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
/** Export, the one destination, New report…, and Export in the dialog. */
const exportNew = async () => {
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /Team Sheets/ }));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /New report/ }));
  const dialog = await screen.findByRole('dialog', { name: 'New report' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  return dialog;
};
const rowsLoaded = () => waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
const REPORT: ExportedReport = { reportId: 'mock-report-1', destinationId: 'd-sheets-team', spreadsheetId: 'mock-sheet-1', sheetId: 0, title: 'Orders weekly' };

test('with no Google Sheets destination Export is still a menu, with the AI group and no destination row', async () => {
  const t = setup(0);
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByText('Export'));
  expect(within(data()).getAllByRole('menuitem').filter((r) => !r.hasAttribute('data-link')).map((r) => r.textContent)).toEqual(['Copy to clipboard', 'Claude', 'ChatGPT']);
  // no "AI" sub-header: Claude and ChatGPT follow a separator only
  expect(within(data()).queryByText('AI')).toBeNull();
  expect(within(data()).getByRole('menuitem', { name: 'Claude' }).closest('.dm-export-ai')).not.toBeNull();
  expect(data().querySelector('[data-action="copy"] svg')).toHaveClass('lucide-copy');
});

test('one destination and no report: the button is still a menu; New report makes the spreadsheet, the report, runs it and opens the sheet', async () => {
  const t = setup(1);
  t.view();
  await rowsLoaded();
  await exportNew();
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 5000 });
  const writes = t.calls.filter((c) => /^(POST|PUT) \/api\/(reports|data-destinations)/.test(c));
  expect(writes).toEqual(['POST /api/data-destinations/d-sheets-team/google-sheets/documents', 'POST /api/reports', 'POST /api/reports/mock-report-1/run']);
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  expect(within(data()).getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
});

test('the Export button carries the archive-restore icon, and the Google Sheets icon stays on the destination rows', async () => {
  const t = setup(2);
  t.view();
  await rowsLoaded();
  const summary = (await within(data()).findByText('Export')).closest('summary')!;
  expect(summary.querySelector('svg.lucide-archive-restore')).not.toBeNull();
  expect(summary.querySelector('svg[viewBox="0 0 48 48"]')).toBeNull();
  await userEvent.click(summary);
  const item = await within(data()).findByRole('menuitem', { name: /Team Sheets/ });
  expect(item.querySelector('svg[viewBox="0 0 48 48"]')).not.toBeNull();
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
  await openMenu();
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
  await openMenu();
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
  await openMenu();
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
  const dialog = await exportNew();
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not create a spreadsheet: No Drive folder is configured'));
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
  await openMenu();
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
  await openMenu();
  await userEvent.click(await within(data()).findByRole('menuitem', { name: /Update/ }));
  expect(await within(data()).findByText(/unrecognised spreadsheet/)).toBeInTheDocument();
  expect(t.open).not.toHaveBeenCalled();
  expect(t.calls.some((c) => c.startsWith('PUT'))).toBe(false);
});

const martCard = (title: string) => within(document.getElementById('band-marts')!).getByText(title).closest('article')!;
const headingText = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!).join(' + ');
/** A mart the main one can join is added to its grid first, so clicking the main card then promotes it. */
const toMart = async (title: string) => {
  const main = headingText()!;
  fireEvent.click(martCard(title));
  // A mart that comes back as main shows the joined marts it was left with.
  const mainNow = () => headingText() === title || headingText()!.startsWith(`${title} + `);
  await waitFor(() => expect(mainNow() || headingText() === `${main} + ${title}`).toBe(true));
  if (!mainNow()) fireEvent.click(martCard(main));
  await waitFor(() => expect(mainNow()).toBe(true));
};
/** Export, then the one destination: the first level lists destinations and its reports open in a flyout. */
const openMenu = async (destination: RegExp | string = /Team Sheets/) => {
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: destination }));
};


test('leaving the mart and coming back keeps the export busy: no second export, and the outcome opens the sheet', async () => {
  const t = setup(1, [], 8000); // a run long enough to still be going after two mart changes on a slow machine
  t.view();
  await rowsLoaded();
  await exportNew();
  await within(data()).findByText('Exporting…');
  await toMart('Customers');
  await toMart('Orders');
  await within(data()).findByText('Exporting…');
  expect(within(data()).getByText(/…$/, { selector: '[role="status"]' })).toBeInTheDocument();
  // A second click on the busy button opens nothing.
  await userEvent.click(within(data()).getByText('Exporting…'));
  expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 15000 });
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  await waitFor(() => expect(within(data()).queryByText('Exporting…')).toBeNull());
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
}, 30000);

test('an export that finishes while the member is on another mart does not open the sheet; the result waits on that mart', async () => {
  // The run takes 6s, so it is still going when the member reaches Customers even on a slow machine.
  const t = setup(1, [], 6000);
  t.view();
  await rowsLoaded();
  await exportNew();
  await toMart('Customers');
  await waitFor(() => expect(t.calls).toContain('POST /api/reports/mock-report-1/run'), { timeout: 5000 });
  // It finishes there: the run ends at 6s and the next poll (every 2s) sees it.
  await waitFor(() => expect(t.calls.filter((c) => c === 'GET /api/reports/mock-report-1').length).toBeGreaterThan(0), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 9000));
  expect(t.open).not.toHaveBeenCalled();
  await toMart('Orders');
  expect(await within(data()).findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  expect(within(data()).getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
  expect(t.open).not.toHaveBeenCalled();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
}, 40000);

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
  await openMenu();
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
  await openMenu();
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
  await exportNew();
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
  // The menu is still closed (no toggle ran); its flyout, opened on the destination row, is disabled from its first render.
  fireEvent.mouseEnter(within(data()).getByRole('menuitem', { name: /Team Sheets/, hidden: true }).closest('.dm-cascade-row')!);
  expect(within(data()).getByRole('menuitem', { name: /Update/, hidden: true })).toBeDisabled();
});

test('a spreadsheet left behind on one destination is not reused for another destination', async () => {
  const t = setup(2);
  const real = t.ctx.owox.postJson;
  let failed = false;
  (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => {
    if (path === '/api/reports' && !failed) { failed = true; return Promise.reject(new Error('report refused')); }
    return real(path, body);
  }) as Ctx['owox']['postJson'];
  t.view();
  await rowsLoaded();
  const openNew = async (dest: RegExp) => {
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: dest }));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: /New report/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New report' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    return dialog;
  };
  const dialog = await openNew(/Team Sheets/);
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('report refused'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await openNew(/Finance Sheets/);
  await waitFor(() => expect(t.open).toHaveBeenCalled(), { timeout: 6000 });
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toEqual([
    'POST /api/data-destinations/d-sheets-team/google-sheets/documents',
    'POST /api/data-destinations/d-sheets-finance/google-sheets/documents',
  ]);
}, 15000);

describe('the cascading menu', () => {
  test('each destination row is the Google Sheets icon and its title, with no "Google Sheets" text label', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const rows = (await within(data()).findAllByRole('menuitem')).filter((r) => !r.hasAttribute('data-link'));
    expect(rows.map((r) => r.textContent)).toEqual(['Copy to clipboard', 'Team Sheets', 'Finance Sheets', 'Claude', 'ChatGPT']);
    for (const r of rows.slice(1, 3)) expect(r.querySelector('svg[viewBox="0 0 48 48"]')).not.toBeNull();
    expect(within(data()).queryByText('Google Sheets')).toBeNull();
    // the Export button itself does not
    expect((await within(data()).findByText('Export')).closest('summary')!.querySelector('svg[viewBox="0 0 48 48"]')).toBeNull();
  });

  test('hovering a destination opens its flyout beside it, with New report', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    expect(within(data()).queryByRole('menu', { name: 'Team Sheets' })).toBeNull();
    await userEvent.hover(await within(data()).findByRole('menuitem', { name: /Team Sheets/ }));
    const sub = await within(data()).findByRole('menu', { name: 'Team Sheets' });
    expect(sub.closest('.dm-cascade-row')).toBe(within(data()).getByRole('menuitem', { name: /Team Sheets/ }).closest('.dm-cascade-row'));
    expect(within(sub).getByRole('menuitem', { name: /New report/ })).toBeInTheDocument();
    await userEvent.hover(within(data()).getByRole('menuitem', { name: /Finance Sheets/ }));
    expect(within(data()).queryByRole('menu', { name: 'Team Sheets' })).toBeNull();
    expect(within(data()).getByRole('menu', { name: 'Finance Sheets' })).toBeInTheDocument();
  });

  test('with one destination and remembered reports the first level still lists that destination, and its flyout holds the update', async () => {
    const t = setup(1, [REPORT]);
    await t.seeded;
    t.view();
    await rowsLoaded();
    await t.ctx.owox.postJson('/api/reports', { title: 'Orders weekly', dataMartId: 'orders' });
    await userEvent.click(await within(data()).findByText('Export'));
    const first = await within(data()).findByRole('menuitem', { name: /Team Sheets/ });
    expect(within(data()).queryByRole('menuitem', { name: /Update/ })).toBeNull();
    await userEvent.click(first);
    expect(await within(data()).findByRole('menuitem', { name: /Update “Orders weekly”/ })).toBeInTheDocument();
  });

  test('the flyout goes to the left when there is no room on the right', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.classList.contains('dm-cascade-sub') ? 250 : 200;
      const left = this.classList.contains('dm-cascade-row') ? 1000 : 0;
      return { left, right: left + w, width: w, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      await userEvent.click(await within(data()).findByText('Export'));
      await userEvent.hover(await within(data()).findByRole('menuitem', { name: /Team Sheets/ }));
      const sub = await within(data()).findByRole('menu', { name: 'Team Sheets' });
      await waitFor(() => expect(sub).toHaveClass('dm-cascade-left'));
    } finally { rect.mockRestore(); }
  });

  test('keyboard: arrows walk a level, ArrowRight or Enter opens the flyout, Escape closes a level at a time', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const team = await within(data()).findByRole('menuitem', { name: /Team Sheets/ });
    team.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(data()).getByRole('menuitem', { name: /Finance Sheets/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowRight}');
    const sub = await within(data()).findByRole('menu', { name: 'Team Sheets' });
    await waitFor(() => expect(within(sub).getByRole('menuitem', { name: /New report/ })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(within(data()).queryByRole('menu', { name: 'Team Sheets' })).toBeNull();
    expect(within(data()).getByRole('menuitem', { name: /Team Sheets/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await within(data()).findByRole('menu', { name: 'Team Sheets' });
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(data()).queryByRole('menu', { name: 'Team Sheets' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
  });

  test('on the Export button, ArrowDown or Enter focuses the first row and Escape closes the menu', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    const summary = (await within(data()).findByText('Export')).closest('summary')!;
    summary.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.querySelector('details.dm-export')).toHaveAttribute('open');
    expect(within(data()).getByRole('menuitem', { name: /Copy to clipboard/ })).toHaveFocus();
    summary.focus();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
    summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(within(data()).getByRole('menuitem', { name: /Copy to clipboard/ })).toHaveFocus();
  });

  test('ArrowRight on a row whose flyout the pointer already opened moves focus into it', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const team = await within(data()).findByRole('menuitem', { name: /Team Sheets/ });
    await userEvent.hover(team);
    const sub = await within(data()).findByRole('menu', { name: 'Team Sheets' });
    expect(sub.contains(document.activeElement)).toBe(false);
    team.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(sub).getByRole('menuitem', { name: /New report/ })).toHaveFocus());
  });
});

describe('the AI group', () => {
  const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  afterEach(() => { setClipboard(undefined); Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined }); });

  test('Claude and ChatGPT follow the Google Sheets destinations, each under its own icon', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const items = (await within(data()).findAllByRole('menuitem')).filter((r) => !r.hasAttribute('data-link'));
    expect(items.map((i) => i.textContent)).toEqual(['Copy to clipboard', 'Team Sheets', 'Claude', 'ChatGPT']);
    expect(items[2]!.querySelector('svg path[fill="#D97757"]')).not.toBeNull();
    expect(items[3]!.querySelector('svg')).not.toBeNull();
  });

  test.each([
    ['Claude', 'https://claude.ai/directory/owox-data-marts'],
    ['ChatGPT', 'https://chatgpt.com/plugins/plugin_asdk_app_6a3e81be8f8481918e1e2cd1d7ea09c4?q=owox'],
  ])('%s has an external-link button that opens its OWOX listing and copies nothing', async (name, url) => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const link = await within(data()).findByRole('menuitem', { name: `Open OWOX in ${name}` });
    expect(link.closest('.dm-export-ai')).not.toBeNull();
    await userEvent.click(link);
    expect(t.open).toHaveBeenCalledWith(url);
    expect(t.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Prompt copied/)).toBeNull();
  });

  test('the provider link is reached from its item with ArrowRight and Tab, and Enter opens it', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const item = await within(data()).findByRole('menuitem', { name: 'Claude' });
    item.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(data()).getByRole('menuitem', { name: 'Open OWOX in Claude' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(t.open).toHaveBeenCalledWith('https://claude.ai/directory/owox-data-marts');
    await userEvent.keyboard('{ArrowLeft}');
    expect(item).toHaveFocus();
  });

  test('choosing Claude copies the prompt, says so, and "Show prompt" opens it read-only with a Copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'Claude' }));
    expect(await screen.findByText('Prompt copied. Paste it into Claude')).toBeInTheDocument();
    // A standard toast, not a note in the Data band's title row.
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Prompt copied');
    expect(data().contains(toast)).toBe(false);
    expect(within(toast).getByRole('button', { name: 'Show prompt' })).toBeInTheDocument();
    const prompt = writeText.mock.calls[0]![0] as string;
    expect(prompt).toMatch(/^This request is read-only: .+\nEverything in double quotes .+\nUsing the OWOX Data Marts connector, in the OWOX project "mock-project" \(project id "mock-project"\):\nQuery the data mart "Orders" \(id "orders"\)\.\nFields: .+\.\nFilters: none\nSort: "created_at" descending\.\nShow the result as a table, and say if rows were truncated\.$/);
    expect(t.calls.filter((c) => /^(POST|PUT) \/api\/(reports|data-destinations)/.test(c))).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Show prompt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Prompt' });
    const area = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    expect(area).toHaveAttribute('readonly');
    expect(area.value).toBe(prompt);
    // The dialog opens with the textarea focused; focusing it again selects everything.
    area.blur();
    area.focus();
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe(prompt.length);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument();
  });

  test('the prompt dialog takes focus into its textarea, keeps Tab inside, and Escape returns focus to Export', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const t = setup(0);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'Claude' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show prompt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Prompt' });
    const area = within(dialog).getByRole('textbox');
    await waitFor(() => expect(area).toHaveFocus());
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveFocus();
    await userEvent.tab();
    expect(area).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Prompt' })).toBeNull());
    expect(document.querySelector('details.dm-export summary')).toHaveFocus();
  });

  test('ChatGPT names itself in the status', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const t = setup(0);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'ChatGPT' }));
    expect(await screen.findByText('Prompt copied. Paste it into ChatGPT')).toBeInTheDocument();
  });

  test('when the clipboard is out of reach both ways, the dialog opens directly', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('blocked')));
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const t = setup(0);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'Claude' }));
    const dialog = await screen.findByRole('dialog', { name: 'Prompt' });
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/Using the OWOX Data Marts connector/);
    expect(screen.queryByText(/Prompt copied/)).toBeNull();
  });

  test('the prompt follows the grid: the columns shown, the filters and the sorts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const t = setup(0);
    t.view();
    await rowsLoaded();
    await userEvent.click(within(data()).getByRole('button', { name: 'Sort by status, currently not sorted' }));
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'Claude' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toMatch(/Sort: "status" ascending\./);
  });
});

describe('Copy to clipboard', () => {
  const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  afterEach(() => { delete (navigator as { clipboard?: unknown }).clipboard; delete (document as { execCommand?: unknown }).execCommand; });
  const ORDERS: Schema = [
    { name: 'id', type: 'INTEGER', category: 'number' },
    { name: 'note', type: 'STRING', category: 'string', alias: 'Note' },
    { name: 'customers__city', type: 'STRING', category: 'string', alias: 'City', joined: { martId: 'customers', label: 'Customers' } },
  ] as Schema;
  const lone = (rows: Row[] | null, hasMore = false, loading = false) => {
    const ctx = createMockCtx(demoFixtures({ sheets: 0 }), { latencyMs: 0 });
    return render(<AppServices ctx={ctx}><TooltipProvider><StoreProvider><ExportMenu martId="orders" martTitle="Orders" schema={ORDERS} visible={['id', 'note', 'customers__city']} filters={[]} sorts={[]} rows={rows} hasMore={hasMore} loading={loading} /></StoreProvider></TooltipProvider></AppServices>);
  };

  test('with no rows the keyboard still reaches the next enabled item', async () => {
    lone([]);
    const summary = (await screen.findByText('Export')).closest('summary')!;
    summary.focus();
    await userEvent.keyboard('{ArrowDown}');
    const enabled = screen.getAllByRole('menuitem').filter((i) => !(i as HTMLButtonElement).disabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[0]).toHaveFocus();
  });

  test('while rows are loading the item is disabled with its reason, and enabled once they are in', async () => {
    const view = lone([{ id: 1, note: 'a', customers__city: 'x' }], false, true);
    await userEvent.click(await screen.findByText('Export'));
    const item = await screen.findByRole('menuitem', { name: 'Copy to clipboard' });
    expect(item).toBeDisabled();
    await userEvent.hover(item.parentElement!);
    expect(await screen.findAllByText('Rows are loading')).not.toHaveLength(0);
    view.unmount();
    lone([{ id: 1, note: 'a', customers__city: 'x' }], false, false);
    await userEvent.click(await screen.findByText('Export'));
    expect(await screen.findByRole('menuitem', { name: 'Copy to clipboard' })).toBeEnabled();
  });

  test('it is the first group, above the destinations and the assistants, with the copy icon', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const item = await within(data()).findByRole('menuitem', { name: 'Copy to clipboard' });
    expect(item.querySelector('svg.lucide-copy')).not.toBeNull();
    expect(within(data()).getAllByRole('menuitem')[0]).toBe(item);
  });

  test('choosing it copies the loaded rows as TSV with a header row and says how many', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const loaded = within(data()).getAllByRole('row').length - 2;
    await userEvent.click(await within(data()).findByText('Export'));
    await userEvent.click(await within(data()).findByRole('menuitem', { name: 'Copy to clipboard' }));
    expect(await screen.findByText(`Copied the first ${loaded} rows. Load more to copy more.`)).toBeInTheDocument();
    const tsv = writeText.mock.calls[0]![0] as string;
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(loaded + 1);
    expect(lines[0]!.split('\t').length).toBeGreaterThan(1);
    expect(t.calls.filter((c) => /^(POST|PUT) \/api\/(reports|data-destinations)/.test(c))).toEqual([]);
  });

  test('a grid with more rows than loaded says so', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    lone([{ id: 1, note: 'a', customers__city: ['Kyiv', 'Lviv'] }, { id: 2, note: 'b\tc', customers__city: null }], true);
    await userEvent.click(await screen.findByText('Export'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy to clipboard' }));
    expect(await screen.findByText('Copied the first 2 rows. Load more to copy more.')).toBeInTheDocument();
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]).toBe('id\tNote\tCustomers · City\n1\ta\tKyiv, Lviv\n2\tb c\t');
  });

  test('one row reads "Copied 1 row"', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    lone([{ id: 1 }]);
    await userEvent.click(await screen.findByText('Export'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy to clipboard' }));
    expect(await screen.findByText('Copied 1 row')).toBeInTheDocument();
  });

  test('with no rows the item is disabled and explains why', async () => {
    lone([]);
    await userEvent.click(await screen.findByText('Export'));
    const item = await screen.findByRole('menuitem', { name: 'Copy to clipboard' });
    expect(item).toBeDisabled();
    await userEvent.hover(item.parentElement!);
    expect(await screen.findAllByText('No rows to copy')).not.toHaveLength(0);
  });

  test('when neither way of copying works the data opens in a "Copy the data" dialog, read-only and selected on focus', async () => {
    setClipboard(undefined);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    lone([{ id: 1, note: 'a' }]);
    await userEvent.click(await screen.findByText('Export'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy to clipboard' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy the data' });
    const area = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    expect(area).toHaveAttribute('readonly');
    expect(area.value).toBe('id\tNote\tCustomers · City\n1\ta\t');
    area.blur();
    area.focus();
    expect(area.selectionEnd).toBe(area.value.length);
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copy the data' })).toBeNull());
  });

  test('the arrow keys walk past it like any first-level item', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const item = await within(data()).findByRole('menuitem', { name: 'Copy to clipboard' });
    item.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(data()).getByRole('menuitem', { name: /Team Sheets/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(within(data()).getByRole('menuitem', { name: 'ChatGPT' })).toHaveFocus();
  });

  test('a destination still opens its own flyout with the copy group above it', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const fin = await within(data()).findByRole('menuitem', { name: /Finance Sheets/ });
    fin.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(await within(data()).findByRole('menu', { name: 'Finance Sheets' })).toBeInTheDocument();
  });
});
