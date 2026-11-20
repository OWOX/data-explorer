import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { createFakeAi } from '../../sdk/mock/ai';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { decodeViewLink } from '../../state/view-link';
import { App } from '../App';

type Mock = ReturnType<typeof createMockCtx>;

// A loaded CI runner must not turn a slow model into a timeout, so the AI budget is large unless a test is about the timeout.
function setup(opts: { ai?: boolean; wrap?: (ctx: Mock) => Ctx; ctx?: Ctx; aiTimeoutMs?: number } = {}) {
  const ctx = opts.ctx ?? (opts.wrap ?? ((c: Mock): Ctx => c))(createMockCtx(demoFixtures(), { latencyMs: 0, ai: opts.ai }));
  const view = () => render(<AppServices ctx={ctx} aiTimeoutMs={opts.aiTimeoutMs ?? 60_000}><StoreProvider><App /></StoreProvider></AppServices>);
  return { ctx, view };
}
const band = (id: string) => document.getElementById(id)!;
const data = () => band('band-data');
const marts = () => band('band-marts');
const headings = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!).join(' + ');
const cardTitles = () => [...marts().querySelectorAll('article .dm-node-title')].map((t) => t.textContent!);
const ready = async () => {
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());
  await within(data()).findByRole('table');
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
};
const openSearch = async () => { await userEvent.click(screen.getByRole('button', { name: 'Search data marts' })); return screen.getByRole('combobox', { name: 'Search data marts' }); };
const search = async (q: string) => { const box = await openSearch(); await userEvent.type(box, `${q}{Enter}`); };
const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
const Z = (title: string) => within(marts()).getByText(title).closest('article')!;

