import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRID_COLUMNS_COLLECTION } from '../../api/grid-columns';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { closeConfigMenu, openConfigMenu, openFields } from '../explorer/menu-test-utils';

/** The joined marts' reads wait for this while a test holds them (see `hold`). */
let held: Promise<void> = Promise.resolve();
/** Holds every read of the joined marts until the returned function is called. */
const hold = () => { let release!: () => void; held = new Promise<void>((r) => { release = r; }); return () => { release(); held = Promise.resolve(); }; };

function setup(opts: { gate?: Promise<void> } = {}) {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0, keyShown: true });
  const puts: { id: string; doc: { columns: string[]; picks?: Record<string, string[]> } }[] = [];
  const rows: { id: string; o: { sort?: unknown } }[] = [];
  const grouped: { id: string; o: { column?: string[]; uniqueCount?: string[] } }[] = [];
  const reads: string[] = [];
  const col = ctx.collections;
  const realGet = ctx.owox.getJson.bind(ctx.owox);
  const realTraverse = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
  const spied = {
    ...ctx,
    owox: {
      ...ctx.owox,
      getJson: (<T,>(path: string, q?: Record<string, string>) => {
        if (path.endsWith('/blendable-schema')) { reads.push(path); if (opts.gate) return opts.gate.then(() => realGet<T>(path, q)); return held.then(() => realGet<T>(path, q)); }
        return realGet<T>(path, q);
      }) as typeof ctx.owox.getJson,
      dataMarts: { ...ctx.owox.dataMarts, traverseData: (id: string, o: Parameters<typeof realTraverse>[1]) => { if (!(o as { uniqueCount?: unknown }).uniqueCount) rows.push({ id, o }); else grouped.push({ id, o: o as never }); return realTraverse(id, o); } },
    },
    collections: <T,>(name: string) => { const c = col<T>(name); return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { puts.push({ id, doc: d as never }); return c.put(id, d); } } : c; } };
  render(<AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices>);
  return { puts, rows, reads, grouped };
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const marts = () => document.getElementById('band-marts')!;
const card = (title: string) => within(marts()).getByText(title).closest('article')!;
const title = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.querySelector('.truncate')!.textContent!).join(' + ');
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.querySelector('.truncate')!.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
// A card just added is focused, so the others are dimmed: the focus is let go before the next click.
const click = async (name: string) => { await within(marts()).findByText(name); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(card(name)); };
/** The × on a joined card: the only way a card takes a mart out. */
const remove = async (name: string) => { await userEvent.click(within(card(name)).getByRole('button', { name: `Remove ${name} from the report` })); };
/** Remove from report, in the data mart's panel of the config menu. */
const removeFromReport = async (name: string) => { const panel = await openFields(name); await userEvent.click(within(panel).getByRole('menuitem', { name: 'Remove from report' })); };
const configButton = () => within(data()).getByRole('button', { name: 'Configure data' });
const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));

test('selecting a joinable data mart adds its Unique Count alone (no dimension), titles the grid "Orders + Customers" and the card looks like the main one', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  expect(headers()).toHaveLength(6);
  expect(headers().at(-1)).toMatch(/^Unique Count/);
  expect(headers().some((h) => /^name/.test(h))).toBe(false);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
  expect(card('Orders')).toHaveAttribute('aria-pressed', 'true');
  expect(within(card('Customers')).queryByRole('note', { name: 'Joined' })).toBeNull();
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
});

test('the × on a joined card takes its columns out, and selecting it again brings back the same fields', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  // choose another field of Customers in the picker
  await openFields('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await closeConfigMenu();
  await remove('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(title()).toBe('Orders');
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'false');
  await click('Customers');
  // It comes back with what it showed: email and its Unique Count.
  await waitFor(() => expect(headers()).toHaveLength(7));
  expect(within(data()).getAllByRole('button', { name: /^Sort by Customers · / })).toHaveLength(2);
  await waitFor(() => expect(t.puts.some((p) => p.id === 'customers' && JSON.stringify(p.doc).includes('"lastShown":["email","$unique_count"]'))).toBe(true), { timeout: 3000 });
});

