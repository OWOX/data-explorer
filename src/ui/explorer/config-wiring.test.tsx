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
const openRow = async (menu: HTMLElement, name: string) => {
  await userEvent.click(within(menu).getByRole('menuitem', { name }));
  return screen.findByRole('dialog', { name });
};
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

test('untick an ancestor\'s last field, then Remove from report on the nested mart in the same menu: two Undo steps', async () => {
  await setup(['customers__name']);
  const customers = await openFields('Customers');
  await userEvent.click(within(customers).getByRole('menuitem', { name: 'Countries' }));
  const countries = await screen.findByRole('dialog', { name: 'Countries' });
  await userEvent.click(within(countries).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__countries__name'));
  const both = [...columns()];
  // A panel's rows are taken when it opens: Countries had no column then, so it is opened again, in the same menu, to have Remove.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Countries' })).toBeNull());
  const again = await openRow(customers, 'Countries');
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await userEvent.click(within(again).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
  expect(data().querySelectorAll('th[data-group-path]')).toHaveLength(1);
  const undo = screen.getByRole('button', { name: 'Undo' });
  // The untick of the ancestor's field and the removal are two edits: two steps, and the second one brings both marts back.
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

test('a Clear with the menu open when the view switches to Charts is kept: the column is gone at once, the menu goes with the view, and its own Undo step brings the column back', async () => {
  await setup(['customers__name']);
  const before = [...columns()];
  const customers = await openFields('Customers');
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
  // A click with no press before it (the keyboard, a script): the menu is not closed by the press, it goes with the view it was in.
  fireEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  await waitFor(() => expect(probe.state.grids.orders!.view).toBe('charts'));
  expect(columns().some((c) => c.startsWith('customers__'))).toBe(false);
  expect(screen.queryByRole('menu', { name: 'Configure data' })).toBeNull();
  // The view switch and the Clear are two steps: the first Undo goes back to Table, the second brings the column back.
  const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await undo();
  await waitFor(() => expect(probe.state.grids.orders!.view).toBeUndefined());
  expect(columns().some((c) => c.startsWith('customers__'))).toBe(false);
  await undo();
  await waitFor(() => expect(columns()).toEqual(before));
});

test('removing the main mart promotes the next one by the state as it is, after a change that went out just before', async () => {
  await setup([]);
  const orders = await openFields('Orders');
  const join = async (mart: string, field: RegExp) => {
    await userEvent.click(within(orders).getByRole('menuitem', { name: mart }));
    const panel = await screen.findByRole('dialog', { name: mart });
    await userEvent.click(within(panel).getByRole('option', { name: field }));
    await waitFor(() => expect(Array.from(data().querySelectorAll('th[data-group-path]')).map((h) => h.querySelector('.truncate')!.textContent)).toContain(mart));
  };
  await join('Customers', /^name/i);
  await join('Stores', /city/i);
  // A panel's rows are taken when it opens: Orders had no Remove then, so it is opened again, in the same menu, to have it.
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Orders' })).toBeNull());
  const menu = screen.getByRole('menu', { name: 'Configure data' });
  const again = await openRow(menu, 'Orders');
  const customers = await openRow(again, 'Customers');
  // Customers is the second group; unticking its last field commits at once and keeps the mart, and Remove on the main mart follows.
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await userEvent.click(within(again).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(Array.from(data().querySelectorAll('th[data-group-path]')).map((h) => h.querySelector('.truncate')!.textContent)).toEqual(['Stores']));
  await waitFor(() => expect(document.activeElement).toBe(within(data()).getByRole('button', { name: 'Configure data' })));
});

/** Opens the column menu of a field in an open fields panel, then one of its first-level rows, then types a text and applies. */
async function rule(panel: HTMLElement, field: string, row: 'Filter' | 'Slice', value: string) {
  await userEvent.click(within(panel).getByRole('button', { name: new RegExp(`^Column menu .*${field}$`) }));
  const menu = await screen.findByRole('menu', { name: /^Menu of / });
  await userEvent.click(within(menu).getByRole('menuitem', { name: row }));
  const dialog = await screen.findByRole('dialog', { name: new RegExp(`^${row} of `) });
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'contains');
  await userEvent.type(within(dialog).getByLabelText('Value'), value);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
}
describe('a filter or slice from a data mart with no column joins it', () => {
  const filters = () => probe.state.grids.orders!.filters;
  const slices = () => probe.state.grids.orders!.slices ?? {};
  const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  const joinable = async () => {
    const orders = await openFields('Orders');
    await userEvent.click(within(orders).getByRole('menuitem', { name: 'Customers' }));
    return screen.findByRole('dialog', { name: 'Customers' });
  };

  test.each([['Filter', filters], ['Slice', slices]] as const)('a %s from a joinable data mart adds its column, and one Undo takes both back', async (row, rules) => {
    await setup([]);
    const before = [...columns()];
    await rule(await joinable(), 'city', row, 'K');
    await waitFor(() => expect(columns()).toContain('customers__city'));
    expect(Object.keys(rules())).toEqual(['customers__city']);
    await userEvent.keyboard('{Escape}{Escape}{Escape}');
    await undo();
    await waitFor(() => expect(columns()).toEqual(before));
    expect(rules()).toEqual({});
  });

  test.each([['Filter', filters], ['Slice', slices]] as const)('a %s from a path data mart adds its column too', async (row, rules) => {
    await setup(['customers__countries__name']);
    const menu = await openConfigMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Customers' }));
    const customers = await screen.findByRole('dialog', { name: 'Customers' });
    await rule(customers, 'city', row, 'K');
    await waitFor(() => expect(columns()).toContain('customers__city'));
    expect(Object.keys(rules())).toEqual(['customers__city']);
    await userEvent.keyboard('{Escape}{Escape}');
    await undo();
    await waitFor(() => expect(columns()).not.toContain('customers__city'));
    expect(rules()).toEqual({});
  });

  test('a filter on a hidden field of a data mart that is in the grid adds no column', async () => {
    await setup(['customers__name']);
    const before = [...columns()];
    const customers = await openFields('Customers');
    await rule(customers, 'city', 'Filter', 'K');
    await waitFor(() => expect(Object.keys(filters())).toEqual(['customers__city']));
    expect(columns()).toEqual(before);
  });

  test.each(['Filter', 'Slice'] as const)('clearing a %s on a field of a data mart with no column adds no column', async (row) => {
    await setup([]);
    const before = [...columns()];
    const customers = await joinable();
    await userEvent.click(within(customers).getByRole('button', { name: /^Column menu .*city$/ }));
    await userEvent.click(within(await screen.findByRole('menu', { name: /^Menu of / })).getByRole('menuitem', { name: row }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: new RegExp(`^${row} of `) })).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: new RegExp(`^${row} of `) })).toBeNull());
    expect(columns()).toEqual(before);
    expect(filters()).toEqual({});
    expect(slices()).toEqual({});
  });
});

