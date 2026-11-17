import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { HOVER_MS } from './ColumnMenu';
import { openColumnMenu, openSubmenu } from './menu-test-utils';
import { placeBeside, placeBelow } from './menuPlacement';

function setup(project?: Record<string, unknown>) {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  if (project) void ctx.collections<Record<string, unknown>>('column-formats-project').put('orders', project);
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  return ctx;
}
const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
/** The column menu's own panels: the page has other menus. */
const open = () => screen.queryAllByRole('menu').filter((m) => m.hasAttribute('data-column-menu'));
const ready = () => waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));
const cellsOf = (column: string) => { const at = headers().findIndex((h) => h.startsWith(column)); return bodyRows().map((r) => r.querySelectorAll('td')[at]?.textContent ?? ''); };

async function showAmount() {
  await ready();
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
  await userEvent.click(await screen.findByLabelText('Amount'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(headers().some((h) => h.startsWith('Amount'))).toBe(true));
}

describe('placement', () => {
  const view = { width: 1000, height: 700 };
  const size = { width: 220, height: 200 };
  test('a menu under the rightmost column flips left and stays inside the viewport', () => {
    const p = placeBelow({ left: 960, top: 40, right: 976, bottom: 56 }, size, view);
    expect(p.side).toBe('left');
    expect(p.left + size.width).toBeLessThanOrEqual(view.width - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
  test('a menu near the bottom edge flips up', () => {
    const p = placeBelow({ left: 100, top: 660, right: 116, bottom: 676 }, size, view);
    expect(p.top + size.height).toBeLessThanOrEqual(660);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
  test('a submenu opens to the right of its row, to the left when there is no room, and is pulled up from the bottom edge', () => {
    expect(placeBeside({ left: 100, top: 100, right: 300, bottom: 132 }, size, view)).toMatchObject({ side: 'right', left: 300 });
    const left = placeBeside({ left: 700, top: 650, right: 920, bottom: 682 }, { width: 260, height: 180 }, view);
    expect(left.side).toBe('left');
    expect(left.left + 260).toBeLessThanOrEqual(700);
    expect(left.top + 180).toBeLessThanOrEqual(view.height - 8);
  });
  test('a panel taller than the viewport sits at the edge instead of outside it', () => {
    expect(placeBeside({ left: 0, top: 300, right: 100, bottom: 332 }, { width: 100, height: 900 }, view).top).toBe(8);
  });
});

describe('the column menu', () => {
  test('opens from the icon with Filter, Aggregate, Format, Sort and Hide column in that order; text columns have no Format', async () => {
    setup();
    await ready();
    const menu = await openColumnMenu(within(data()), 'status');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Filter', 'Aggregate', 'Sort', 'Hide column']);
    for (const name of ['Filter', 'Aggregate', 'Sort']) expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('aria-haspopup');
    expect(within(menu).getByRole('menuitem', { name: 'Sort' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(open()).toHaveLength(0));
  });

  test('a number column adds Format between Aggregate and Sort', async () => {
    setup();
    await showAmount();
    const menu = await openColumnMenu(within(data()), 'Amount');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Filter', 'Aggregate', 'Format', 'Sort', 'Hide column']);
  });

  test('a filter icon appears only with a filter, and opens the menu with the Filter submenu open', async () => {
    setup();
    await ready();
    expect(within(data()).queryByLabelText('Filter id')).toBeNull();
    await openSubmenu(within(data()), 'id', 'Filter');
    await userEvent.selectOptions(await screen.findByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(open()).toHaveLength(0));
    const active = await within(data()).findByLabelText('Filter id');
    expect(active).toHaveClass('dm-ctl-on');
    expect(within(data()).getByLabelText('Column menu id')).toHaveClass('dm-ctl-on');
    expect(active).toHaveTextContent('');
    await userEvent.hover(active);
    expect((await screen.findAllByText('Filter: ≤ 3')).length).toBeGreaterThan(0);
    await userEvent.click(active);
    const panel = await screen.findByRole('dialog', { name: 'Filter of id' });
    expect(within(panel).getByLabelText('Value')).toHaveValue(3);
    expect(screen.getByRole('menuitem', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'true');
    // Clear closes the whole menu and the icon goes away
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(within(data()).queryByLabelText('Filter id')).toBeNull());
    expect(within(data()).getByLabelText('Column menu id')).not.toHaveClass('dm-ctl-on');
  });

  test('Sort A → Z, Sort Z → A and Remove sort drive the sort indicator and the menu icon', async () => {
    setup();
    await ready();
    const sortRow = async (name: string) => { await openSubmenu(within(data()), 'status', 'Sort'); await userEvent.click(await screen.findByRole(name === 'Remove sort' ? 'menuitem' : 'menuitemradio', { name })); };
    expect(within(data()).getByLabelText('Column menu status')).not.toHaveClass('dm-ctl-on');
    await sortRow('Sort A → Z');
    const mark = await within(data()).findByLabelText('Sorted A to Z: status');
    expect(mark.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    expect(within(data()).getByLabelText('Column menu status')).toHaveClass('dm-ctl-on');
    expect(within(data()).getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
    await sortRow('Sort Z → A');
    expect((await within(data()).findByLabelText('Sorted Z to A: status')).querySelector('svg.lucide-arrow-down')).not.toBeNull();
    await openSubmenu(within(data()), 'status', 'Sort');
    expect(await screen.findByRole('menuitemradio', { name: 'Sort Z → A' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Escape}{Escape}');
    await sortRow('Remove sort');
    await waitFor(() => expect(within(data()).queryByLabelText(/^Sorted /)).toBeNull());
    expect(within(data()).getByLabelText('Column menu status')).not.toHaveClass('dm-ctl-on');
  });

  test('an aggregation turns the Sigma and the menu icon on; the Sigma opens the Aggregate submenu', async () => {
    setup();
    await showAmount();
    expect(within(data()).queryByLabelText('Aggregate Amount')).toBeNull();
    await openSubmenu(within(data()), 'Amount', 'Aggregate');
    const dialog = await screen.findByRole('dialog', { name: 'Aggregation of Amount' });
    await userEvent.click(within(dialog).getByLabelText('Sum'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const sigma = await within(data()).findByLabelText('Aggregate Amount');
    expect(sigma).toHaveClass('dm-ctl-on');
    expect(within(data()).getByLabelText('Column menu Amount')).toHaveClass('dm-ctl-on');
    await userEvent.click(sigma);
    expect(await screen.findByRole('dialog', { name: 'Aggregation of Amount' })).toBeInTheDocument();
  });

  test('the Format submenu changes the cell text, checks the current format, and turns the menu icon on', async () => {
    setup();
    await showAmount();
    const before = cellsOf('Amount')[0]!;
    expect(before).not.toMatch(/\$/);
    expect(within(data()).getByLabelText('Column menu Amount')).not.toHaveClass('dm-ctl-on');
    await openSubmenu(within(data()), 'Amount', 'Format');
    const formats = await screen.findByRole('menu', { name: 'Format Amount' });
    expect(within(formats).getAllByRole('menuitemradio', { hidden: false }).map((i) => i.textContent)).toEqual(['Automatic', 'Plain number', 'Percent', 'Money']);
    expect(within(formats).getByRole('menuitemradio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(formats).getByRole('menuitemradio', { name: 'Money' }));
    const money = await screen.findByRole('menu', { name: 'Money Amount' });
    expect(within(money).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['USD', 'EUR', 'GBP', 'UAH']);
    await userEvent.click(within(money).getByRole('menuitemradio', { name: 'EUR' }));
    await waitFor(() => expect(cellsOf('Amount')[0]).toMatch(/€/));
    expect(open()).toHaveLength(0);
    expect(within(data()).getByLabelText('Column menu Amount')).toHaveClass('dm-ctl-on');
    // reopened: Money and EUR are checked; Automatic puts the cells back
    await openSubmenu(within(data()), 'Amount', 'Format');
    expect(await screen.findByRole('menuitemradio', { name: 'Money' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Automatic' }));
    await waitFor(() => expect(cellsOf('Amount')[0]).toBe(before));
    expect(within(data()).getByLabelText('Column menu Amount')).not.toHaveClass('dm-ctl-on');
  });

  test('Automatic is always stored as the member\'s own auto, so a later AI pick cannot override it; an AI pick alone does not light the icon', async () => {
    const ctx = setup({ amount: { kind: 'money', currency: 'GBP' } });
    await showAmount();
    await waitFor(() => expect(cellsOf('Amount')[0]).toMatch(/£/));
    expect(within(data()).getByLabelText('Column menu Amount')).not.toHaveClass('dm-ctl-on');
    await openSubmenu(within(data()), 'Amount', 'Format');
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Money' }));
    const money = await screen.findByRole('menu', { name: 'Money Amount' });
    expect(within(money).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['USD', 'EUR', 'GBP', 'UAH']);
    expect(within(money).getByRole('menuitemradio', { name: 'GBP' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Escape}{Escape}{Escape}');
    await openSubmenu(within(data()), 'Amount', 'Format');
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Automatic' }));
    await waitFor(() => expect(cellsOf('Amount')[0]).not.toMatch(/£/));
    expect(await ctx.collections<Record<string, unknown>>('column-formats-member').get('orders')).toMatchObject({ document: { amount: { kind: 'auto' } } });
    // with no project pick Automatic is stored too, and the icon stays off
    expect(within(data()).getByLabelText('Column menu Amount')).not.toHaveClass('dm-ctl-on');
  });

  test('an AI-picked currency outside the four is listed in the Money submenu', async () => {
    setup({ amount: { kind: 'money', currency: 'PLN' } });
    await showAmount();
    await openSubmenu(within(data()), 'Amount', 'Format');
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Money' }));
    const money = await screen.findByRole('menu', { name: 'Money Amount' });
    expect(within(money).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['USD', 'EUR', 'GBP', 'UAH', 'PLN']);
    expect(within(money).getByRole('menuitemradio', { name: 'PLN' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Hide column takes the column off the grid, the way unticking it in Fields does; Fields brings it back', async () => {
    setup();
    await ready();
    expect(headers().some((h) => h.startsWith('status'))).toBe(true);
    const menu = await openColumnMenu(within(data()), 'status');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(headers().some((h) => h.startsWith('status'))).toBe(false));
    expect(open()).toHaveLength(0);
    await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
    expect(await screen.findByLabelText('status')).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('status'));
    await waitFor(() => expect(headers().some((h) => h.startsWith('status'))).toBe(true));
  });

  test('the last column cannot be hidden', async () => {
    setup();
    await ready();
    for (const title of headers().filter((h) => h !== 'id').map((h) => h.replace(/\d*$/, ''))) {
      const m = await openColumnMenu(within(data()), title);
      await userEvent.click(within(m).getByRole('menuitem', { name: 'Hide column' }));
      await waitFor(() => expect(open()).toHaveLength(0));
    }
    await waitFor(() => expect(headers()).toHaveLength(1));
    const menu = await openColumnMenu(within(data()), 'id');
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeDisabled();
  });

  test('keys: arrows move, Right opens a submenu, Escape closes the submenu first and then the menu', async () => {
    setup();
    await ready();
    const icon = within(data()).getByLabelText('Column menu status');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: 'Menu of status' });
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Filter' })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Sort' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const sort = await screen.findByRole('menu', { name: 'Sort status' });
    await waitFor(() => expect(within(sort).getByRole('menuitemradio', { name: 'Sort A → Z' })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(within(sort).getByRole('menuitemradio', { name: 'Sort Z → A' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('menu', { name: 'Sort status' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Sort' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Sort status' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Sort status' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Menu of status' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(open()).toHaveLength(0));
    expect(icon).toHaveFocus();
  });

  test('a press outside closes the menu', async () => {
    setup();
    await ready();
    await openColumnMenu(within(data()), 'status');
    await userEvent.click(document.body);
    await waitFor(() => expect(open()).toHaveLength(0));
  });

  test('Escape in the Filter editor closes the submenu and keeps focus in the menu; the next Escape returns focus to the icon', async () => {
    setup();
    await ready();
    const icon = within(data()).getByLabelText('Column menu id');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: 'Menu of id' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filter of id' });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filter of id' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Filter' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(open()).toHaveLength(0);
    expect(icon).toHaveFocus();
  });

  test('a scroll or a resize outside the menu closes it; a scroll inside does not', async () => {
    setup();
    await ready();
    await openColumnMenu(within(data()), 'status');
    fireEvent.scroll(screen.getByRole('menu', { name: 'Menu of status' }));
    expect(open()).toHaveLength(1);
    fireEvent.scroll(document.body);
    await waitFor(() => expect(open()).toHaveLength(0));
    await openColumnMenu(within(data()), 'status');
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(open()).toHaveLength(0));
  });

  test('the menu stays open, and its header is not rebuilt, while a setting changes', async () => {
    setup();
    await ready();
    const icon = within(data()).getByLabelText('Column menu status');
    await userEvent.click(icon);
    await screen.findByRole('menu', { name: 'Menu of status' });
    // a keyboard click on another title sorts without a pointer press outside the menu
    fireEvent.click(within(data()).getByRole('button', { name: /^Sort by id,/ }));
    await within(data()).findByLabelText('Sorted A to Z: id');
    expect(open()).toHaveLength(1);
    expect(within(data()).getByLabelText('Column menu status')).toBe(icon);
  });

  test('Tab in the menu closes it and returns focus to the icon; Tab in the Filter editor keeps its own order', async () => {
    setup();
    await ready();
    const icon = within(data()).getByLabelText('Column menu status');
    await userEvent.click(icon);
    await screen.findByRole('menu', { name: 'Menu of status' });
    await userEvent.tab();
    await waitFor(() => expect(open()).toHaveLength(0));
    expect(icon).toHaveFocus();
    await openSubmenu(within(data()), 'status', 'Filter');
    const panel = await screen.findByRole('dialog', { name: 'Filter of status' });
    await userEvent.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('menu', { name: 'Menu of status' })).toBeInTheDocument();
  });

  test('hover intent: another row replaces the open submenu only after resting on it, and never over an edit; a click is immediate', async () => {
    setup();
    await ready();
    const menu = await openColumnMenu(within(data()), 'status');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filter of status' });
    await userEvent.type(within(panel).getByLabelText('Value'), 'x');
    await userEvent.hover(within(menu).getByRole('menuitem', { name: 'Sort' }));
    await new Promise((r) => setTimeout(r, HOVER_MS + 150));
    expect(screen.queryByRole('menu', { name: 'Sort status' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Filter of status' })).toBeInTheDocument();
    // a click is immediate, edits or not
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sort' }));
    expect(await screen.findByRole('menu', { name: 'Sort status' })).toBeInTheDocument();
  });

  test('hover intent: with nothing edited, hovering another row switches after the delay, not at once', async () => {
    setup();
    await ready();
    const menu = await openColumnMenu(within(data()), 'status');
    await userEvent.hover(within(menu).getByRole('menuitem', { name: 'Sort' }));
    await screen.findByRole('menu', { name: 'Sort status' });
    await userEvent.hover(within(menu).getByRole('menuitem', { name: 'Filter' }));
    expect(screen.queryByRole('dialog', { name: 'Filter of status' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Filter of status' })).toBeInTheDocument());
  });

  test('the Sort submenu lines Remove sort up with the checked rows', async () => {
    setup();
    await ready();
    await openSubmenu(within(data()), 'status', 'Sort');
    const sort = await screen.findByRole('menu', { name: 'Sort status' });
    const remove = within(sort).getByRole('menuitem', { name: 'Remove sort' });
    expect(remove.querySelector('.dm-menu-check')).not.toBeNull();
    expect(sort.querySelectorAll('.dm-menu-check')).toHaveLength(3);
  });

  test('Hide column moves focus to the next column\'s menu icon, or the previous one for the last column', async () => {
    setup();
    await ready();
    const icons = () => within(data()).getAllByLabelText(/^Column menu /).map((e) => e.getAttribute('aria-label'));
    const first = icons();
    let menu = await openColumnMenu(within(data()), first[1]!.replace('Column menu ', ''));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(first[2]));
    const last = icons().at(-1)!;
    menu = await openColumnMenu(within(data()), last.replace('Column menu ', ''));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(icons().at(-1)));
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe(last);
  });
});
