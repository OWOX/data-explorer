import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRID_COLUMNS_COLLECTION } from '../../api/grid-columns';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { SchemaFieldDto, TraverseOptions } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { openColumnMenu, closeConfigMenu, openFields, openSubmenu } from './menu-test-utils';

function setup(opts: { fields?: SchemaFieldDto[]; saved?: Record<string, unknown>; gate?: Promise<void> } = {}) {
  const fixtures = demoFixtures();
  if (opts.fields) fixtures.marts.find((m) => m.id === 'orders')!.fields.push(...opts.fields);
  const ctx = createMockCtx(fixtures, { latencyMs: 0, keyShown: true });
  if (opts.saved) void ctx.collections<Record<string, unknown>>(GRID_COLUMNS_COLLECTION).put('orders', { at: 'then', ...opts.saved });
  const puts: { id: string; doc: Record<string, unknown> }[] = [];
  const queries: { id: string; o: TraverseOptions }[] = [];
  const col = ctx.collections;
  const realTraverse = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
  const spied = {
    ...ctx,
    owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (!(o as { uniqueCount?: unknown }).uniqueCount) queries.push({ id, o }); return o.aggregation?.length && opts.gate ? opts.gate.then(() => realTraverse(id, o)) : realTraverse(id, o); } } },
    collections: <T,>(name: string) => { const c = col<T>(name); return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { puts.push({ id, doc: d as never }); return c.put(id, d); } } : c; },
  };
  render(<AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices>);
  return { puts, queries };
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true)); };

/** The first body cell under "Amount · Sum": text with a digit means the grouped rows have arrived. */
const sumCell = () => { const at = headers().findIndex((h) => h.startsWith('Amount · Sum')); return at < 0 ? '' : (bodyRows()[0]?.querySelectorAll('td')[at]?.textContent ?? ''); };
const sumLoaded = () => waitFor(() => expect(sumCell()).toMatch(/\d/));

async function showColumn(label: string | RegExp) {
  await openFields('Orders');
  await userEvent.click(await screen.findByRole('option', { name: label }));
  await closeConfigMenu();
}

/** Opens the aggregation popover of a column, ticks the functions and applies. */
async function aggregate(column: string, ...functions: string[]) {
  await openSubmenu(within(data()), column, 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  for (const f of functions) await userEvent.click(within(dialog).getByLabelText(f));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

test('a Sum on Amount groups by the other columns: Amount · Sum, no primary key sent, a groups badge, rows that open nothing', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await waitFor(() => expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true));
  const q = t.queries.filter((x) => x.id === 'orders').at(-1)!.o;
  expect(q.aggregation).toEqual([{ column: 'amount', function: 'SUM' }]);
  expect(q.column).toEqual(['id', 'customer_id', 'product_id', 'store_id', 'status', 'amount']);
  // no sort of the member's own: the first group key ascending, so "Load more" pages stay put
  expect(q.sort).toEqual([{ column: 'id', direction: 'asc' }]);
  await sumLoaded();
  await waitFor(() => expect(within(data()).getByText(/\d+\+? groups?$/)).toBeInTheDocument());
  expect(within(data()).queryByText(/records$/)).toBeNull();
  // a grouped row is no single record
  fireEvent.click(bodyRows()[0]!);
  expect(await within(row()).findByText('Grouped rows have no single record.')).toBeInTheDocument();
  expect(bodyRows()[0]).not.toHaveClass('cursor-pointer');
  // the values are numbers read from the "<column> | SUM" key
  expect(sumCell()).toMatch(/\d/);
});

test('each function is its own column, the first is sortable, the others are not; the sort names the source column', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum', 'Average');
  await waitFor(() => expect(headers().filter((h) => h.startsWith('Amount')).length).toBe(2));
  await sumLoaded();
  expect(within(data()).getByRole('button', { name: /^Sort by Amount · Sum,/ })).toBeInTheDocument();
  expect(within(data()).queryByRole('button', { name: /^Sort by Amount · Average,/ })).toBeNull();
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Amount · Sum,/ }));
  await waitFor(() => expect(t.queries.at(-1)!.o.sort).toEqual([{ column: 'amount', direction: 'asc' }]));
});

test('a date takes one bucket instead of functions, and shows the bucket start by its bucket', async () => {
  const t = setup();
  await ready();
  await showColumn(/created_at/);
  await openSubmenu(within(data()), 'created_at', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Group by bucket'), 'MONTH');
  await userEvent.selectOptions(within(dialog).getByLabelText('Time zone'), 'UTC');
  // a bucket and functions exclude each other
  expect(within(dialog).getByRole('option', { name: 'Min' })).toHaveAttribute('aria-selected', 'false');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)!.o.dateTrunc).toEqual([{ column: 'created_at', unit: 'MONTH', timeZone: 'UTC' }]));
  expect(t.queries.at(-1)!.o.aggregation).toBeUndefined();
  const at = headers().indexOf('created_at');
  await waitFor(() => expect(bodyRows()[0]!.querySelectorAll('td')[at]!.textContent).toMatch(/^[A-Z][a-z]{2} \d{4}$/));
});

