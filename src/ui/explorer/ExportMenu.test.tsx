import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, type StoredReport } from '../../api/exports';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { TooltipProvider } from '../Tooltip';
import type { Schema } from '../../model/types';
import type { Row } from '../../sdk/types';
import { ExportMenu } from './ExportMenu';
import type { GridRun } from './useMartRows';

type Call = string;

function setup(sheets: 0 | 1 | 2, remembered: StoredReport[] = [], runMs?: number) {
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
type T = ReturnType<typeof setup>;
const data = () => document.getElementById('band-data')!;
/** A report OWOX has: the mock numbers them mock-report-1, 2, ... in the order they are made. */
const makeReport = (t: T, title: string, destination = 'd-sheets-team', spreadsheetId = 'mock-sheet-1') =>
  t.ctx.owox.postJson('/api/reports', { title, dataMartId: 'orders', dataDestinationAccess: { id: destination }, destinationConfig: { spreadsheetId, sheetId: 0 } });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
/** Export, then the destination: its dialog opens. */
const openDialog = async (destination: RegExp | string = /Team Sheets/, name = 'Export to Team Sheets') => {
  await userEvent.click(await within(data()).findByText('Export'));
  await userEvent.click(await within(data()).findByRole('menuitem', { name: destination }));
  return screen.findByRole('dialog', { name });
};
/** The dialog with its default choice (a new spreadsheet), exported. */
const exportNew = async () => {
  const dialog = await openDialog();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  return dialog;
};
const rowsLoaded = () => waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
const REPORT: StoredReport = { reportId: 'mock-report-1' };

test('with no Google Sheets destination Export is still a menu: the assistants, one separator, then the copy items', async () => {
  const t = setup(0);
  t.view();
  await rowsLoaded();
  await userEvent.click(await within(data()).findByText('Export'));
  expect(within(data()).getAllByRole('menuitem').filter((r) => !r.hasAttribute('data-link')).map((r) => r.textContent)).toEqual(['Claude', 'ChatGPT', 'Copy to clipboard', 'Copy SQL']);
  expect(within(data()).getAllByRole('separator')).toHaveLength(1);
  // no "AI" sub-header
  expect(within(data()).queryByText('AI')).toBeNull();
  expect(within(data()).getByRole('menuitem', { name: 'Claude' }).closest('.dm-export-ai')).not.toBeNull();
  expect(data().querySelector('[data-action="copy"] svg')).toHaveClass('lucide-copy');
});

test('one destination and no report: the destination opens the dialog; Export makes the spreadsheet, the report, runs it and opens the sheet', async () => {
  const t = setup(1);
  t.view();
  await rowsLoaded();
  await exportNew();
  await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 5000 });
  const writes = t.calls.filter((c) => /^(POST|PUT) \/api\/(reports|data-destinations)/.test(c));
  expect(writes).toEqual(['POST /api/data-destinations/d-sheets-team/google-sheets/documents', 'POST /api/reports', 'POST /api/reports/mock-report-1/run']);
  const outcome = await screen.findByText(/Exported to "Orders · Data Explorer · /);
  expect(screen.getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
  // The outcome is a persistent toast with a Dismiss button, not text in the Data band's title row.
  const toast = outcome.closest('#dm-toast-stack > div') as HTMLElement;
  expect(data().contains(toast)).toBe(false);
  expect(toast).toHaveAttribute('data-tone', 'success');
  expect(within(data()).queryByText(/Exported to/)).toBeNull();
  await userEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText(/Exported to "Orders/)).toBeNull();
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

describe('the menu', () => {
  test('order: Claude, ChatGPT, a separator, one row per destination, a separator, Copy to clipboard, Copy SQL; no chevron, no flyout', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const rows = (await within(data()).findAllByRole('menuitem')).filter((r) => !r.hasAttribute('data-link'));
    expect(rows.map((r) => r.textContent)).toEqual(['Claude', 'ChatGPT', 'Team Sheets', 'Finance Sheets', 'Copy to clipboard', 'Copy SQL']);
    for (const r of rows.slice(2, 4)) { expect(r.querySelector('svg[viewBox="0 0 48 48"]')).not.toBeNull(); expect(r.querySelectorAll('svg')).toHaveLength(1); expect(r).not.toHaveAttribute('aria-haspopup'); }
    expect(within(data()).queryByText('Google Sheets')).toBeNull();
    expect(within(data()).queryByText(/Looker/)).toBeNull();
    // The separators sit between the groups.
    const menu = within(data()).getByRole('menu');
    expect([...menu.children].map((c) => c.getAttribute('role') === 'separator' ? '-' : c.getAttribute('aria-label'))).toEqual(['Assistants', '-', 'Destinations', '-', 'Copy']);
    // Hovering a destination opens nothing.
    await userEvent.hover(rows[2]!);
    expect(within(data()).queryByRole('menu', { name: 'Team Sheets' })).toBeNull();
    // the Export button itself has no Sheets icon
    expect((await within(data()).findByText('Export')).closest('summary')!.querySelector('svg[viewBox="0 0 48 48"]')).toBeNull();
  });

  test('a destination closes the menu and opens its dialog, titled with the destination', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog(/Finance Sheets/, 'Export to Finance Sheets');
    expect(within(dialog).getByRole('heading', { name: 'Export to Finance Sheets' })).toBeInTheDocument();
    expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
  });

  test('keyboard: arrows walk the rows, Enter and Space on a destination open its dialog', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const team = await within(data()).findByRole('menuitem', { name: /Team Sheets/ });
    team.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(data()).getByRole('menuitem', { name: /Finance Sheets/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(within(data()).getByRole('menuitem', { name: 'ChatGPT' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(team).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Export to Team Sheets' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(await within(data()).findByText('Export'));
    const finance = await within(data()).findByRole('menuitem', { name: /Finance Sheets/ });
    finance.focus();
    await userEvent.keyboard(' ');
    await screen.findByRole('dialog', { name: 'Export to Finance Sheets' });
  });

  test('on the Export button, ArrowDown or Enter focuses the first row and Escape closes the menu', async () => {
    const t = setup(2);
    t.view();
    await rowsLoaded();
    const summary = (await within(data()).findByText('Export')).closest('summary')!;
    summary.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.querySelector('details.dm-export')).toHaveAttribute('open');
    expect(within(data()).getByRole('menuitem', { name: 'Claude' })).toHaveFocus();
    summary.focus();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
    summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(within(data()).getByRole('menuitem', { name: 'Claude' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('details.dm-export')).not.toHaveAttribute('open');
  });

  test('a press outside the menu closes it; a press inside does not', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const details = document.querySelector('details.dm-export')!;
    await userEvent.click(await within(data()).findByText('Export'));
    expect(details).toHaveAttribute('open');
    fireEvent.pointerDown(within(data()).getByRole('menuitem', { name: 'Claude' }));
    expect(details).toHaveAttribute('open');
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
  });

  test('the window losing focus (a click in the host page) closes it', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const details = document.querySelector('details.dm-export')!;
    await userEvent.click(await within(data()).findByText('Export'));
    expect(details).toHaveAttribute('open');
    fireEvent.blur(window);
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
  });

  test('the outside-press and blur handlers that were added are removed when the menu unmounts', async () => {
    const docAdd = vi.spyOn(document, 'addEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const t = setup(1);
    const view = t.view();
    await rowsLoaded();
    const press = docAdd.mock.calls.find(([type]) => type === 'pointerdown')!;
    const blur = winAdd.mock.calls.find(([type]) => type === 'blur')!;
    expect(press[2]).toBe(true);
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    view.unmount();
    expect(docRemove.mock.calls.some(([type, fn, opt]) => type === 'pointerdown' && fn === press[1] && opt === true)).toBe(true);
    expect(winRemove.mock.calls.some(([type, fn]) => type === 'blur' && fn === blur[1])).toBe(true);
    [docAdd, winAdd, docRemove, winRemove].forEach((s) => s.mockRestore());
  });
});

describe('the export dialog', () => {
  const radios = (dialog: HTMLElement) => within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'dm-export-target');
  const labelOf = (r: HTMLElement) => r.closest('label')!.textContent;

  test('without a recent report: New spreadsheet, Existing spreadsheet, Update existing report, the first chosen, with a title field', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    expect(radios(dialog).map(labelOf)).toEqual(['New spreadsheet', 'Existing spreadsheet', 'Update existing report']);
    expect(radios(dialog)[0]).toBeChecked();
    expect((within(dialog).getByLabelText('Report title') as HTMLInputElement).value).toMatch(/^Orders · Data Explorer · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(within(dialog).queryByLabelText('Spreadsheet link')).toBeNull();
  });

  test('the title field shows for options 1 and 2, the link for option 2, and neither for option 3', async () => {
    const t = setup(1, [REPORT]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
    expect(within(dialog).getByLabelText('Report title')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Spreadsheet link')).toBeInTheDocument();
    expect(within(dialog).getByText(/Share it with the destination’s account as Editor/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Update existing report'));
    expect(within(dialog).queryByLabelText('Report title')).toBeNull();
    expect(within(dialog).queryByLabelText('Spreadsheet link')).toBeNull();
    expect(await within(dialog).findByLabelText(/Orders weekly/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('New spreadsheet'));
    expect(within(dialog).getByLabelText('Report title')).toBeInTheDocument();
  });

  test('a bad link is refused, a good one is used without creating a spreadsheet', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Paste the link/);
    await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/mine/edit#gid=5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mine/edit#gid=5'), { timeout: 5000 });
    expect(t.calls.some((c) => c.includes('google-sheets/documents'))).toBe(false);
  });

  test('an empty title is refused for a new spreadsheet', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await userEvent.clear(within(dialog).getByLabelText('Report title'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the report a title.');
  });

  test('a recently used report puts Update existing report first, chosen, with the report preselected and a Recently used badge on it alone', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(3) }, { reportId: 'mock-report-2', usedAt: daysAgo(1) }, { reportId: 'mock-report-3', usedAt: daysAgo(20) }, { reportId: 'mock-report-4' }]);
    await t.seeded;
    await makeReport(t, 'Older');
    await makeReport(t, 'Newest');
    await makeReport(t, 'Oldest recent');
    await makeReport(t, 'Never used');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    expect(radios(dialog).map(labelOf)).toEqual(['Update existing report', 'New spreadsheet', 'Existing spreadsheet']);
    await waitFor(() => expect(within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'dm-export-report')).toHaveLength(4));
    const reports = within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'dm-export-report');
    // Most recent first, never used last.
    expect(reports.map((r) => r.closest('label')!.textContent)).toEqual(['NewestRecently used', 'Older', 'Oldest recent', 'Never used']);
    expect(radios(dialog)[0]).toBeChecked();
    expect(reports[0]).toBeChecked();
    expect(within(dialog).getAllByText('Recently used')).toHaveLength(1);
    expect(within(dialog).queryByLabelText('Report title')).toBeNull();
  });

  test('exporting the preselected report updates it: PUT, run, the sheet opens, and usedAt is stored', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(2) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText(/Orders weekly/)).toBeChecked());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(t.open).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0'), { timeout: 5000 });
    expect(t.calls.filter((c) => /^(PUT|POST \/api\/reports\/)/.test(c))).toEqual(['PUT /api/reports/mock-report-1', 'POST /api/reports/mock-report-1/run']);
    const doc = (await t.ctx.collections<{ reports: StoredReport[] }>('exports').get('orders'))!.document.reports;
    expect(doc).toHaveLength(1);
    expect(Date.now() - Date.parse(doc[0]!.usedAt!)).toBeLessThan(60_000);
  });

  test('a report made by an export is offered, chosen and marked recent in the next dialog', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await exportNew();
    await waitFor(() => expect(t.open).toHaveBeenCalled(), { timeout: 5000 });
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('radio', { name: /Orders · Data Explorer · .*Recently used/ })).toBeChecked();
    expect(radios(dialog)[0]).toBeChecked();
  });

  test('a usedAt in the future is not recent', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(-3) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    expect(radios(dialog).map(labelOf)[0]).toBe('New spreadsheet');
  });

  test('when the remembered document is already known the first paint has the final order', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    // The first live read means the document has been read.
    await waitFor(() => expect(t.calls).toContain('GET /api/reports/mock-report-1'));
    await userEvent.click(within(data()).getByRole('menuitem', { name: /Team Sheets/ }));
    const dialog = screen.getByRole('dialog', { name: 'Export to Team Sheets' });
    expect(radios(dialog).map(labelOf)).toEqual(['Update existing report', 'New spreadsheet', 'Existing spreadsheet']);
    expect(radios(dialog)[0]).toBeChecked();
  });

  test('an export started from the untouched dialog does not move it: same option, order and title field while it runs', async () => {
    const t = setup(1);
    const real = t.ctx.owox.postJson;
    (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => (path.endsWith('/run') ? (t.calls.push(`POST ${path}`), new Promise(() => {})) : real(path, body))) as Ctx['owox']['postJson'];
    t.view();
    await rowsLoaded();
    const dialog = await exportNew();
    await waitFor(() => expect(t.calls).toContain('POST /api/reports/mock-report-1/run'));
    await new Promise((r) => setTimeout(r, 100));
    expect(radios(dialog).map(labelOf)).toEqual(['New spreadsheet', 'Existing spreadsheet', 'Update existing report']);
    expect(radios(dialog)[0]).toBeChecked();
    expect(within(dialog).getByLabelText('Report title')).toBeInTheDocument();
  });

  test('focus: the checked radio takes it on open, Tab stays inside, and Escape returns it to the Export button', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(radios(dialog)[0]).toHaveFocus());
    // Native tabbing: the three radios are one stop, so the cycle is radio, Cancel, Export, title, radio.
    const stop = async () => { await userEvent.tab(); return document.activeElement; };
    expect(await stop()).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await stop()).toBe(within(dialog).getByRole('button', { name: 'Export' }));
    expect(await stop()).toBe(within(dialog).getByLabelText('Report title'));
    expect(await stop()).toBe(radios(dialog)[0]);
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('details.dm-export summary')).toHaveFocus();
  });

  test('Cancel returns focus to the Export button too', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('details.dm-export summary')).toHaveFocus();
  });

  test.each([[59, true], [61, false]])('the 60 day boundary: used %i days ago, recent is %s', async (days, recent) => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(days) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    expect(radios(dialog).map(labelOf)[0]).toBe(recent ? 'Update existing report' : 'New spreadsheet');
    if (recent) expect(await within(dialog).findAllByText('Recently used')).toHaveLength(1);
    else expect(within(dialog).queryAllByText('Recently used')).toHaveLength(0);
  });

  test('reports of another destination are not listed, and a recent one there moves option 3 back to last when the reads finish', async () => {
    const t = setup(2, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }, { reportId: 'mock-report-2', usedAt: daysAgo(70) }]);
    await t.seeded;
    await makeReport(t, 'On finance', 'd-sheets-finance');
    await makeReport(t, 'On team');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    // The recent report is on the other destination, so this one ends up with a new spreadsheet.
    await waitFor(() => expect(radios(dialog).map(labelOf)).toEqual(['New spreadsheet', 'Existing spreadsheet', 'Update existing report']));
    expect(radios(dialog)[0]).toBeChecked();
    await userEvent.click(within(dialog).getByLabelText('Update existing report'));
    expect(await within(dialog).findByLabelText(/On team/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/On finance/)).toBeNull();
    // Its report is not marked recent: it is only the recent one that gets the badge.
    expect(within(dialog).queryByText('Recently used')).toBeNull();
  });

  test.each([
    [false, ['New spreadsheet', 'Existing spreadsheet', 'Update existing report'], [true, false, false]],
    [true, ['Update existing report', 'New spreadsheet', 'Existing spreadsheet'], [false, false, true]],
  ])('option 3 starts first and chosen before the reads return, then the recent report turns out to be elsewhere; member touched it: %s', async (touch, labels, checked) => {
    const t = setup(2, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'On finance', 'd-sheets-finance');
    const real = t.ctx.owox.getJson;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    t.view();
    await rowsLoaded();
    (t.ctx.owox as { getJson: Ctx['owox']['getJson'] }).getJson = (async (path: string, q?: Record<string, string>) => {
      if (path === '/api/reports/mock-report-1') await gate;
      return real(path, q);
    }) as Ctx['owox']['getJson'];
    const dialog = await openDialog();
    await waitFor(() => expect(radios(dialog).map(labelOf)[0]).toBe('Update existing report'));
    expect(radios(dialog)[0]).toBeChecked();
    // Touching means clicking any radio; the member here picks Existing spreadsheet.
    if (touch) await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
    act(() => release());
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    await waitFor(() => expect(radios(dialog).map(labelOf)).toEqual(labels));
    expect(radios(dialog).map((r) => (r as HTMLInputElement).checked)).toEqual(checked);
  });

  test('while the reads are pending option 3 shows a skeleton with "Loading reports…" and nothing to choose; each report appears as its own read returns', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }, { reportId: 'mock-report-2', usedAt: daysAgo(2) }]);
    await t.seeded;
    await makeReport(t, 'First');
    await makeReport(t, 'Second');
    t.view();
    await rowsLoaded();
    const real = t.ctx.owox.getJson;
    const gates: Record<string, () => void> = {};
    (t.ctx.owox as { getJson: Ctx['owox']['getJson'] }).getJson = (async (path: string, q?: Record<string, string>) => {
      if (/^\/api\/reports\/mock-report-[12]$/.test(path)) await new Promise<void>((r) => { gates[path] = r; });
      return real(path, q);
    }) as Ctx['owox']['getJson'];
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Loading reports…')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'dm-export-report')).toHaveLength(0);
    // Exporting with nothing to choose says so and sends nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick a report to update.');
    expect(t.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    await waitFor(() => expect(Object.keys(gates)).toHaveLength(2));
    act(() => gates['/api/reports/mock-report-2']!());
    expect(await within(dialog).findByLabelText(/Second/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/First/)).toBeNull();
    expect(within(dialog).getByText('Loading reports…')).toBeInTheDocument();
    act(() => gates['/api/reports/mock-report-1']!());
    expect(await within(dialog).findByLabelText(/First/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
  });

  test('a failed read shows "Couldn’t load" with Retry, which reads that report again', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const real = t.ctx.owox.getJson;
    let fail = true;
    (t.ctx.owox as { getJson: Ctx['owox']['getJson'] }).getJson = (async (path: string, q?: Record<string, string>) => {
      if (path === '/api/reports/mock-report-1' && fail) throw new Error('network down');
      return real(path, q);
    }) as Ctx['owox']['getJson'];
    const dialog = await openDialog();
    // A failed read counts as finished and not here: the dialog falls back to a new spreadsheet, and the failed row waits in option 3.
    await waitFor(() => expect(radios(dialog)[0]).toBeChecked());
    await waitFor(() => expect(radios(dialog).map(labelOf)[0]).toBe('New spreadsheet'));
    await userEvent.click(within(dialog).getByLabelText('Update existing report'));
    expect(await within(dialog).findByText('Couldn’t load')).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByLabelText(/Orders weekly/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Couldn’t load')).toBeNull();
  });

  test('a report OWOX no longer has (404) is dropped from the list and the stored document', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }, { reportId: 'mock-report-2', usedAt: daysAgo(2) }]);
    await t.seeded;
    await makeReport(t, 'Still here');
    t.view();
    await rowsLoaded();
    // mock-report-2 does not exist.
    const dialog = await openDialog();
    expect(await within(dialog).findByLabelText(/Still here/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    await waitFor(async () => expect((await t.ctx.collections<{ reports: StoredReport[] }>('exports').get('orders'))?.document.reports.map((r) => r.reportId)).toEqual(['mock-report-1']));
  });

  test('when the only remembered report is gone the dialog stops loading and option 3 says there is nothing to update', async () => {
    const t = setup(1, [REPORT]);
    await t.seeded;
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    expect(radios(dialog)[0]).toBeChecked();
    expect(radios(dialog)[2]).toBeDisabled();
    await waitFor(async () => expect((await t.ctx.collections<{ reports: StoredReport[] }>('exports').get('orders'))?.document.reports).toEqual([]));
  });

  test('a stored read that works while the live load failed still ends: the reads are started again', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    const col = t.ctx.collections<{ reports: StoredReport[] }>('exports');
    const realGet = col.get.bind(col);
    let first = true;
    // The first document read (the one the live load makes) fails; the next ones work.
    // Only the exports collection is wrapped, and only until the test ends.
    const realCollections = t.ctx.collections;
    const spy = vi.spyOn(t.ctx, 'collections').mockImplementation(((name: string) => (name === 'exports' ? { ...col, get: async (id: string) => { if (first) { first = false; throw new Error('storage hiccup'); } return realGet(id); } } : realCollections(name))) as never);
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    expect(await within(dialog).findByLabelText(/Orders weekly/, undefined, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Loading reports…')).toBeNull());
    spy.mockRestore();
  });

  test('the live reads start on the first opening of the menu, run once, and are not repeated by later openings', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(100) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    expect(t.calls.filter((c) => c === 'GET /api/reports/mock-report-1')).toHaveLength(0);
    const summary = (await within(data()).findByText('Export')).closest('summary')!;
    await userEvent.click(summary);
    await waitFor(() => expect(t.calls.filter((c) => c === 'GET /api/reports/mock-report-1')).toHaveLength(1));
    await userEvent.click(summary);
    await userEvent.click(summary);
    await userEvent.click(within(data()).getByRole('menuitem', { name: /Team Sheets/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Export to Team Sheets' });
    await within(dialog).findByLabelText('Update existing report');
    expect(t.calls.filter((c) => c === 'GET /api/reports/mock-report-1')).toHaveLength(1);
  });

  test('a report with an unrecognised spreadsheet is listed but disabled, and cannot be updated', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'Odd one', 'd-sheets-team', '../../url?q=https://evil.example');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByLabelText('Update existing report'));
    const row = await within(dialog).findByLabelText(/Odd one/);
    expect(row).toBeDisabled();
    expect(within(dialog).getByText('Unrecognised spreadsheet')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick a report to update.');
    expect(t.open).not.toHaveBeenCalled();
    expect(t.calls.some((c) => c.startsWith('PUT'))).toBe(false);
  });

  test('updating a report OWOX no longer has shows the error toast, drops the report and leaves the dialog open', async () => {
    const t = setup(1, [{ reportId: 'mock-report-1', usedAt: daysAgo(1) }]);
    await t.seeded;
    await makeReport(t, 'Orders weekly');
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText(/Orders weekly/)).toBeChecked());
    const realPut = t.ctx.owox.putJson;
    (t.ctx.owox as { putJson: Ctx['owox']['putJson'] }).putJson = (async () => { throw Object.assign(new Error('Not found'), { payload: { status: 404 } }); }) as Ctx['owox']['putJson'];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    const toast = (await screen.findByText('This report no longer exists in OWOX')).closest('[data-tone]');
    expect(toast).toHaveAttribute('data-tone', 'error');
    expect(screen.getByRole('dialog', { name: 'Export to Team Sheets' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByLabelText(/Orders weekly/)).toBeNull());
    await waitFor(async () => expect((await t.ctx.collections<{ reports: StoredReport[] }>('exports').get('orders'))?.document.reports).toEqual([]));
    (t.ctx.owox as { putJson: Ctx['owox']['putJson'] }).putJson = realPut;
  });

  test('a run that outlasts the wait is an info toast, "Still running"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = setup(1, [], 10 * 60_000);
      t.view();
      await rowsLoaded();
      await exportNew();
      await waitFor(() => expect(t.calls).toContain('POST /api/reports/mock-report-1/run'));
      await act(async () => { await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 3 * POLL_INTERVAL_MS); });
      await waitFor(() => expect(document.querySelector('[data-tone="info"]')).toHaveTextContent(/Still running/));
    } finally { vi.useRealTimers(); }
  });

  test('a failed run is an error toast', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    const real = t.ctx.owox.postJson;
    (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => (path.endsWith('/run') ? Promise.reject(new Error('run refused')) : real(path, body))) as Ctx['owox']['postJson'];
    await exportNew();
    const toast = (await screen.findByText(/The run could not be followed: run refused/)).closest('[data-tone]');
    expect(toast).toHaveAttribute('data-tone', 'error');
  });

  test('Enter in the title exports, and does nothing while an export is running', async () => {
    const t = setup(1, [REPORT]);
    await t.seeded;
    t.view();
    await rowsLoaded();
    const dialog = await openDialog();
    const title = within(dialog).getByLabelText('Report title');
    await userEvent.type(title, '{Enter}');
    await waitFor(() => expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1), { timeout: 5000 });
    await userEvent.type(title, '{Enter}');
    await new Promise((r) => setTimeout(r, 200));
    expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1);
  });
});