test('a joined mart\'s filters and sorts leave with it', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Customers · .*, currently not sorted/i }));
  await waitFor(() => expect(within(data()).getByRole('button', { name: /^Sort by Customers · .*ascending/i })).toBeInTheDocument());
  await remove('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(within(data()).queryByRole('button', { name: /Customers ·/ })).toBeNull();
});

test('taking the main group out promotes the next joined mart, which brings the others it can join', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await click('Stores');
  await waitFor(() => expect(title()).toBe('Orders + Customers + Stores'));
  await removeFromReport('Orders');
  // Customers cannot join Stores (it has only Countries), so only Customers is left.
  await waitFor(() => expect(title()).toBe('Customers'));
  expect(headers().some((h) => /Stores/.test(h))).toBe(false);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
});

test('the header\'s make-main button makes the selected joined mart the main one, and Undo takes it back in one step', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  expect(within(card('Customers')).queryByRole('button', { name: /make main/i })).toBeNull();
  await userEvent.click(await screen.findByRole('button', { name: /^Make it main: / }));
  await waitFor(() => expect(groupTitles()[0]).toBe('Customers'));
  expect(title()).toBe('Customers');
  // The old main leaves the band once the card animation ends.
  await waitFor(() => expect(marts().querySelector('article')).toBe(card('Customers')));
  await undo();
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
});

test('the make-main button is only there while a joined card is selected, in Grid and in Graph', async () => {
  setup();
  await ready();
  const button = () => screen.queryByRole('button', { name: /^Make it main: / });
  expect(button()).toBeNull();
  await click('Customers');
  await waitFor(() => expect(button()).not.toBeNull());
  // Only the selected card has the data-focused mark that gives it the 2px border.
  expect(card('Customers')).toHaveAttribute('data-focused');
  expect(marts().querySelectorAll('[data-focused]')).toHaveLength(1);
  // The main card selected: it is already main, so there is nothing to offer.
  fireEvent.click(card('Orders'));
  await waitFor(() => expect(button()).toBeNull());
  expect(card('Orders')).toHaveAttribute('data-focused');
  expect(marts().querySelectorAll('[data-focused]')).toHaveLength(1);
  // Graph: the pinned card is the selected one.
  await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Show data marts as' })).getByRole('radio', { name: 'Graph' }));
  const node = await screen.findByTestId('marts-canvas');
  expect(button()).toBeNull();
  const customers = within(node).getByText('Customers').closest('article')!;
  fireEvent.click(customers);
  await waitFor(() => expect(button()).not.toBeNull());
  expect(node.querySelectorAll('[data-focused]')).toHaveLength(1);
  await userEvent.click(button()!);
  await waitFor(() => expect(button()).toBeNull());
});

test('with Orders main, the band lists the marts it can join at any depth, and not Order Items', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Countries');
  await within(marts()).findByText('Categories');
  expect(within(marts()).queryByText('Order Items')).toBeNull();
  expect(marts().querySelector('article')).toBe(card('Orders'));
});

test('a click on the main card does not deselect it, even with nothing joined', async () => {
  setup();
  await ready();
  await userEvent.click(within(data()).getAllByRole('row')[2]!);
  await within(row()).findByRole('heading', { name: /^Orders · / });
  await click('Orders');
  await new Promise((r) => setTimeout(r, 200));
  expect(within(data()).queryByText('Select a data mart.')).toBeNull();
  expect(card('Orders')).toHaveAttribute('aria-pressed', 'true');
  expect(within(row()).getByRole('heading', { name: /^Orders · / })).toBeInTheDocument();
});

test('Undo takes back the join, and Redo applies it again', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await undo();
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(title()).toBe('Orders');
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(headers()).toHaveLength(6));
  expect(title()).toBe('Orders + Customers');
});