test('the Sigma stays on while a column is aggregated; unticking all and applying ungroups; Reset keeps aggregations', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  await waitFor(() => expect(within(data()).getByRole('button', { name: 'Aggregate Amount' })).toHaveClass('dm-reveal-on'));
  await userEvent.click(within(data()).getByRole('button', { name: 'Reset' }));
  expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true);
  await waitFor(() => expect(t.puts.some((p) => p.id === 'orders' && JSON.stringify(p.doc.aggregations) === JSON.stringify([{ column: 'amount', function: 'SUM' }]))).toBe(true), { timeout: 3000 });
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dlg = await screen.findByRole('dialog');
  await userEvent.click(within(dlg).getByLabelText('Sum'));
  await userEvent.click(within(dlg).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(headers()).toContain('Amount'));
  expect(within(data()).getByText(/records$/)).toBeInTheDocument();
});

test('the popover has no title row, a Sheets-style Select all and Clear on its function list; Apply is off while nothing is set, on once something is ticked', async () => {
  setup();
  await ready();
  await showColumn('Amount');
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog', { name: 'Aggregation of Amount' });
  expect(dialog.querySelector('.dm-popover-title')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  const buttons = within(dialog).getAllByRole('button').map((b) => b.textContent);
  expect(buttons.slice(-2)).toEqual(['Cancel', 'Apply']);
  const apply = within(dialog).getByRole('button', { name: 'Apply' });
  expect(apply).toBeDisabled();
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  expect(apply).toBeEnabled();
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  expect(apply).toBeDisabled();
});

test('with an aggregation set, unticking everything keeps Apply on, and applying it removes the aggregation', async () => {
  setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog', { name: 'Aggregation of Amount' });
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  const apply = within(dialog).getByRole('button', { name: 'Apply' });
  expect(apply).toBeEnabled();
  await userEvent.click(apply);
  await waitFor(() => expect(headers()).toContain('Amount'));
  expect(within(data()).getByText(/records$/)).toBeInTheDocument();
});

test('the filter popover of an aggregated column says it filters before aggregating', async () => {
  setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await openSubmenu(within(data()), 'Amount', 'Filter');
  expect(await screen.findByText('Filters rows before they are aggregated')).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Filters narrow the final result — applied after all joins.')).toBeInTheDocument();
});

test('a column no longer shown loses its rules', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText('Amount'));
  await waitFor(() => expect(headers()).not.toContain('Amount · Sum'));
  await waitFor(() => expect(t.queries.at(-1)!.o.aggregation).toBeUndefined());
});

test('while the grouped rows are in flight there is no groups badge and no empty Amount · Sum cells', async () => {
  let open!: () => void;
  const t = setup({ gate: new Promise<void>((r) => { open = r; }) });
  await ready();
  await showColumn('Amount');
  expect(within(data()).getByText(/\d+\+? records$/)).toBeInTheDocument();
  await aggregate('Amount', 'Sum');
  await waitFor(() => expect(t.queries.at(-1)!.o.aggregation).toBeDefined());
  expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true);
  expect(within(data()).queryByText(/\d+\+? (groups?|records)$/)).toBeNull();
  expect(sumCell()).toBe('');
  open();
  await sumLoaded();
  await waitFor(() => expect(within(data()).getByText(/\d+\+? groups?$/)).toBeInTheDocument());
});

const ARRAY_AND_CALCULATED: SchemaFieldDto[] = [{ name: 'tags', type: 'STRING', mode: 'REPEATED' }, { name: 'margin', type: 'NUMERIC', calculated: { level: 'column' } }];

