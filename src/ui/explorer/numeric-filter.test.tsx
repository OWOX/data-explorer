// A column filter set through the popover (an operator, a value, Apply) must reach the rows query and change what the grid shows.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { SchemaFieldDto, TraverseOptions } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { closeConfigMenu, openFields, openSubmenu } from './menu-test-utils';

function setup(fields: SchemaFieldDto[] = []) {
  const fixtures = demoFixtures();
  const orders = fixtures.marts.find((m) => m.id === 'orders')!;
  orders.fields = [...orders.fields, ...fields];
  const ctx = createMockCtx(fixtures, { latencyMs: 0, keyShown: true });
  const queries: TraverseOptions[] = [];
  const real = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
  const spied = { ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (id === 'orders' && !(o as { uniqueCount?: unknown }).uniqueCount) queries.push(o); return real(id, o); } } } };
  render(<AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices>);
  return { queries };
}
const data = () => document.getElementById('band-data')!;
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const loaded = () => waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));

async function show(label: string) {
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText(label));
  await closeConfigMenu();
}
const lastFilter = (queries: TraverseOptions[]) => queries.at(-1)?.filter;

test('Amount > 400 through the popover: the filter is on, the query carries it and the grid shows fewer rows', async () => {
  const t = setup();
  await loaded();
  await show('Amount');
  const before = bodyRows().length;
  await openSubmenu(within(data()), 'Amount', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'gt');
  await userEvent.type(within(dialog).getByLabelText('Value'), '400');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(within(data()).getByRole('button', { name: 'Filter Amount' })).toHaveClass('dm-ctl-on');
  await waitFor(() => expect(lastFilter(t.queries)).toEqual([{ column: 'amount', operator: 'gt', value: 400 }]));
  await waitFor(() => expect(bodyRows().length).toBeLessThan(before));
});

test.each(['NUMERIC', 'BIGNUMERIC', 'FLOAT64', 'FLOAT', 'INT64', 'INTEGER', 'DECIMAL'])('a %s column: ">" and "100", then Enter, applies and the query carries a number', async (type) => {
  const t = setup([{ name: 'metric', type }]);
  await loaded();
  await show('metric');
  await openSubmenu(within(data()), 'metric', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'gt');
  await userEvent.type(within(dialog).getByLabelText('Value'), '100{Enter}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(within(data()).getByRole('button', { name: 'Filter metric' })).toHaveClass('dm-ctl-on');
  await waitFor(() => expect(lastFilter(t.queries)).toEqual([{ column: 'metric', operator: 'gt', value: 100 }]));
});

test('a string column: status equals "paid" through the popover applies', async () => {
  const t = setup();
  await loaded();
  const before = bodyRows().length;
  await openSubmenu(within(data()), 'status', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'paid');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(lastFilter(t.queries)).toEqual([{ column: 'status', operator: 'eq', value: 'paid' }]));
  await waitFor(() => expect(bodyRows().length).toBeLessThan(before));
});

test('a date column: a preset applies at once, and "After…" with a day applies through Apply', async () => {
  const t = setup();
  await loaded();
  await show('created_at');
  await openSubmenu(within(data()), 'created_at', 'Filter');
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Last…' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Last 30 days' }));
  await waitFor(() => expect(lastFilter(t.queries)).toEqual([{ column: 'created_at', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }]));
  await openSubmenu(within(data()), 'created_at', 'Filter');
  await userEvent.click(await screen.findByRole('menuitem', { name: 'After…' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), '2020-01-01T00:00');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(lastFilter(t.queries)).toEqual([{ column: 'created_at', operator: 'gt', value: '2020-01-01 00:00:00' }]));
});