describe('the search box', () => {
  test('lives in the page header, left of Undo, Redo and Copy link, not in the Data Marts band', async () => {
    setup().view();
    await ready();
    const header = document.querySelector('header.dm-page-header') as HTMLElement;
    const names = within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.slice(0, 3)).toEqual(['Search data marts', 'Undo', 'Redo']);
    expect(within(marts()).queryByRole('button', { name: 'Search data marts' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
    expect(within(header).getByRole('combobox', { name: 'Search data marts' })).toBeInTheDocument();
    expect(within(marts()).queryByRole('combobox')).toBeNull();
    expect(within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label')).indexOf('Undo')).toBeGreaterThan(0);
  });

  test('is an icon button; clicking opens an input with a go button, Escape closes it and nothing is applied', async () => {
    setup().view();
    await ready();
    expect(screen.queryByRole('combobox')).toBeNull();
    const box = await openSearch();
    expect(box).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await userEvent.type(box, 'ord');
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    // the first Escape closes the dropdown, the second the box
    await userEvent.keyboard('{Escape}{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    // nothing was run: the band is as it was, and the icon is back
    expect(screen.getByRole('button', { name: 'Search data marts' })).toBeInTheDocument();
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
  });

  test('opens from the keyboard', async () => {
    setup().view();
    await ready();
    screen.getByRole('button', { name: 'Search data marts' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Search data marts' })).toHaveFocus();
  });

  test('go is off while the box is empty, the input stops at the backend limit of 256, and one character is a title match with no search call', async () => {
    const t = setup();
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    const box = await openSearch();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(box).toHaveAttribute('maxlength', '256');
    await userEvent.type(box, 'p{Enter}');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith('/api/search', expect.anything());
  });

  test('typing GA4 still lists every mart with that title after the found ones', async () => {
    const fx = demoFixtures();
    fx.marts.find((m) => m.id === 'sessions')!.title = 'Sessions GA4';
    fx.marts.find((m) => m.id === 'campaigns')!.title = 'Campaigns GA4';
    const ctx = createMockCtx(fx, { latencyMs: 0, ai: false });
    setup({ ctx }).view();
    await ready();
    await search('ga4');
    await waitFor(() => expect(cardTitles()).toEqual(expect.arrayContaining(['Sessions GA4', 'Campaigns GA4'])));
  });

  test('Enter and the go button both run the search; the query stays on screen with an x that clears it and restores the band', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.getByRole('combobox', { name: 'Search data marts' })).toHaveValue('customers');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('combobox', { name: 'Search data marts' })).toHaveValue('');
    // the band shows the main mart's neighbours again
    expect(await within(marts()).findByText('Orders')).toBeInTheDocument();
    const box = screen.getByRole('combobox', { name: 'Search data marts' });
    await userEvent.type(box, 'products');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(headings()).toBe('Products'));
  });

  test('Escape after a search closes the box but keeps the applied query visible, with its x', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search data marts: customers' })).toHaveTextContent('customers');
    expect(headings()).toBe('Customers');
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts: customers' }));
    expect(screen.getByRole('combobox')).toHaveValue('customers');
  });
});

describe('the pipeline', () => {
  test('the OWOX search ranks the marts: they show first, in rank order, five at most, and the best becomes the main mart', async () => {
    const t = setup({ ai: false });
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    await search('orders');
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(spy).toHaveBeenCalledWith('/api/search', { q: 'orders', entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: '20' });
    // the engine ranks a title hit above a description hit (the mock scores a title word 20, a description word 8); cards that leave are gone once their transition ends
    await waitFor(() => expect(cardTitles()).toHaveLength(5));
    expect(cardTitles()).toEqual(['Orders', 'Order Items', 'Customers', 'Returns', 'Payments']);
    await waitFor(() => expect(within(marts()).queryByText('Stores')).toBeNull());
    expect(Z('Orders')).toHaveAttribute('aria-pressed', 'true');
  });

  test('an empty endpoint goes to the AI, which finds the marts by meaning; the best becomes the main mart', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await waitFor(() => expect(within(marts()).queryByText('Stores')).toBeNull());
    expect(within(marts()).queryByText(/No data marts match/)).toBeNull();
  });

  test('the AI sets up the best mart view: its filters are applied, validated, and the grid loads with them', async () => {
    const t = setup({});
    const rows: unknown[] = [];
    const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
    vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { rows.push({ id, o }); return real(id, o); });
    t.view();
    await ready();
    await search('paid orders last month');
    await waitFor(() => expect(within(data()).getByLabelText('Filter created_at')).toHaveClass('dm-ctl-on'));
    expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on');
    // rows arrive through the normal grid load, with the filters on the query
    await waitFor(() => expect(rows.some((r) => JSON.stringify(r).includes('relative_date') && JSON.stringify(r).includes('"paid"'))).toBe(true));
  });

  test('a view the AI got wrong in parts keeps the good parts: unknown fields and operators are dropped', async () => {
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: (() => {
      const m = { doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify({ columns: ['id', 'ghost', 'status'], filters: [{ field: 'ghost', op: 'eq', value: 1 }, { field: 'status', op: 'gt', value: 'x' }, { field: 'status', op: 'eq', value: 'paid' }] }) }] }) };
      return { ...m, fast: m, reasoning: m };
    })() } }) });
    t.view();
    await ready();
    await search('orders please');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    expect(within(data()).queryByLabelText('Filter ghost')).toBeNull();
  });

  test('the whole result is one Undo step: the main mart and its filters come back together', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await undo();
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('one Undo takes the AI filters off the same mart too', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('paid orders last month');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    await undo();
    await waitFor(() => expect(within(data()).queryByLabelText('Filter status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('nothing found anywhere says so and falls back to the title match', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
    expect(headings()).toBe('Orders');
    // the title match found nothing, so only the selected mart stays
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
  });

  test('a failing endpoint does not show an error: the AI answers, or the title match does', async () => {
    const t = setup({ wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => (path === '/api/search' ? Promise.reject(new Error('503')) : c.owox.getJson(path, q))) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a model that never answers is treated as no AI for that run: the endpoint result shows, no error, no hint', async () => {
    const hang = { doGenerate: () => new Promise<never>(() => {}) };
    const t = setup({ aiTimeoutMs: 300, wrap: (c) => ({ ...c, credentials: { ai: { ...hang, fast: hang, reasoning: hang } } }) });
    t.view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
  });

  test('a new search while one runs cancels the first', async () => {
    let first: AbortSignal | undefined;
    const slow = { doGenerate: (o: { abortSignal?: AbortSignal }) => { first ??= o.abortSignal; return new Promise<never>(() => {}); } };
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: { ...slow, fast: slow, reasoning: slow } } }) });
    t.view();
    await ready();
    const box = await openSearch();
    await userEvent.type(box, 'customers{Enter}');
    await waitFor(() => expect(first).toBeDefined());
    // go stays enabled while a search runs: a new query cancels it
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    await userEvent.clear(box);
    await userEvent.type(box, 'products{Enter}');
    await waitFor(() => expect(first!.aborted).toBe(true));
  });
});

