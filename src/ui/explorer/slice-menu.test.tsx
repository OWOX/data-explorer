import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu, openSubmenu } from './menu-test-utils';

function setup(grid: GridState, patch?: (name: string) => Record<string, unknown> | undefined) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const realGet = base.owox.getJson.bind(base.owox);
  const getJson = (async (path: string, q?: Record<string, string>) => {
    const dto = await realGet<{ blendedFields?: { name: string }[] }>(path, q);
    if (path.endsWith('/blendable-schema') && patch) dto.blendedFields = dto.blendedFields?.map((b) => ({ ...b, ...patch(b.name) }));
    return dto;
  }) as typeof base.owox.getJson;
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, getJson, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (id === 'orders') queries.push(o); return real(id, o); } } } };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const plain: GridState = { columns: ['id', 'status', 'customers__city'], filters: {}, sorts: null, limit: 200 };
const sliced: GridState = { ...plain, slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'PL' } }, columns: ['id', 'status', 'customers__country_code'] };
const having: GridState = {
  columns: ['status', 'net_revenue'], filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: 100, fn: 'SUM' } }, aggregations: [{ column: 'net_revenue', function: 'SUM' }], sorts: null, limit: 200,
};

test('the Slice row sits under Filter on a joined column only', async () => {
  setup(plain);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const joined = await openColumnMenu(within(data()), 'Customers · city');
  const names = within(joined).getAllByRole('menuitem').map((r) => r.textContent);
  expect(names.indexOf('Slice')).toBe(names.indexOf('Filter') + 1);
  expect(joined.querySelector('svg.lucide-layers')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  const main = await openColumnMenu(within(data()), 'status');
  expect(within(main).queryByRole('menuitem', { name: 'Slice' })).toBeNull();
});

test('Slice opens "Slice of {title}" with the banner; Apply sets the slice and Clear removes it', async () => {
  const t = setup(plain);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const dialog = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  const note = within(dialog).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Slices filter the joined data mart before it is joined — reducing the rows pulled in.');
  expect(note.querySelector('strong')?.textContent).toBe('before');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'Kyiv');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)?.filter).toEqual([{ column: 'customers__city', operator: 'eq', value: 'Kyiv', placement: 'pre-join' }]));
  expect(await within(data()).findByRole('button', { name: /^Slice Customers · city/ })).toBeInTheDocument();
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const again = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  await userEvent.click(within(again).getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(within(data()).queryByRole('button', { name: /^Slice Customers · city/ })).toBeNull());
});

test('the header shows a Layers button for an active slice and it opens the Slice submenu', async () => {
  setup(sliced);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const button = await within(data()).findByRole('button', { name: 'Slice Customers · Country' });
  expect(button.querySelector('svg.lucide-layers')).not.toBeNull();
  await userEvent.click(button);
  expect(await screen.findByRole('dialog', { name: 'Slice of Customers · Country' })).toBeInTheDocument();
});

test('a HAVING filter says what it filters, takes a number and keeps its function on apply', async () => {
  const t = setup(having);
  await waitFor(() => expect(headers().some((h) => h?.includes('Sum'))).toBe(true));
  const button = await within(data()).findByRole('button', { name: /^Filter Net Revenue/ });
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: /^Filter of Net Revenue/ });
  expect(within(dialog).getByText('Filters the sum after grouping')).toBeInTheDocument();
  expect(within(dialog).queryByText('Filters rows before they are aggregated')).toBeNull();
  expect(within(dialog).getByLabelText('Value')).toHaveAttribute('type', 'number');
  const value = within(dialog).getByLabelText('Value');
  await userEvent.clear(value);
  await userEvent.type(value, '250');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)?.filter).toEqual([{ column: 'net_revenue', operator: 'gt', value: 250, function: 'SUM' }]));
});

test('the Funnel tooltip of a HAVING filter names the function', async () => {
  setup(having);
  await waitFor(() => expect(headers().some((h) => h?.includes('Sum'))).toBe(true));
  const button = await within(data()).findByRole('button', { name: /^Filter Net Revenue/ });
  await userEvent.hover(button);
  expect((await screen.findAllByText('Filter: sum > 100')).length).toBeGreaterThan(0);
});

test('the Slice row is active when its field has a slice, and not when it has none', async () => {
  setup({ ...sliced, columns: ['id', 'customers__city', 'customers__country_code'] });
  await waitFor(() => expect(headers()).toHaveLength(3));
  const on = await openColumnMenu(within(data()), 'Customers · Country');
  expect(within(on).getByRole('menuitem', { name: 'Slice' })).toHaveAttribute('data-active');
  await userEvent.keyboard('{Escape}');
  const off = await openColumnMenu(within(data()), 'Customers · city');
  expect(within(off).getByRole('menuitem', { name: 'Slice' })).not.toHaveAttribute('data-active');
});

test('a slice on a field that is not joined is neither sent nor shown as active', async () => {
  const t = setup({ ...plain, slices: { status: { field: 'status', op: 'eq', value: 'paid' } } });
  await waitFor(() => expect(headers()).toHaveLength(3));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  expect(t.queries.every((q) => !q.filter)).toBe(true);
  expect(within(data()).queryByRole('button', { name: /^Slice / })).toBeNull();
  const icon = await within(data()).findByLabelText('Column menu status');
  expect(icon.className).not.toContain('dm-ctl-on');
});

test('a slice on a BOOL source typed STRING offers is true and is false', async () => {
  setup(plain, (name) => (name === 'customers__city' ? { sourceFieldType: 'BOOL' } : undefined));
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const dialog = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  const ops = within(dialog).getAllByRole('option').map((o) => o.textContent);
  expect(ops).toEqual(expect.arrayContaining(['is true', 'is false']));
  expect(ops).not.toContain('contains');
});

test('a COUNT HAVING filter on a STRING column takes a number', async () => {
  setup({ columns: ['id', 'status'], filters: { status: { field: 'status', op: 'gt', value: 1, fn: 'COUNT' } }, aggregations: [{ column: 'status', function: 'COUNT' }], sorts: null, limit: 200 });
  await waitFor(() => expect(headers().some((h) => h?.includes('Count'))).toBe(true));
  const button = await within(data()).findByRole('button', { name: /^Filter status/i });
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: /^Filter of status/i });
  expect(within(dialog).getByLabelText('Value')).toHaveAttribute('type', 'number');
});

test('the note of a second-level panel comes after its Cancel / Apply row', async () => {
  setup(plain);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const after = (note: Element, buttons: Element) => !!(buttons.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING);
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const slice = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  expect(slice.className).toContain('dm-menu-sub');
  expect(after(within(slice).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Slices filter the joined data mart before it is joined — reducing the rows pulled in.'), within(slice).getByRole('button', { name: 'Apply' }))).toBe(true);
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(() => expect(document.querySelector('[data-column-menu]')).toBeNull());
  await openSubmenu(within(data()), 'Customers · city', 'Aggregate');
  const agg = await screen.findByRole('dialog', { name: 'Aggregation of Customers · city' });
  expect(agg.className).toContain('dm-menu-sub');
  expect(after(within(agg).getByText(/^Filters still apply to the rows/), within(agg).getByRole('button', { name: 'Apply' }))).toBe(true);
});