test('unticking the last field of a joined mart in the picker keeps it selected with no column; Remove from report deselects it; ticking a field of another mart selects it', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await openFields('Customers');
  const group = await screen.findByRole('dialog');
  await userEvent.click(within(group).getByRole('option', { selected: true }));
  // The mart leaves the grid's columns at once and stays in the report: its card stays selected, also after the menu closes.
  await waitFor(() => expect(title()).toBe('Orders'));
  expect(headers()).toHaveLength(5);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
  await closeConfigMenu();
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
  const menu = await openConfigMenu();
  expect(within(menu).getByRole('menuitem', { name: 'Customers' })).toBeInTheDocument();
  await closeConfigMenu();
  await removeFromReport('Customers');
  await waitFor(() => expect(card('Customers')).toHaveAttribute('aria-pressed', 'false'));
  // another mart is added from its card, not from a picker
  await click('Stores');
  await waitFor(() => expect(title()).toBe('Orders + Stores'));
});

test('a joined mart that is not a neighbour is still shown, and the main card stays first', async () => {
  setup();
  await ready();
  await click('Products');
  await waitFor(() => expect(title()).toBe('Orders + Products'));
  const names = [...marts().querySelectorAll('article .dm-node-title')].map((e) => e.textContent);
  expect(names.slice(0, 2)).toEqual(['Orders', 'Products']);
});

test('promoting back to Orders leaves it alone: the joined columns it was left with are taken out', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await removeFromReport('Orders');
  await waitFor(() => expect(title()).toBe('Customers'));
  // Customers cannot join Orders, so a click on Orders would do nothing: it is reached through its Data Source, which leaves no main mart to join.
  fireEvent.click(within(document.getElementById('band-sources')!).getByText('Shopify').closest('article')!);
  await click('Orders');
  await waitFor(() => expect(title()).toBe('Orders'));
  expect(headers()).toHaveLength(5);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'false');
});

test('two quick clicks while the joined marts are still being read both join, and both are saved', async () => {
  let release: () => void = () => undefined;
  const t = setup({ gate: new Promise<void>((r) => { release = r; }) });
  await ready();
  await within(marts()).findByText('Stores');
  fireEvent.click(card('Customers'));
  fireEvent.click(card('Stores'));
  release();
  await waitFor(() => expect(title()).toBe('Orders + Customers + Stores'));
  await waitFor(() => expect(headers().filter((h) => /^Unique Count/.test(h))).toHaveLength(2));
  const saved = () => (t.puts.filter((p) => p.id === 'orders').at(-1)?.doc as { gridView?: { uc?: string[]; ep?: string[] } } | undefined)?.gridView;
  await waitFor(() => expect(saved()?.uc).toEqual(expect.arrayContaining(['customers', 'stores'])), { timeout: 3000 });
  expect(saved()?.ep).toEqual(expect.arrayContaining(['customers', 'stores']));
});

test('Undo of a card click is saved too: the last saved columns have no Customers column', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await undo();
  await waitFor(() => expect(headers()).toHaveLength(5));
  await waitFor(() => expect(t.puts.at(-1)?.doc.columns.some((c) => c.startsWith('customers__'))).toBe(false), { timeout: 3000 });
});