describe('no AI configured', () => {
  test('the endpoint result alone, no error, and a quiet hint that can be dismissed and stays dismissed', async () => {
    const t = setup({ ai: false });
    const first = t.view();
    await ready();
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    const hint = screen.getByRole('note', { name: 'AI search hint' });
    expect(hint).toHaveTextContent("Connect AI in this plugin's settings to also find data marts by meaning and apply filters.");
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(within(hint).getByRole('button', { name: 'Dismiss the AI hint' }));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    // remembered: a new page load on the same project does not bring it back
    first.unmount();
    t.view();
    await ready();
    await search('products');
    await waitFor(() => expect(headings()).toBe('Products'));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    expect((await t.ctx.collections<{ aiHintDismissed: boolean }>('preferences').get('search'))?.document).toEqual({ aiHintDismissed: true });
  });

  test('with AI configured the hint never shows', async () => {
    setup({}).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
  });

  test('nothing found without AI says "No data marts match."', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
  });
});

test('the search itself never reads rows: only the grid load after applying does', async () => {
  const t = setup({});
  const reads: string[] = [];
  const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
  vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { reads.push(id); return real(id, o); });
  t.view();
  await ready();
  const before = reads.length;
  fireEvent.click(await openSearch());
  await userEvent.type(screen.getByRole('combobox', { name: 'Search data marts' }), 'who are our buyers{Enter}');
  await waitFor(() => expect(headings()).toBe('Customers'));
  await waitFor(() => expect(reads.slice(before).every((id) => id === 'customers' || id === 'orders')).toBe(true));
  expect(reads.slice(before).filter((id) => id !== 'customers')).toEqual([]);
});

test('the copied link carries the found marts, so opening it does not filter titles by the question', async () => {
  setup({ ai: false }).view();
  await ready();
  await search('paid orders last month');
  await waitFor(() => expect(headings()).toBe('Orders'));
  await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
  await waitFor(() => expect(window.__copiedLink).toBeDefined());
  const view = await decodeViewLink(window.__copiedLink!);
  expect(typeof view).toBe('object');
  expect((view as { found: string[] }).found[0]).toBe('orders');
  expect((view as { found: string[] }).found.length).toBeGreaterThan(1);
});

test('submitting the query that is already running changes nothing: no restart, no second AI call', async () => {
  let calls = 0;
  const slow = { doGenerate: () => { calls += 1; return new Promise<never>(() => {}); } };
  const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: { ...slow, fast: slow, reasoning: slow } } }) });
  const gets = vi.spyOn(t.ctx.owox, 'getJson');
  t.view();
  await ready();
  const box = await openSearch();
  await userEvent.type(box, 'customers{Enter}');
  await waitFor(() => expect(calls).toBe(1));
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await userEvent.type(box, '{Enter}');
  expect(calls).toBe(1);
  expect(gets.mock.calls.filter(([p]) => p === '/api/search')).toHaveLength(1);
});


type Gen = { doGenerate: (o: { prompt: { role: string; content: unknown }[] }) => Promise<unknown> };
/** The fake AI, recording which question each call is; `gate` can hold or fail one. */
function spyAi(gate?: (task: string) => Promise<void>) {
  const base = createFakeAi() as unknown as Gen & { fast: Gen; reasoning: Gen };
  const tasks: string[] = [];
  const wrap = (m: Gen): Gen => ({ ...m, doGenerate: async (o) => {
    const user = o.prompt.find((p) => p.role === 'user')!.content as { text: string }[];
    const task = (JSON.parse(user.map((c) => c.text).join('')) as { task: string }).task;
    tasks.push(task);
    await gate?.(task);
    return m.doGenerate(o);
  } });
  return { tasks, withAi: (c: Mock): Ctx => ({ ...c, credentials: { ai: { ...wrap(base), fast: wrap(base.fast), reasoning: wrap(base.reasoning) } } as unknown as Ctx['credentials'] }) };
}