test('an array field takes no function; with one shown the grouped query is not sent and the grid says why', async () => {
  const t = setup({ fields: ARRAY_AND_CALCULATED });
  await ready();
  await showColumn('Amount');
  await showColumn('tags');
  expect(within(data()).queryByRole('button', { name: 'Aggregate tags' })).toBeNull();
  // Apply is off while tags is shown: grouping would make it a GROUP BY key
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(`"tags" can't be grouped`);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // The menu behind the form stays open: a press outside only closes it.
  await userEvent.keyboard('{Escape}');
  // hide tags, group, then show tags again: nothing grouped is sent
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText('tags'));
  await closeConfigMenu();
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  const before = t.queries.length;
  await showColumn('tags');
  expect(await within(data()).findByText(/"tags" can't be grouped/)).toBeInTheDocument();
  expect(t.queries.length).toBe(before);
  expect(within(data()).queryByText(/groups?$/)).toBeNull();
  expect(document.querySelector('.dm-export')).toBeNull();
  // hiding it brings the groups back
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText('tags'));
  await closeConfigMenu();
  await sumLoaded();
  expect(within(data()).queryByText(/can't be grouped/)).toBeNull();
});

test('a calculated field has no Sigma, and a saved rule on one is dropped', async () => {
  const t = setup({ fields: ARRAY_AND_CALCULATED, saved: { columns: ['id', 'status', 'margin'], aggregations: [{ column: 'margin', function: 'SUM' }] } });
  await waitFor(() => expect(headers()).toContain('margin'));
  await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0));
  expect(within(data()).queryByRole('button', { name: 'Aggregate margin' })).toBeNull();
  expect(headers().some((h) => h.startsWith('margin · '))).toBe(false);
  expect(t.queries.every((q) => !q.o.aggregation)).toBe(true);
});

test('a visible calculated column does not block the grouped query: it is sent and Export stays', async () => {
  const t = setup({ fields: [{ name: 'zz_gain', type: 'NUMERIC', calculated: { level: 'column' } }] });
  await ready();
  await showColumn('Amount');
  await showColumn('zz_gain');
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  expect(t.queries.at(-1)!.o.column).toContain('zz_gain');
  expect(within(data()).queryByText(/can't be grouped/)).toBeNull();
  expect(document.querySelector('.dm-export')).not.toBeNull();
  expect(within(data()).queryByRole('button', { name: 'Aggregate zz_gain' })).toBeNull();
});

test('the implicit first-key sort is sent but shows no arrow and no aria-sort; a click then sorts that column', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  expect(t.queries.at(-1)!.o.sort).toEqual([{ column: 'id', direction: 'asc' }]);
  const th = within(data()).getByRole('button', { name: /^Sort by id,/ }).closest('th')!;
  expect(th).toHaveAttribute('aria-sort', 'none');
  expect(within(th).getByRole('button', { name: /currently not sorted/ })).toBeInTheDocument();
  await userEvent.click(within(th).getByRole('button', { name: /^Sort by id,/ }));
  await waitFor(() => expect(within(data()).getByRole('button', { name: /^Sort by id,/ }).closest('th')).toHaveAttribute('aria-sort', 'ascending'));
});

test('Undo of an aggregation alone is saved: the stored columns doc no longer groups', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await waitFor(() => expect(t.puts.some((p) => JSON.stringify(p.doc.aggregations) === JSON.stringify([{ column: 'amount', function: 'SUM' }]))).toBe(true), { timeout: 3000 });
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(false));
  await waitFor(() => expect(t.puts.at(-1)!.doc.aggregations ?? []).toEqual([]), { timeout: 3000 });
});

test('Undo of an aggregation twice in a row is saved both times (apply Sum, Undo, apply Sum, Undo)', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  const sum = JSON.stringify([{ column: 'amount', function: 'SUM' }]);
  for (let round = 0; round < 2; round++) {
    await aggregate('Amount', 'Sum');
    await waitFor(() => expect(t.puts.at(-1)!.doc.aggregations && JSON.stringify(t.puts.at(-1)!.doc.aggregations)).toBe(sum), { timeout: 3000 });
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(false));
    await waitFor(() => expect(t.puts.at(-1)!.doc.aggregations ?? []).toEqual([]), { timeout: 3000 });
  }
});

test('Undo of hiding a column twice in a row is saved both times (hide, Undo, hide, Undo)', async () => {
  const t = setup();
  await ready();
  for (let round = 0; round < 2; round++) {
    const menu = await openColumnMenu(within(data()), 'Store');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(headers().some((h) => h.startsWith('Store'))).toBe(false));
    await waitFor(() => expect(t.puts.at(-1)!.doc.columns).not.toContain('store_id'), { timeout: 3000 });
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(headers().some((h) => h.startsWith('Store'))).toBe(true));
    await waitFor(() => expect(t.puts.at(-1)!.doc.columns).toContain('store_id'), { timeout: 3000 });
  }
});

test('in grouped mode Move right reads nothing new: the cells follow their headers', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await sumLoaded();
  const cellOf = (title: string) => bodyRows()[0]!.querySelectorAll('td')[headers().indexOf(title)]!.textContent;
  const before = headers();
  const id = cellOf('id');
  const status = cellOf('status');
  const reads = t.queries.length;
  const menu = await openColumnMenu(within(data()), 'id');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
  await waitFor(() => expect(headers()).toEqual([before[1], before[0], ...before.slice(2)]));
  expect(t.queries.length).toBe(reads);
  expect(cellOf('id')).toBe(id);
  expect(cellOf('status')).toBe(status);
  expect(sumCell()).toMatch(/\d/);
});