test('adding a mart reads the rows once, taking it out reads none, and each mart is asked for its joins once', async () => {
  const t = setup();
  await ready();
  await new Promise((r) => setTimeout(r, 150));
  const before = t.grouped.length;
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await new Promise((r) => setTimeout(r, 200));
  // The mart joins with its Unique Count, so the grid reads once, grouped by the main mart's own columns.
  expect(t.grouped.slice(before).filter((r) => r.id === 'orders' && r.o.column?.length && r.o.uniqueCount?.includes('customers'))).toHaveLength(1);
  const afterAdd = t.rows.length;
  const groupedAfterAdd = t.grouped.length;
  await remove('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  await new Promise((r) => setTimeout(r, 200));
  expect(t.rows).toHaveLength(afterAdd);
  expect(t.grouped).toHaveLength(groupedAfterAdd);
  expect(t.reads.filter((p) => p.includes('/orders/'))).toHaveLength(1);
});

test('what a removed mart showed is saved exactly: the fields, in the order shown', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await openFields('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await closeConfigMenu();
  await remove('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  await waitFor(() => expect(t.puts.some((p) => p.id === 'customers' && JSON.stringify(p.doc).includes('"lastShown":["email","$unique_count"]'))).toBe(true), { timeout: 3000 });
});

const groupRow = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup');

test('the main mart alone has one tab spanning all its columns, with no Remove from report; a joined mart adds one tab per mart, main first', async () => {
  setup();
  await ready();
  expect(groupTitles()).toEqual(['Orders']);
  expect(groupRow()[0]!.getAttribute('colspan')).toBe('5');
  expect(within(await openFields('Orders')).queryByRole('menuitem', { name: 'Remove from report' })).toBeNull();
  expect(configButton()).toBeInTheDocument();
  await closeConfigMenu();
  await click('Customers');
  await waitFor(() => expect(groupRow()).toHaveLength(2));
  expect(groupTitles()).toEqual(['Orders', 'Customers']);
  expect(groupRow().map((h) => h.getAttribute('colspan'))).toEqual(['5', '1']);
  // the group row sits above the title row, and only the title row carries the header line
  const [first, second] = data().querySelectorAll('thead tr:not([data-chrome])');
  expect(first).toHaveAttribute('data-group-row');
  expect(second!.querySelector('th.dm-th')).not.toBeNull();
  expect(first!.querySelector('th.dm-th')).toBeNull();
  // inside a group the title drops the mart prefix, the control names keep it
  expect(headers()).not.toContain('Customers · name');
  expect(within(data()).getByRole('button', { name: /^Sort by Customers · /i })).toBeInTheDocument();
});

test('a column ticked for the main mart after a joined one stays in the main group', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await openFields('Orders');
  await userEvent.click(await screen.findByRole('option', { name: /amount/i }));
  await waitFor(() => expect(headers()).toHaveLength(7));
  expect(headers().indexOf('Amount')).toBeLessThan(6);
  expect(groupRow().map((h) => h.getAttribute('colspan'))).toEqual(['6', '1']);
});

test('Remove from report on a joined data mart takes its path out, and Undo brings it back', async () => {
  setup();
  await ready();
  await click('Customers');
  await click('Products');
  await waitFor(() => expect(title()).toBe('Orders + Customers + Products'));
  expect(groupTitles()).toEqual(['Orders', 'Customers', 'Products']);
  await removeFromReport('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Products'));
  expect(groupTitles()).toEqual(['Orders', 'Products']);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'false');
  await undo();
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Products']));
});

test('Remove from report on the main mart deselects it and promotes the next selected mart, whose group is first', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await removeFromReport('Orders');
  await waitFor(() => expect(title()).toBe('Customers'));
  expect(groupTitles()).toEqual(['Customers']);
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
});

test('the last own column of the main mart can be unticked while a joined mart is shown: the main mart stays in the report with none', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  // The grid keeps a column: Customers has one of its own besides its Unique Count, so the main mart's last one can go.
  await openFields('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await closeConfigMenu();
  await openFields('Orders');
  for (const label of ['id', 'Customer', 'Product', 'Store']) await userEvent.click(await screen.findByLabelText(label));
  const first = () => headers().map((h) => h.replace(/\s.*$/, ''));
  await waitFor(() => expect(first()).toEqual(['status', 'email', 'Unique']));
  expect(screen.getByRole('option', { name: 'status' })).not.toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(screen.getByRole('option', { name: 'status' }));
  await waitFor(() => expect(first()).toEqual(['email', 'Unique']));
  expect(groupTitles()).toEqual(['Customers']);
  expect(screen.getByRole('menuitem', { name: 'Orders' })).toBeInTheDocument();
  expect(card('Orders')).toHaveClass('lit');
});

