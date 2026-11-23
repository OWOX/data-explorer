import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';

function setup(grid: GridState) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (id === 'orders') queries.push(o); return real(id, o); } } } };
  const state: { current: ReturnType<typeof useStore>[0] | null } = { current: null };
  function Probe() {
    const [s, dispatch] = useStore();
    state.current = s;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries, state };
}

const data = () => document.getElementById('band-data')!;
const grid = () => document.querySelector<HTMLElement>('#band-data');
const shownTitles = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const base: GridState = { columns: ['id', 'net_revenue'], filters: {}, sorts: null, limit: 200 };
const g = (extra: Partial<GridState> = {}): GridState => ({ ...base, ...extra });

/** Opens the Fields list of the main mart and returns the menu icon of a field's row. */
async function rowIcon(field: string) {
  await waitFor(() => expect(grid()).not.toBeNull());
  await userEvent.click((await within(data()).findAllByRole('button', { name: /^Fields of / }))[0]!);
  const list = await screen.findByRole('listbox', { name: /^Fields of / });
  return { list, icon: (await waitFor(() => { const el = list.closest('[data-popover-body]')!.querySelector<HTMLElement>(`[data-row-action][data-field="${field}"]`); if (!el) throw new Error('no icon'); return el; })) };
}

describe('field actions from the Fields list', () => {
  test('every field row has the menu icon, the Count Unique row has none, and an idle icon is grey until the row is hovered', async () => {
    setup(g());
    const { list, icon } = await rowIcon('status');
    const options = within(list).getAllByRole('option');
    const rows = options.map((o) => o.parentElement as HTMLElement);
    for (const [i, row] of rows.entries()) {
      const has = row.querySelector('[data-row-action]') !== null;
      expect(has, options[i]!.getAttribute('aria-label') ?? '').toBe(options[i]!.getAttribute('aria-label') !== 'Count Unique');
    }
    expect(icon).toHaveClass('dm-row-ctl');
    expect(icon).not.toHaveClass('dm-ctl-on');
  });

  test('the icon is green for a rule on a field that is not a column, and for one that is', async () => {
    setup(g({ filters: { status: { field: 'status', op: 'eq', value: 'paid' } }, sorts: [{ field: 'net_revenue', direction: 'desc' }] }));
    const hidden = await rowIcon('status');
    expect(hidden.icon).toHaveClass('dm-ctl-on');
    expect(hidden.list.closest('[data-popover-body]')!.querySelector('[data-row-action][data-field="net_revenue"]')).toHaveClass('dm-ctl-on');
  });

  test('a filter applied from the menu keeps the field hidden, reaches the query, and the Fields list stays open', async () => {
    const t = setup(g());
    const { icon } = await rowIcon('status');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: /^Menu of status$/i });
    // A field that is not a column has no Move rows and nothing to hide.
    expect(within(menu).queryByRole('menuitem', { name: 'Move left' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Move right' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeDisabled();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Filter' }));
    const dialog = await screen.findByRole('dialog', { name: /^Filter of status$/i });
    await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
    await userEvent.type(within(dialog).getByLabelText('Value'), 'paid');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.filters).toEqual({ status: expect.objectContaining({ field: 'status', op: 'eq', value: 'paid' }) }));
    // The columns did not change, and the Fields list is still there.
    expect(t.state.current!.grids.orders!.columns).toEqual(['id', 'net_revenue']);
    expect(screen.getByRole('listbox', { name: /^Fields of / })).toBeVisible();
    await waitFor(() => expect(t.queries.some((q) => q.filter?.some((f) => f.column === 'status' && 'value' in f && f.value === 'paid'))).toBe(true));
    // The rows query carries the filter without asking for the column.
    const q = t.queries.find((x) => x.filter?.some((f) => f.column === 'status') && x.column?.includes('id'))!;
    expect(q.column).not.toContain('status');
    // The rule is saved with the view, in the title row marks, and undone in one step.
    expect(await screen.findByRole('button', { name: /^Filter rules in / })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.filters).toEqual({}));
  });

  test('Reset clears a rule on a hidden field, and Undo puts it back', async () => {
    const t = setup(g({ filters: { status: { field: 'status', op: 'eq', value: 'paid' } } }));
    await waitFor(() => expect(shownTitles()).toHaveLength(2));
    const reset = within(data()).getByRole('button', { name: 'Reset' });
    await waitFor(() => expect(reset).toBeEnabled());
    await userEvent.click(reset);
    await waitFor(() => expect(t.state.current!.grids.orders!.filters).toEqual({}));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.filters).toEqual({ status: expect.objectContaining({ value: 'paid' }) }));
  });

  test('Aggregate on a hidden field shows it as a column first, and one Undo takes both back', async () => {
    const t = setup(g());
    const { icon } = await rowIcon('amount');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: /^Menu of Amount$/i });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Aggregate' }));
    const dialog = await screen.findByRole('dialog', { name: /^Aggregation of Amount$/i });
    await userEvent.click(within(dialog).getByLabelText('Sum'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.columns).toContain('amount'));
    expect(t.state.current!.grids.orders!.aggregations).toEqual([{ column: 'amount', function: 'SUM' }]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.columns).toEqual(['id', 'net_revenue']));
    expect(t.state.current!.grids.orders!.aggregations).toBeUndefined();
  });

  test('Sort on a hidden field shows it as a column first, in one step', async () => {
    const t = setup(g());
    const { icon } = await rowIcon('status');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: /^Menu of status$/i });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sort' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Sort A → Z' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.columns).toContain('status'));
    expect(t.state.current!.grids.orders!.sorts).toEqual([{ field: 'status', direction: 'asc' }]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.columns).toEqual(['id', 'net_revenue']));
    expect(t.state.current!.grids.orders!.sorts).toBeNull();
  });

  test('from the keyboard: Arrow Right from a row reaches its icon, Enter opens the menu, Escape closes only the menu and returns to the icon', async () => {
    setup(g());
    const { list, icon } = await rowIcon('status');
    const option = within(list).getByRole('option', { name: 'status' });
    option.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(icon).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu', { name: /^Menu of status$/i })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: /^Menu of status$/i })).toBeNull());
    expect(list).toBeVisible();
    expect(icon).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(option).toHaveFocus();
  });

  test('the menu of a shown field offers Move and Hide as the header does', async () => {
    setup(g({ columns: ['id', 'status', 'net_revenue'] }));
    const { icon } = await rowIcon('status');
    await userEvent.click(icon);
    const menu = await screen.findByRole('menu', { name: /^Menu of status$/i });
    expect(within(menu).getByRole('menuitem', { name: 'Move left' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeEnabled();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(shownTitles()).not.toContain('status'));
  });

  test('every chart query carries the filters of a hidden field, as the table does', async () => {
    const t = setup(g({ columns: ['status', 'net_revenue'], filters: { created_at: { field: 'created_at', op: 'after', value: '2000-01-01' } }, view: 'charts' }));
    await waitFor(() => expect(data().querySelector('[data-card="net_revenue"] [data-card-value]')).not.toBeNull(), { timeout: 4000 });
    const reads = t.queries.filter((q) => q.limit !== 501 && !(q.uniqueCount?.length === 1 && q.uniqueCount[0] === '' && !q.column));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((q) => q.filter?.some((f) => f.column === 'created_at'))).toBe(true);
  });
});
