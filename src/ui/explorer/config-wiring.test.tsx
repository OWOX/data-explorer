import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { App } from '../App';
import { openConfigMenu, openFields } from './menu-test-utils';

const data = () => document.getElementById('band-data')!;
const probe = {} as { state: State; dispatch: ReturnType<typeof useStore>[1] };
function Probe() { const [state, dispatch] = useStore(); Object.assign(probe, { state, dispatch }); return null; }
const columns = () => probe.state.grids.orders!.columns;
const rowNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((r) => r.textContent);

/** The demo marts with Customers reachable a second way, through Stores (the fixtures' edge list is shared, so the list is copied). */
const storesJoinCustomers = () => ({ ...demoFixtures(), edges: [...demoFixtures().edges, { id: 'e-stores-customers', sourceDataMartId: 'stores', targetDataMartId: 'customers', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] }] });

async function setup(extra: string[], fixtures = demoFixtures(), ctx?: Ctx) {
  // The probe outlives a test: a stale state from the one before must not pass the wait below.
  probe.state = undefined as never;
  render(<AppServices ctx={ctx ?? createMockCtx(fixtures, { latencyMs: 0, maxJoinDepth: 3 })}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(probe.state.grids.orders).toBeTruthy());
  const grid = probe.state.grids.orders!;
  probe.dispatch({ type: 'editGrid', martId: 'orders', grid: { ...grid, columns: [...grid.columns, ...extra] } });
  await waitFor(() => expect(data().querySelectorAll('th[data-group-path]').length).toBeGreaterThan(extra.length ? 1 : 0));
}

test('the config button sits in the band header in Table, and the title cell has no column badge or ×', async () => {
  await setup(['customers__name']);
  const slot = data().querySelector<HTMLElement>('[data-chart-list-slot]')!;
  expect(within(slot).getByRole('button', { name: 'Configure data' })).toHaveAttribute('data-config-button');
  expect(data().querySelector('[data-mart-badge="column"]')).toBeNull();
  expect(within(data()).queryByRole('button', { name: /^Fields of / })).toBeNull();
  expect(within(data()).queryByRole('button', { name: /from the grid$/ })).toBeNull();
});