describe('the dropdown', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });
  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
  const options = () => within(screen.getByRole('listbox', { name: 'Search results' })).getAllByRole('option');
  const rowsText = () => options().map((o) => o.textContent!);
  const typeIn = async (u: ReturnType<typeof user>, q: string) => {
    await u.click(screen.getByRole('button', { name: 'Search data marts' }));
    const box = screen.getByRole('combobox', { name: 'Search data marts' });
    await u.type(box, q);
    await settle();
    return box;
  };

  test('typing shows report rows, then mart rows, then the ad-hoc row, with at most three contexts as "A, B & C"', async () => {
    const fx = demoFixtures();
    fx.contexts.push({ id: 'c-extra', name: 'Extra', description: null, icon: null });
    fx.marts.find((m) => m.id === 'orders')!.contexts = ['c-sales', 'c-catalog', 'c-marketing', 'c-extra'];
    setup({ ctx: createMockCtx(fx, { latencyMs: 0, ai: false }) }).view();
    await ready();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Search data marts' }));
    await u.type(screen.getByRole('combobox'), 'orders');
    // nothing is searched before the pause: only the pending ad-hoc row shows
    expect(options()).toHaveLength(1);
    await settle();
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    const rows = rowsText();
    const isReport = (o: HTMLElement) => !!o.querySelector('.lucide-file-spreadsheet');
    const reports = options().filter(isReport);
    expect(options().slice(0, reports.length)).toEqual(reports);
    expect(reports[0]).toHaveTextContent('Paid orders by monthofOrdersfromSales, Catalog & Marketing');
    expect(reports[0]).not.toHaveTextContent('Extra');
    const marts = options().slice(reports.length, -1);
    expect(marts.length).toBeGreaterThan(0);
    expect(marts[0]).toHaveTextContent(/^OrdersfromSales, Catalog & Marketing$/);
    expect(rows.at(-1)).toMatch(/^Ad-hoc report forOrdersfromSales, Catalog & Marketingwithfilters$/);
  });

  test('under two characters only a disabled ad-hoc row shows, and no search call is made', async () => {
    const t = setup({ ai: false });
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    await typeIn(user(), 'o');
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveAttribute('aria-disabled', 'true');
    expect(options()[0]).toHaveTextContent('Type at least 2 characters');
    expect(spy).not.toHaveBeenCalledWith('/api/search', expect.anything());
  });

  test("a slow first query that resolves after a second one does not replace the second query's rows", async () => {
    let release: (() => void) | undefined;
    const t = setup({ ai: false, wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => {
      if (path === '/api/search' && q?.q === 'customers') return new Promise((res) => { release = () => res(c.owox.getJson(path, q)); });
      return c.owox.getJson(path, q);
    }) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    const u = user();
    const box = await typeIn(u, 'customers');
    await waitFor(() => expect(release).toBeDefined());
    await u.clear(box);
    await u.type(box, 'products');
    await settle();
    await waitFor(() => expect(rowsText().some((r) => r.startsWith('Products'))).toBe(true));
    const before = rowsText();
    release!();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(rowsText()).toEqual(before);
    expect(rowsText().some((r) => r.startsWith('Customers'))).toBe(false);
  });

  test('without a pick the AI model is asked only to discover: no fields question and no filters question', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    await typeIn(user(), 'paid orders last month');
    await waitFor(() => expect(ai.tasks).toContain('discover'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(ai.tasks.every((x) => x === 'discover')).toBe(true);
  });

  test('Enter with nothing highlighted runs the ad-hoc row: the mart becomes main, the AI grid is saved, and one Undo goes back', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'daily kpis last month');
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Daily KPIs/));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(headings()).toBe('Daily KPIs'));
    await waitFor(() => expect(data().querySelector('.dm-ctl-on')).not.toBeNull());
    expect(ai.tasks).toEqual(['discover', 'fields', 'filters']);
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    await undo();
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('a grid edit made before the AI answers keeps the edit', async () => {
    let answer: (() => void) | undefined;
    const ai = spyAi((task) => (task === 'fields' ? new Promise<void>((r) => { answer = r; }) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'paid orders last month');
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Orders/));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(answer).toBeDefined());
    await u.click(within(data()).getByRole('button', { name: /^Sort by status/ }));
    expect(within(data()).getByRole('button', { name: /^Sort by status, currently (ascending|descending)/ })).toBeInTheDocument();
    answer!();
    await waitFor(() => expect(ai.tasks).toContain('filters'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(within(data()).queryByLabelText('Filter status')).toBeNull();
    expect(within(data()).getByRole('button', { name: /^Sort by status, currently (ascending|descending)/ })).toBeInTheDocument();
  });

  test('a model that fails when the ad-hoc row is picked leaves the default view and says so', async () => {
    const ai = spyAi((task) => (task === 'fields' ? Promise.reject(new Error('boom')) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'who are our buyers');
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Customers/));
    await u.keyboard('{Enter}');
    expect(await screen.findByRole('status', { name: 'Search notice' })).toHaveTextContent("AI couldn't set up the view. Showing the default view.");
    expect(headings()).toBe('Customers');
    await u.click(screen.getByRole('button', { name: 'Dismiss the notice' }));
    expect(screen.queryByRole('status', { name: 'Search notice' })).toBeNull();
  });

  test('the arrows move the highlight, skip a disabled row and wrap; Enter on a report loads it, and one Undo reverts', async () => {
    const t = setup({ ai: false });
    const reads: string[] = [];
    const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
    vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { reads.push(JSON.stringify(o)); return real(id, o); });
    t.view();
    await ready();
    const u = user();
    const box = await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    expect(box).toHaveAttribute('role', 'combobox');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-autocomplete', 'list');
    expect(box).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'Search results' }).id);
    expect(box).not.toHaveAttribute('aria-activedescendant');
    await u.keyboard('{ArrowDown}');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    await u.keyboard('{ArrowUp}');
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true');
    await u.keyboard('{ArrowDown}');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    await u.keyboard('{Enter}');
    await waitFor(() => expect(reads.some((r) => r.includes('"paid"'))).toBe(true));
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    expect(reads.some((r) => r.includes('"paid"'))).toBe(true);
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Search notice' })).toBeNull();
    await undo();
    await waitFor(() => expect(within(data()).queryByLabelText('Filter status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('a report with parts the explorer cannot show says which parts were left out', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await typeIn(u, 'extras');
    await waitFor(() => expect(rowsText().some((r) => r.startsWith('Orders with extras'))).toBe(true));
    await u.click(options().find((o) => o.textContent!.startsWith('Orders with extras'))!);
    expect(await screen.findByRole('status', { name: 'Search notice' })).toHaveTextContent("Some parts of this report aren't shown: 1 slice, 1 HAVING filter, unique count.");
    // a new search clears it
    await u.type(screen.getByRole('combobox'), 'x');
    expect(screen.queryByRole('status', { name: 'Search notice' })).toBeNull();
  });

  test('a report that cannot be loaded says so and leaves the selection alone', async () => {
    const t = setup({ ai: false, wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => (path.startsWith('/api/reports/') ? Promise.reject(new Error('500')) : c.owox.getJson(path, q))) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    const u = user();
    await typeIn(u, 'campaign');
    await waitFor(() => expect(rowsText().some((r) => r.startsWith('Campaign spend'))).toBe(true));
    await u.click(options().find((o) => o.textContent!.startsWith('Campaign spend'))!);
    expect(await screen.findByRole('status', { name: 'Search notice' })).toHaveTextContent("This report couldn't be opened.");
    expect(headings()).toBe('Orders');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('picking a mart row selects it and makes no AI call beyond discovery', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'customers');
    await waitFor(() => expect(ai.tasks).toEqual(['discover']));
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Customers/));
    await u.click(options().find((o) => o.textContent!.startsWith('Customers'))!);
    await waitFor(() => expect(headings()).toBe('Customers'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // the number-format picker may ask its own question; the view questions never run
    expect(ai.tasks.filter((x) => x === 'fields' || x === 'filters')).toEqual([]);
  });

  test('Escape closes the list first and the box on a second press', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('after a mart pick, Enter still builds the ad-hoc view for the same query', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'customers');
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Customers/));
    await u.click(options().find((o) => o.textContent!.startsWith('Customers'))!);
    await waitFor(() => expect(headings()).toBe('Customers'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(ai.tasks).toContain('fields'));
    await waitFor(() => expect(ai.tasks).toContain('filters'));
  });

  test('the previous rows stay while the next query waits out its pause; only the ad-hoc row is pending', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    const box = await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    const before = options().length;
    await u.type(box, 'x');
    expect(options()).toHaveLength(before);
    expect(options().at(-1)).toHaveAttribute('aria-disabled', 'true');
    await u.clear(box);
    await u.type(box, 'o');
    expect(options()).toHaveLength(1);
  });

  test('an ad-hoc run on the mart that is already open is one Undo step that restores the default view', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'paid orders last month');
    await waitFor(() => expect(rowsText().at(-1)).toMatch(/Orders/));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    await undo();
    await waitFor(() => expect(within(data()).queryByLabelText('Filter status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});