describe('a joined data mart that loses its last column stays in the report', () => {
  const grid = () => probe.state.grids.orders!;
  const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  const clearCustomers = async () => {
    const panel = await openFields('Customers');
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
    return panel;
  };

  test('Clear keeps the mart with no column, its filter stays, and one Undo brings the column back', async () => {
    await setup(['customers__name']);
    const before = [...columns()];
    await rule(await openFields('Customers'), 'city', 'Filter', 'K');
    await waitFor(() => expect(Object.keys(grid().filters)).toEqual(['customers__city']));
    await userEvent.keyboard('{Escape}{Escape}');
    await clearCustomers();
    await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
    expect(grid().emptyPaths).toEqual(['customers']);
    expect(Object.keys(grid().filters)).toEqual(['customers__city']);
    await userEvent.keyboard('{Escape}{Escape}');
    await undo();
    await waitFor(() => expect(columns()).toEqual(before));
    expect(grid().emptyPaths).toBeUndefined();
    expect(Object.keys(grid().filters)).toEqual(['customers__city']);
  });

  test('an empty mart is listed with the report\'s marts, has Remove from report and no Unique Count row', async () => {
    await setup(['customers__name']);
    await clearCustomers();
    await userEvent.keyboard('{Escape}{Escape}');
    const menu = await openConfigMenu();
    expect(rowNames(menu)).toEqual(['Orders', 'Customers']);
    const panel = await openRow(menu, 'Customers');
    expect(within(panel).getByRole('menuitem', { name: 'Remove from report' })).toBeEnabled();
    expect(within(panel).queryByRole('option', { name: 'Unique Count' })).toBeNull();
  });

  test('a tick brings the mart back as a column and out of the empty paths', async () => {
    await setup(['customers__name']);
    const panel = await clearCustomers();
    await userEvent.click(within(panel).getByRole('option', { name: /^city/i }));
    await waitFor(() => expect(columns()).toContain('customers__city'));
    expect(grid().emptyPaths).toBeUndefined();
  });

  test('Remove right after Clear drops the mart and its filter: one Undo step per action', async () => {
    await setup(['customers__name']);
    const before = [...columns()];
    await rule(await openFields('Customers'), 'city', 'Filter', 'K');
    await waitFor(() => expect(Object.keys(grid().filters)).toEqual(['customers__city']));
    const panel = await clearCustomers();
    await waitFor(() => expect(grid().emptyPaths).toEqual(['customers']));
    await userEvent.click(within(panel).getByRole('menuitem', { name: 'Remove from report' }));
    await waitFor(() => expect(grid().emptyPaths).toBeUndefined());
    expect(grid().filters).toEqual({});
    await undo();
    await waitFor(() => expect(grid().emptyPaths).toEqual(['customers']));
    expect(Object.keys(grid().filters)).toEqual(['customers__city']);
    await undo();
    await waitFor(() => expect(columns()).toEqual(before));
    expect(grid().emptyPaths).toBeUndefined();
  });

  test('Hide column on the last column of a joined mart keeps the mart too', async () => {
    await setup(['customers__name']);
    const header = within(data()).getByRole('columnheader', { name: /name/i });
    await userEvent.click(within(header).getByRole('button', { name: /^Column menu / }));
    await userEvent.click(within(await screen.findByRole('menu', { name: /^Menu of / })).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
    expect(grid().emptyPaths).toEqual(['customers']);
  });

  test('a filter on a field of an empty mart adds no column', async () => {
    await setup(['customers__name']);
    const panel = await clearCustomers();
    const before = [...columns()];
    await rule(panel, 'city', 'Filter', 'K');
    await waitFor(() => expect(Object.keys(grid().filters)).toEqual(['customers__city']));
    expect(columns()).toEqual(before);
    expect(grid().emptyPaths).toEqual(['customers']);
  });

  test('its Unique Count goes with its last column', async () => {
    await setup(['customers__name']);
    probe.dispatch({ type: 'editGrid', martId: 'orders', grid: { ...grid(), uniqueCount: ['customers'] } });
    await waitFor(() => expect(grid().uniqueCount).toEqual(['customers']));
    await clearCustomers();
    await waitFor(() => expect(grid().emptyPaths).toEqual(['customers']));
    expect(grid().uniqueCount).toBeUndefined();
  });

  test('the chart menus list the fields of an empty mart', async () => {
    await setup(['customers__name']);
    await clearCustomers();
    await userEvent.keyboard('{Escape}{Escape}');
    await userEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
    await waitFor(() => expect(data().querySelector('section.dm-chart')).not.toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Pie options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
    const menu = await screen.findByRole('menu', { name: 'Dimension' });
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toContain('Customers');
  });
});