test('a data mart on a path with no column is listed after the shown ones, and ticking its field adds the column', async () => {
  await setup(['customers__countries__name']);
  const menu = await openConfigMenu();
  expect(rowNames(menu)).toEqual(['Orders', 'Countries', 'Customers']);
  const dialog = await openFields('Customers');
  await userEvent.click(within(dialog).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__name'));
  expect(columns()).toContain('customers__countries__name');
});

test('a joinable data mart is listed under its parent, and ticking its field joins it in one Undo step', async () => {
  await setup([]);
  const orders = await openFields('Orders');
  expect(within(orders).getByText('Joinable Data Marts')).toBeInTheDocument();
  const before = [...columns()];
  await userEvent.click(within(orders).getByRole('menuitem', { name: 'Customers' }));
  const customers = await screen.findByRole('dialog', { name: 'Customers' });
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__name'));
  await userEvent.keyboard('{Escape}{Escape}{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(columns()).toEqual(before));
});

test('two bare copies of one data mart have different titles in the config menu', async () => {
  const fixtures = storesJoinCustomers();
  await setup(['customers__countries__name', 'stores__customers__countries__name'], fixtures);
  const menu = await openConfigMenu();
  const titles = rowNames(menu).filter((t) => t!.startsWith('Customers'));
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

test('two bare copies of one data mart have different titles in a chart\'s menus', async () => {
  const fixtures = storesJoinCustomers();
  await setup(['customers__countries__name', 'stores__customers__countries__name'], fixtures);
  await userEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  await waitFor(() => expect(data().querySelector('section.dm-chart')).not.toBeNull());
  await userEvent.click(await screen.findByRole('button', { name: 'Pie options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  const menu = await screen.findByRole('menu', { name: 'Dimension' });
  const titles = within(menu).getAllByRole('menuitem').map((r) => r.textContent).filter((t) => t!.startsWith('Customers'));
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

test('untick an ancestor\'s last field, then Remove from report on the nested mart in the same menu: both leave, in two Undo steps', async () => {
  await setup(['customers__name']);
  const customers = await openFields('Customers');
  await userEvent.click(within(customers).getByRole('menuitem', { name: 'Countries' }));
  const countries = await screen.findByRole('dialog', { name: 'Countries' });
  await userEvent.click(within(countries).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__countries__name'));
  const both = [...columns()];
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await userEvent.click(within(countries).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
  expect(data().querySelectorAll('th[data-group-path]')).toHaveLength(1);
  const undo = screen.getByRole('button', { name: 'Undo' });
  // The flush of the ancestor's field and the removal are two edits: two steps, and the second one brings both marts back.
  await userEvent.click(undo);
  await waitFor(() => expect(columns()).toEqual(both.filter((c) => c !== 'customers__name')));
  await userEvent.click(undo);
  await waitFor(() => expect(columns()).toEqual(both));
});

/** The demo marts with Customers joinable twice under Orders (alias paths customers and buyer), as a backend with two joins to one mart sends them. */
function twoJoinsToCustomers(): Ctx {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const real = base.owox.getJson.bind(base.owox);
  type Dto = { blendedFields: { name: string; aliasPath: string }[]; availableSources: { aliasPath: string; dataMartId: string }[] };
  return { ...base, owox: { ...base.owox, getJson: (async (path: string, query?: Record<string, string>) => {
    const dto = (await real(path, query)) as Dto;
    if (!path.endsWith('/blendable-schema')) return dto;
    const copy = (x: { aliasPath: string }) => ({ ...x, aliasPath: 'buyer' });
    return {
      ...dto,
      availableSources: [...dto.availableSources, ...dto.availableSources.filter((x) => x.aliasPath === 'customers').map(copy)],
      blendedFields: [...dto.blendedFields, ...dto.blendedFields.filter((x) => x.aliasPath === 'customers').map((x) => ({ ...copy(x), name: x.name.replace(/^customers__/, 'buyer__') }))],
    };
  }) as Ctx['owox']['getJson'] } };
}

test('two joins to one data mart under one parent read differently in its joinable list', async () => {
  await setup([], demoFixtures(), twoJoinsToCustomers());
  const orders = await openFields('Orders');
  const titles = within(orders).getAllByRole('menuitem').map((r) => r.textContent).filter((t) => t!.startsWith('Customers'));
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

test('a pending change survives a Table to Charts switch: the column leaves, the view is Charts, and one Undo brings the column back', async () => {
  await setup(['customers__name']);
  const customers = await openFields('Customers');
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  const before = [...columns()];
  // A click with no press before it (the keyboard, a script): the menu is not closed by the press, it goes with the view it was in.
  fireEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  await waitFor(() => expect(probe.state.grids.orders!.view).toBe('charts'));
  await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
  expect(screen.queryByRole('menu', { name: 'Configure data' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(columns()).toEqual(before));
  expect(probe.state.grids.orders!.view).toBe('charts');
});

test('removing the main mart promotes the next one by the state as it is, after a change that went out just before', async () => {
  await setup([]);
  const orders = await openFields('Orders');
  const join = async (mart: string, field: RegExp) => {
    await userEvent.click(within(orders).getByRole('menuitem', { name: mart }));
    const panel = await screen.findByRole('dialog', { name: mart });
    await userEvent.click(within(panel).getByRole('option', { name: field }));
    return panel;
  };
  await join('Customers', /^name/i);
  await join('Stores', /city/i);
  // Customers is the second group; unticking its last field is held until its panel goes, and Remove sends it out in the same tick.
  await userEvent.click(within(orders).getByRole('menuitem', { name: 'Customers' }));
  const customers = await screen.findByRole('dialog', { name: 'Customers' });
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await userEvent.click(within(orders).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(Array.from(data().querySelectorAll('th[data-group-path]')).map((h) => h.querySelector('.truncate')!.textContent)).toEqual(['Stores']));
  await waitFor(() => expect(document.activeElement).toBe(within(data()).getByRole('button', { name: 'Configure data' })));
});