test('a mart reachable through a joined mart is listed from the start and lights like its neighbour once that mart is joined', async () => {
  setup();
  await ready();
  // Orders reaches Countries through Customers, so the band lists it before Customers is joined, unlit.
  await within(marts()).findByText('Countries');
  expect(card('Countries')).not.toHaveClass('lit');
  await click('Customers');
  await waitFor(() => expect(card('Countries')).toHaveClass('lit'));
  // Sessions hangs off Customers but the main mart cannot join it, so the band does not list it.
  expect(within(marts()).queryByText('Sessions')).toBeNull();
  await remove('Customers');
  await waitFor(() => expect(card('Countries')).not.toHaveClass('lit'));
  expect(within(marts()).getByText('Countries')).toBeInTheDocument();
});

test('a mart that leaves the grid remembers its own field names in its own grid-columns document', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await openFields('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await closeConfigMenu();
  // Customers leaves the grid
  await remove('Customers');
  await waitFor(() => expect(title()).toBe('Orders'));
  await waitFor(() => expect(t.puts.some((p) => p.id === 'customers' && JSON.stringify(p.doc).includes('"lastShown":["email","$unique_count"]'))).toBe(true), { timeout: 3000 });
});

test('a double activation of Remove from report takes the mart out once and never puts it back', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  // The menu closes on the first activation, so a second one has nothing left to hit; both are sent all the same.
  const x = within(await openFields('Customers')).getByRole('menuitem', { name: 'Remove from report' });
  fireEvent.click(x);
  fireEvent.click(x);
  await waitFor(() => expect(title()).toBe('Orders'));
  await new Promise((r) => setTimeout(r, 300));
  expect(title()).toBe('Orders');
  expect(groupTitles()).toEqual(['Orders']);
});

test('while a removal is being applied, Remove from report is off in the reopened menu', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  // Refresh forgets the joined marts, so the removal has to read them again, and that read is held.
  const release = hold();
  try {
    await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
    await userEvent.click(within(await openFields('Customers')).getByRole('menuitem', { name: 'Remove from report' }));
    // The removal waits for its reads: the mart is still on the grid, and a second Remove cannot be sent.
    const again = within(await openFields('Customers')).getByRole('menuitem', { name: 'Remove from report' });
    expect(again).toBeDisabled();
  } finally { release(); }
  await waitFor(() => expect(title()).toBe('Orders'));
  expect(groupTitles()).toEqual(['Orders']);
});

test('a double activation of Remove from report on the main mart promotes once; the promoted mart is not removed as well', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  const x = within(await openFields('Orders')).getByRole('menuitem', { name: 'Remove from report' });
  fireEvent.click(x);
  fireEvent.click(x);
  await waitFor(() => expect(title()).toBe('Customers'));
  await new Promise((r) => setTimeout(r, 300));
  expect(title()).toBe('Customers');
});

test('after a data mart is removed, focus is on the config button', async () => {
  setup();
  await ready();
  await click('Customers');
  await click('Products');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Products']));
  await removeFromReport('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Products']));
  await waitFor(() => expect(document.activeElement).toBe(configButton()));
});

test('picking a source saves what the main and its joined marts were showing, like a card click', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  // Customers shows a column of its own, so it has something to remember.
  await openFields('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await closeConfigMenu();
  fireEvent.click(within(document.getElementById('band-sources')!).getByText('Google Analytics 4').closest('article')!);
  await waitFor(() => expect(t.puts.some((p) => p.id === 'customers' && JSON.stringify(p.doc).includes('"lastShown"'))).toBe(true), { timeout: 3000 });
  await waitFor(() => expect(t.puts.some((p) => p.id === 'orders' && JSON.stringify(p.doc).includes('"lastShown"'))).toBe(true), { timeout: 3000 });
});

test('after the main data mart is removed, focus is on the config button of the new main grid', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers']));
  await removeFromReport('Orders');
  await waitFor(() => expect(title()).toBe('Customers'));
  await waitFor(() => expect(document.activeElement).toBe(configButton()));
});