test('when the spreadsheet cannot be created the dialog opens with the message', async () => {
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

test('a failure after the report exists closes the dialog and reports in a toast, so a retry cannot make a second report', async () => {
  const t = setup(1, [REPORT]);
  await t.seeded;
  t.view();
  await rowsLoaded();
  const real = t.ctx.owox.postJson;
  (t.ctx.owox as { postJson: Ctx['owox']['postJson'] }).postJson = ((path: string, body: unknown) => (path.endsWith('/run') ? Promise.reject(new Error('run refused')) : real(path, body))) as Ctx['owox']['postJson'];
  const dialog = await openDialog();
  await userEvent.click(within(dialog).getByLabelText('Existing spreadsheet'));
  await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/published-to-web/);
  await userEvent.clear(within(dialog).getByLabelText('Spreadsheet link'));
  await userEvent.type(within(dialog).getByLabelText('Spreadsheet link'), 'https://docs.google.com/spreadsheets/d/mine/edit');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText(/The run could not be followed: run refused/)).toBeInTheDocument();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
});

const martCard = (title: string) => within(document.getElementById('band-marts')!).getByText(title).closest('article')!;
const headingText = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!).join(' + ');
/** A mart the main one can join is added to its grid first, so clicking the main card then promotes it; one it cannot join is reached through the search. */
const toMart = async (title: string) => {
  const main = headingText()!;
  const card = within(document.getElementById('band-marts')!).queryByText(title)?.closest('article');
  if (!card || card.classList.contains('dm-unjoinable')) {
    if (!screen.queryByRole('textbox', { name: 'Search data marts' })) await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search data marts' }), `${title}{Enter}`);
    await waitFor(() => expect(headingText() === title || headingText()!.startsWith(`${title} + `)).toBe(true));
    return;
  }
  fireEvent.click(martCard(title));
  // A mart that comes back as main shows the joined marts it was left with.
  const mainNow = () => headingText() === title || headingText()!.startsWith(`${title} + `);
  await waitFor(() => expect(mainNow() || headingText() === `${main} + ${title}`).toBe(true));
  if (!mainNow()) fireEvent.click(martCard(main));
  await waitFor(() => expect(mainNow()).toBe(true));
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
  expect(await screen.findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
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
  expect(await screen.findByText(/Exported to "Orders · Data Explorer · /)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-sheet-1/edit#gid=0');
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
  const dialog = await openDialog();
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
  expect(await screen.findByText('The report may have been created; check OWOX before trying again.')).toBeInTheDocument();
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
});

test('a timeout on the report step closes the dialog and warns that the report may exist, with no retry', async () => {
  const { t } = await newReportFailing(() => Object.assign(new Error('Request timed out'), { payload: { code: 'TIMEOUT' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('The report may have been created; check OWOX before trying again.')).toBeInTheDocument();
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toHaveLength(1);
  expect(t.calls.filter((c) => c === 'POST /api/reports')).toHaveLength(1);
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
  const openNew = async (dest: 'Team Sheets' | 'Finance Sheets') => {
    const dialog = await openDialog(new RegExp(dest), `Export to ${dest}`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    return dialog;
  };
  const dialog = await openNew('Team Sheets');
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('report refused'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await openNew('Finance Sheets');
  await waitFor(() => expect(t.open).toHaveBeenCalled(), { timeout: 6000 });
  expect(t.calls.filter((c) => c.includes('google-sheets/documents'))).toEqual([
    'POST /api/data-destinations/d-sheets-team/google-sheets/documents',
    'POST /api/data-destinations/d-sheets-finance/google-sheets/documents',
  ]);
}, 15000);

describe('the AI group', () => {
  const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  afterEach(() => { setClipboard(undefined); Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined }); });

  test('Claude and ChatGPT come first, each under its own icon', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const items = (await within(data()).findAllByRole('menuitem')).filter((r) => !r.hasAttribute('data-link'));
    expect(items.map((i) => i.textContent)).toEqual(['Claude', 'ChatGPT', 'Team Sheets', 'Copy to clipboard', 'Copy SQL']);
    expect(items[0]!.querySelector('svg path[fill="#D97757"]')).not.toBeNull();
    expect(items[1]!.querySelector('svg')).not.toBeNull();
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
    const toast = screen.getByText('Prompt copied. Paste it into Claude').closest('#dm-toast-stack > div') as HTMLElement;
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

  test('it follows the destinations, with the copy icon, and Copy SQL comes right after it', async () => {
    const t = setup(1);
    t.view();
    await rowsLoaded();
    await userEvent.click(await within(data()).findByText('Export'));
    const item = await within(data()).findByRole('menuitem', { name: 'Copy to clipboard' });
    expect(item.querySelector('svg.lucide-copy')).not.toBeNull();
    const all = within(data()).getAllByRole('menuitem').filter((r) => !r.hasAttribute('data-link'));
    expect(all.slice(-2).map((r) => r.textContent)).toEqual(['Copy to clipboard', 'Copy SQL']);
    expect(item.closest('[role="group"]')!.previousElementSibling).toHaveAttribute('role', 'separator');
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
    // Copy SQL is the last stop once OWOX has the grid's SQL; ArrowUp from the first row wraps to it.
    await waitFor(() => expect(within(data()).getByRole('menuitem', { name: 'Copy SQL' })).toBeEnabled());
    item.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(data()).getByRole('menuitem', { name: 'Copy SQL' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(data()).getByRole('menuitem', { name: 'Claude' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(within(data()).getByRole('menuitem', { name: 'Copy SQL' })).toHaveFocus();
  });

  describe('the toast timer never closes a dialog', () => {
    const rows: Row[] = [{ id: 1, note: 'a', customers__city: 'x' }];
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });
    const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    test('"Show prompt" stays open past the six seconds, and the toast stays while its dialog is open', async () => {
      setClipboard(vi.fn().mockResolvedValue(undefined));
      lone(rows);
      const u = user();
      await u.click(await screen.findByText('Export'));
      await u.click(await screen.findByRole('menuitem', { name: 'Claude' }));
      const show = await screen.findByRole('button', { name: 'Show prompt' });
      await u.click(show);
      await screen.findByRole('dialog', { name: 'Prompt' });
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.getByRole('dialog', { name: 'Prompt' })).toBeInTheDocument();
      expect(screen.getByText('Prompt copied. Paste it into Claude')).toBeInTheDocument();
      // Closed, the toast runs out its time and only then goes.
      await u.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Prompt' })).toBeNull());
      // The pointer left the toast (hover holds it too).
      await u.unhover(show);
      act(() => { vi.advanceTimersByTime(6100); });
      expect(screen.queryByText('Prompt copied. Paste it into Claude')).toBeNull();
    });

    test('with a blocked clipboard the manual-copy dialog stays open until it is closed', async () => {
      Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
      lone(rows);
      const u = user();
      // userEvent.setup() installs its own clipboard stub; the blocked one goes in after it.
      setClipboard(undefined);
      await u.click(await screen.findByText('Export'));
      await u.click(await screen.findByRole('menuitem', { name: 'Copy to clipboard' }));
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'Copy the data' })).toBeInTheDocument());
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.getByRole('dialog', { name: 'Copy the data' })).toBeInTheDocument();
      expect(screen.getByText('Could not copy. Copy the data by hand')).toBeInTheDocument();
    });
  });
});

describe('Copy SQL', () => {
  const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  afterEach(() => { delete (navigator as { clipboard?: unknown }).clipboard; });
  const ORDERS: Schema = [{ name: 'id', type: 'INTEGER', category: 'number' }] as Schema;
  const lone = (run: GridRun | undefined, getJson?: (path: string) => Promise<unknown>) => {
    const ctx = createMockCtx(demoFixtures({ sheets: 0 }), { latencyMs: 0 });
    const real = ctx.owox.getJson.bind(ctx.owox);
    const c = getJson ? { ...ctx, owox: { ...ctx.owox, getJson: ((p: string, q?: Record<string, string>) => (p.includes('/runs/') ? getJson(p) : real(p, q))) as typeof ctx.owox.getJson } } : ctx;
    const tree = (r: GridRun | undefined) => <AppServices ctx={c}><TooltipProvider><StoreProvider><ExportMenu martId="orders" martTitle="Orders" schema={ORDERS} visible={['id']} filters={[]} sorts={[]} rows={[{ id: 1 }]} hasMore={false} run={r} /></StoreProvider></TooltipProvider></AppServices>;
    const view = render(tree(run));
    return { view, rerun: (r: GridRun) => view.rerender(tree(r)) };
  };
  const sqlItem = () => screen.findByRole('menuitem', { name: 'Copy SQL' });

  test('it is the last item, right after Copy to clipboard', async () => {
    lone(undefined);
    await userEvent.click(await screen.findByText('Export'));
    const items = screen.getAllByRole('menuitem').filter((r) => !r.hasAttribute('data-link'));
    expect(items.at(-1)).toHaveTextContent('Copy SQL');
    expect(items.at(-2)).toHaveTextContent('Copy to clipboard');
  });

  test.each([
    [undefined, 'The grid has not run a query yet'],
    [{ state: 'paused' } as GridRun, 'Switch to Table to copy its SQL'],
    [{ state: 'running' } as GridRun, "The grid's query is still running"],
    [{ state: 'failed' } as GridRun, "The grid's query failed"],
    [{ state: 'done', runId: null } as GridRun, 'OWOX did not report a run for this query'],
  ])('disabled with the reason: %j', async (run, reason) => {
    lone(run);
    await userEvent.click(await screen.findByText('Export'));
    const item = await sqlItem();
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('data-reason', reason);
  });

  test('reads the run when the menu opens, then copies the SQL and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const get = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } } }));
    lone({ state: 'done', runId: 'r1' }, get);
    await userEvent.click(await screen.findByText('Export'));
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    expect(get).toHaveBeenCalledWith('/api/data-marts/orders/runs/r1');
    await userEvent.click(await sqlItem());
    expect(writeText).toHaveBeenCalledWith('SELECT 1');
    expect(await screen.findByText('SQL copied. It is the query the grid ran, with its page LIMIT.')).toBeInTheDocument();
  });

  test('a run with no SQL leaves it disabled with the reason', async () => {
    lone({ state: 'done', runId: 'r1' }, async () => ({ additionalParams: { httpData: {} } }));
    await userEvent.click(await screen.findByText('Export'));
    await waitFor(async () => expect(await sqlItem()).toHaveAttribute('data-reason', 'OWOX did not record the SQL of this query'));
  });

  test('a query that ends while the menu is open enables it without reopening', async () => {
    const get = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 3' } } }));
    const { rerun } = lone({ state: 'running' }, get);
    await userEvent.click(await screen.findByText('Export'));
    expect(await sqlItem()).toHaveAttribute('data-reason', "The grid's query is still running");
    rerun({ state: 'done', runId: 'r1' });
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    expect(document.querySelector('details.dm-export')).toHaveAttribute('open');
  });

  test('reads that resolve out of order never hide the newer run', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const get = async (path: string) => {
      if (path.endsWith('/r1')) { await slow; return { additionalParams: { httpData: { executionSqlQuery: 'SELECT old' } } }; }
      return { additionalParams: { httpData: { executionSqlQuery: 'SELECT new' } } };
    };
    const { rerun } = lone({ state: 'done', runId: 'r1' }, get);
    await userEvent.click(await screen.findByText('Export'));
    rerun({ state: 'done', runId: 'r2' });
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(await sqlItem()).toBeEnabled();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await userEvent.click(await sqlItem());
    expect(writeText).toHaveBeenCalledWith('SELECT new');
  });

  test('a read that fails says so, is tried again on the next opening and then enables the item', async () => {
    let calls = 0;
    const get = async () => { calls += 1; if (calls === 1) throw new Error('boom'); return { additionalParams: { httpData: { executionSqlQuery: 'SELECT 2' } } }; };
    lone({ state: 'done', runId: 'r1' }, get);
    const summary = (await screen.findByText('Export')).closest('summary')!;
    await userEvent.click(summary);
    await waitFor(async () => expect(await sqlItem()).toHaveAttribute('data-reason', 'The SQL could not be read from OWOX'));
    await userEvent.click(summary);
    await userEvent.click(summary);
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    expect(calls).toBe(2);
  });

  // Two reads of one run from two openings of the menu, each settled by the test.
  const twoOpenings = async (): Promise<{ settle: (n: 0 | 1, how: 'ok' | 'fail') => void; summary: HTMLElement }> => {
    const gates: ((how: 'ok' | 'fail') => void)[] = [];
    let n = 0;
    const get = () => new Promise((resolve, reject) => {
      gates[n++] = (how) => (how === 'ok' ? resolve({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 9' } } }) : reject(new Error('boom')));
    });
    lone({ state: 'done', runId: 'r1' }, get);
    const summary = (await screen.findByText('Export')).closest('summary')!;
    await userEvent.click(summary);
    await waitFor(() => expect(n).toBe(1));
    await userEvent.click(summary);
    await userEvent.click(summary);
    await waitFor(() => expect(n).toBe(2));
    return { settle: (i, how) => act(() => gates[i]!(how)), summary };
  };

  test('a late failure of an older opening does not replace the reason of the newer one', async () => {
    const t = await twoOpenings();
    t.settle(1, 'fail');
    await waitFor(async () => expect(await sqlItem()).toHaveAttribute('data-reason', 'The SQL could not be read from OWOX'));
    t.settle(0, 'fail');
    await new Promise((r) => setTimeout(r, 20));
    expect(await sqlItem()).toHaveAttribute('data-reason', 'The SQL could not be read from OWOX');
  });

  test('a failure never replaces SQL that was read', async () => {
    const t = await twoOpenings();
    t.settle(0, 'ok');
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    t.settle(1, 'fail');
    await new Promise((r) => setTimeout(r, 20));
    expect(await sqlItem()).toBeEnabled();
  });

  describe('the outcome is a note like the other copy actions', () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });
    const run = (): GridRun => ({ state: 'done', runId: 'r1' });
    const get = async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } } });
    const SAID = 'SQL copied. It is the query the grid ran, with its page LIMIT.';
    const FAILED = 'Could not copy. Copy the SQL by hand';

    test('the SQL copied note goes after the six seconds', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setClipboard(vi.fn().mockResolvedValue(undefined));
      lone(run(), get);
      await u.click(await screen.findByText('Export'));
      await waitFor(async () => expect(await sqlItem()).toBeEnabled());
      await u.click(await sqlItem());
      const said = await screen.findByText(SAID);
      await u.unhover(said);
      act(() => { vi.advanceTimersByTime(6100); });
      expect(screen.queryByText(SAID)).toBeNull();
    });

    test('a failed write shows the note, and "Show SQL" reopens the dialog the toast then holds', async () => {
      Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setClipboard(undefined);
      lone(run(), get);
      await u.click(await screen.findByText('Export'));
      await waitFor(async () => expect(await sqlItem()).toBeEnabled());
      await u.click(await sqlItem());
      await screen.findByRole('dialog', { name: 'SQL' });
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.getByRole('dialog', { name: 'SQL' })).toBeInTheDocument();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      await u.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SQL' })).toBeNull());
      await u.click(await screen.findByRole('button', { name: 'Show SQL' }));
      expect(await screen.findByRole('dialog', { name: 'SQL' })).toBeInTheDocument();
    });
  });

  test('ArrowUp from the first item wraps past a disabled Copy SQL to the last enabled item', async () => {
    lone({ state: 'running' });
    await userEvent.click(await screen.findByText('Export'));
    (await screen.findByRole('menuitem', { name: 'Claude' })).focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Copy to clipboard' })).toHaveFocus();
  });
});
