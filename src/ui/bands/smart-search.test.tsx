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
const headings = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.querySelector('.truncate')!.textContent!).join(' + ');
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
/** The first heading: the main mart, before the marts the pipeline joined to it. */
const mainHeading = () => headings().split(' + ')[0];
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
    // The band alone cannot tell an applied search from a cleared one (both settle on the main mart and what it can join), so the search state is read from the view link.
    const copied = async () => {
      window.__copiedLink = undefined;
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
      await waitFor(() => expect(window.__copiedLink).toBeDefined());
      return (await decodeViewLink(window.__copiedLink!)) as { search?: string; found?: string[] };
    };
    const applied = await copied();
    expect(applied.search).toBe('customers');
    expect(applied.found).toContain('customers');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('combobox', { name: 'Search data marts' })).toHaveValue('');
    const cleared = await copied();
    expect(cleared.search ?? '').toBe('');
    expect(cleared.found ?? []).toEqual([]);
    // The band shows the main mart (Customers, picked by the search) and what it can join. Orders joins Customers the other way round (many to one), so it
    // is listed only while the join sources are still loading (every neighbour then); waiting for it raced that read, and a slow runner missed the window.
    await waitFor(() => expect(cardTitles()).toEqual(['Customers', 'Countries']));
    expect(within(marts()).queryByText('No data marts match.')).toBeNull();
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

/** A decision model that answers every question with its first option or top level; `gate` can hold or fail the nth call. */
const decisionFake = (gate?: (call: number) => Promise<void>, spy = vi.fn()) => {
  let n = 0;
  return {
    specificationVersion: 'v4', provider: 'test', modelId: 'd', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    doDecide: async (o: { questions: Record<string, { type: string; criteria: unknown }> }) => {
      n += 1;
      spy(o.questions);
      await gate?.(n);
      return { warnings: [], answers: Object.fromEntries(Object.entries(o.questions).map(([id, q]) => [id, q.type === 'choice' ? { type: 'choice', choice: Object.keys(q.criteria as object)[0] } : { type: 'score', score: 2 }])) };
    },
  };
};

describe('the pipeline', () => {
  test('the OWOX search ranks the marts: they show first, in rank order, five at most, and the best becomes the main mart', async () => {
    const t = setup({ ai: false });
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    await search('orders');
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(spy).toHaveBeenCalledWith('/api/search', { q: 'orders', entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: '20' });
    // the main mart first, then the hits it can join (the engine ranks a title hit above a description hit); the hits it cannot join are left out, and cards that leave are gone once their transition ends
    await waitFor(() => expect(cardTitles()).toHaveLength(2));
    expect(cardTitles()).toEqual(['Orders', 'Customers']);
    await waitFor(() => expect(within(marts()).queryByText('Stores')).toBeNull());
    expect(Z('Orders')).toHaveAttribute('aria-pressed', 'true');
  });

  test('an empty endpoint goes to the AI, which finds the marts by meaning; the best becomes the main mart', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
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

  test('the whole result is one Undo step: the main mart and its filters come back together', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
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

  test('a failing endpoint does not show an error: the pipeline still answers', async () => {
    const t = setup({ wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => (path === '/api/search' ? Promise.reject(new Error('503')) : c.owox.getJson(path, q))) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('typing again drops a run that waits on the intent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowFast = { doGenerate: async () => { await gate; return { content: [{ type: 'text', text: '{}' }] }; } };
    const decide = vi.fn();
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: Object.assign({}, slowFast, { fast: slowFast, decision: decisionFake(undefined, decide) }) } }) as Ctx });
    t.view();
    await ready();
    const box = await openSearch();
    await userEvent.type(box, 'orders{Enter}');
    await userEvent.type(box, 'x');
    release();
    await new Promise((r) => setTimeout(r, 200));
    expect(decide).not.toHaveBeenCalled();
  });

  test('a new search while one runs cancels the first', async () => {
    let first: AbortSignal | undefined;
    const slow = { doGenerate: (o: { abortSignal?: AbortSignal }) => { first ??= o.abortSignal; return new Promise<never>(() => {}); } };
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: Object.assign({}, slow, { fast: slow, decision: decisionFake() }) } }) as Ctx });
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
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
  });

  test('nothing found without AI says "No data marts match."', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
  });
});

test('the search never reads rows while typing, and asks no AI', async () => {
  const t = setup({});
  const reads: string[] = [];
  const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
  vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { reads.push(id); return real(id, o); });
  t.view();
  await ready();
  const before = reads.length;
  fireEvent.click(await openSearch());
  await userEvent.type(screen.getByRole('combobox', { name: 'Search data marts' }), 'who are our buyers');
  await new Promise((r) => setTimeout(r, 500));
  expect(reads.slice(before)).toEqual([]);
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
  const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: Object.assign({}, slow, { fast: slow, decision: decisionFake() }) } }) as Ctx });
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
  const base = createFakeAi() as unknown as Gen & { fast: Gen };
  const tasks: string[] = [];
  const wrap = (m: Gen): Gen => ({ ...m, doGenerate: async (o) => {
    const user = o.prompt.find((p) => p.role === 'user')!.content as { text: string }[];
    const task = (JSON.parse(user.map((c) => c.text).join('')) as { task: string }).task;
    tasks.push(task);
    await gate?.(task);
    return m.doGenerate(o);
  } });
  return { tasks, withAi: (c: Mock): Ctx => ({ ...c, credentials: { ai: { ...wrap(base), fast: wrap(base.fast) } } as unknown as Ctx['credentials'] }) };
}

/** The mock AI with its decision model held or failed per call number (1 is the first question of the run). */
function gatedAi(gate: (call: number) => Promise<void>) {
  const spy = spyAi();
  let n = 0;
  return { ...spy, withAi: (c: Mock): Ctx => {
    const ctx = spy.withAi(c);
    const ai = ctx.credentials!.ai as unknown as { decision: { doDecide: (o: unknown) => Promise<unknown> } };
    const real = ai.decision.doDecide.bind(ai.decision);
    ai.decision = { ...ai.decision, doDecide: async (o: unknown) => { n += 1; await gate(n); return real(o); } };
    return ctx;
  } };
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

  test('typing shows the ad-hoc row, then report rows, then mart rows, with no contexts on the rows', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Search data marts' }));
    await u.type(screen.getByRole('combobox'), 'orders');
    // nothing is searched before the pause: only the pending ad-hoc row shows
    expect(options()).toHaveLength(1);
    await settle();
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    const rows = rowsText();
    expect(rows[0]).toBe('Ad-hoc report "orders"');
    const isReport = (o: HTMLElement) => !!o.querySelector('.lucide-file-spreadsheet');
    const reports = options().filter(isReport);
    expect(options().slice(1, reports.length + 1)).toEqual(reports);
    expect(reports[0]).toHaveTextContent(/^Paid orders by monthofOrders$/);
    const marts = options().slice(reports.length + 1);
    expect(marts.length).toBeGreaterThan(0);
    expect(marts[0]).toHaveTextContent(/^Orders$/);
  });

  test('the context filter offers only the found marts\' contexts, and several picked at once keep the marts in any of them', async () => {
    const fx = demoFixtures();
    const set = (id: string, contexts: string[]) => { fx.marts.find((m) => m.id === id)!.contexts = contexts; };
    fx.contexts.push({ id: 'c-other', name: 'Other', description: null, icon: null });
    set('orders', ['c-sales']);
    set('order_items', ['c-catalog']);
    set('payments', ['c-sales', 'c-marketing']);
    set('returns', ['c-marketing']);
    // a mart the search does not find: its context is not offered
    set('campaigns', ['c-other']);
    setup({ ctx: createMockCtx(fx, { latencyMs: 0, ai: false }) }).view();
    await ready();
    const u = user();
    const box = await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    const martOf = (o: HTMLElement) => o.querySelector('.dm-sr-chip .dm-sr-name')!.textContent!;
    const marts = () => [...new Set(options().slice(1).map(martOf))].sort();
    expect(marts()).toEqual(['Customers', 'Order Items', 'Orders', 'Payments', 'Returns']);
    const filter = screen.getByRole('group', { name: 'Filter by context' });
    expect(within(filter).getAllByRole('button').map((c) => c.textContent)).toEqual(['Sales', 'Catalog', 'Marketing']);
    const chip = (name: string) => within(filter).getByRole('button', { name });
    // out of the Tab order, so the focus stays in the input
    expect(chip('Sales')).toHaveAttribute('tabindex', '-1');

    await u.click(chip('Sales'));
    expect(chip('Sales')).toHaveAttribute('aria-pressed', 'true');
    expect(box).toHaveFocus();
    expect(rowsText()[0]).toBe('Ad-hoc report "orders"');
    expect(marts()).toEqual(['Orders', 'Payments']);
    await u.click(chip('Catalog'));
    expect(marts()).toEqual(['Order Items', 'Orders', 'Payments']);
    await u.click(chip('Sales'));
    expect(chip('Sales')).toHaveAttribute('aria-pressed', 'false');
    expect(marts()).toEqual(['Order Items']);
    await u.click(chip('Catalog'));
    expect(marts()).toEqual(['Customers', 'Order Items', 'Orders', 'Payments', 'Returns']);
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

  test('asks no AI while typing and labels the row with the draft', async () => {
    const ai = spyAi();
    const decide = vi.fn();
    setup({ wrap: (c) => { const ctx = ai.withAi(c); const a = ctx.credentials!.ai as unknown as { decision: { doDecide: (o: unknown) => Promise<unknown> } }; const real = a.decision.doDecide.bind(a.decision); a.decision = { ...a.decision, doDecide: (o: unknown) => { decide(); return real(o); } }; return ctx; } }).view();
    await ready();
    await typeIn(user(), 'orders by status');
    await waitFor(() => expect(options()[0]).toHaveTextContent('Ad-hoc report "orders by status"'));
    expect(options()[0]).not.toHaveAttribute('aria-disabled');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(ai.tasks.filter((x) => x === 'intent' || x === 'shortlist')).toEqual([]);
    expect(decide).not.toHaveBeenCalled();
  });

  test('Enter with nothing highlighted runs the pipeline: the mart becomes main, and one Undo takes the whole report back', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'who are our buyers');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
    expect(ai.tasks).toContain('intent');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    await undo();
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('a grid edit made while the pipeline works keeps the edit', async () => {
    let answer: (() => void) | undefined;
    const ai = gatedAi((n) => (n === 2 ? new Promise<void>((r) => { answer = r; }) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'paid orders last month');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(answer).toBeDefined());
    await u.click(within(data()).getByRole('button', { name: /^Sort by status/ }));
    expect(within(data()).getByRole('button', { name: /^Sort by status, currently (ascending|descending)/ })).toBeInTheDocument();
    answer!();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(within(data()).queryByLabelText('Filter status')).toBeNull();
    expect(within(data()).getByRole('button', { name: /^Sort by status, currently (ascending|descending)/ })).toBeInTheDocument();
  });

  test('an Undo while the pipeline is still working cancels its late steps', async () => {
    let answer: (() => void) | undefined;
    const ai = gatedAi((n) => (n === 2 ? new Promise<void>((r) => { answer = r; }) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'paid orders last month');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(answer).toBeDefined());
    await undo();
    answer!();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(within(data()).queryByLabelText('Filter status')).toBeNull();
  });

  test('an edit made during a late step keeps the edit: no further questions, no chart saved, no failure notice', async () => {
    let answer: (() => void) | undefined;
    const ai = gatedAi((n) => (n === 4 ? new Promise<void>((r) => { answer = r; }) : Promise.resolve()));
    const puts: string[] = [];
    const wrap = (c: Mock): Ctx => {
      const ctx = ai.withAi(c);
      return { ...ctx, collections: (<T,>(name: string) => {
        const col = c.collections<T>(name);
        return { ...col, put: async (id: string, d: T) => { puts.push(`${name}/${id}`); return col.put(id, d); } };
      }) as Ctx['collections'] };
    };
    setup({ wrap }).view();
    await ready();
    const u = user();
    await typeIn(u, 'paid orders last month');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(answer).toBeDefined());
    await u.click(within(data()).getByRole('button', { name: /^Sort by status/ }));
    const asked = ai.tasks.length;
    answer!();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(puts.filter((k) => k.startsWith('charts/'))).toEqual([]);
    expect(within(data()).getByRole('button', { name: /^Sort by status, currently (ascending|descending)/ })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Search notice' })).toBeNull();
    expect(ai.tasks.length).toBe(asked);
  });

  test('a model that fails when the ad-hoc row is picked shows the notice', async () => {
    const ai = gatedAi((n) => (n === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'who are our buyers');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    expect(await screen.findByRole('status', { name: 'Search notice' })).toHaveTextContent("AI couldn't finish the report. Showing what it built so far.");
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
    await u.keyboard('{ArrowDown}');
    expect(options()[1]).toHaveTextContent(/^Paid orders by month/);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
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
    expect(await screen.findByRole('status', { name: 'Search notice' })).toHaveTextContent("Some parts of this report aren't shown: unique count.");
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

  test('picking a mart row selects it and makes no AI call', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'customers');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.click(options().find((o) => o.textContent!.startsWith('Customers'))!);
    await waitFor(() => expect(headings()).toBe('Customers'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // the number-format picker may ask its own question; the pipeline's never run
    expect(ai.tasks.filter((x) => x === 'intent' || x === 'shortlist')).toEqual([]);
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

  test('Escape with the focus outside the input closes the list', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    (document.activeElement as HTMLElement).blur();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    expect(screen.getByRole('combobox')).toHaveValue('orders');
  });

  test('a press outside the search closes the list and keeps the draft', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull();
    expect(screen.getByRole('combobox')).toHaveValue('orders');
  });

  test('a press on a result row still picks it', async () => {
    setup({ ai: false }).view();
    await ready();
    const u = user();
    await typeIn(u, 'extras');
    await waitFor(() => expect(rowsText().some((r) => r.startsWith('Orders with extras'))).toBe(true));
    await u.click(options().find((o) => o.textContent!.startsWith('Orders with extras'))!);
    expect(await screen.findByRole('status', { name: 'Search notice' })).toBeInTheDocument();
  });

  test('after a mart pick, Enter still runs the pipeline for the same query', async () => {
    const ai = spyAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'customers');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.click(options().find((o) => o.textContent!.startsWith('Customers'))!);
    await waitFor(() => expect(headings()).toBe('Customers'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(ai.tasks).toContain('intent'));
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
    expect(options()[0]).toHaveAttribute('aria-disabled', 'true');
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
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    await undo();
    await waitFor(() => expect(within(data()).queryByLabelText('Filter status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('Escape after Enter while the intent is pending does not drop a picked ad-hoc run', async () => {
    let release: (() => void) | undefined;
    const ai = spyAi((task) => (task === 'intent' ? new Promise<void>((r) => { release = r; }) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const u = user();
    await typeIn(u, 'who are our buyers');
    await waitFor(() => expect(options()[0]).not.toHaveAttribute('aria-disabled'));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(release).toBeDefined());
    await u.keyboard('{Escape}');
    release!();
    await waitFor(() => expect(mainHeading()).toBe('Customers'));
  });

  test('a new answer clears the highlight of a stale row', async () => {
    let release: (() => void) | undefined;
    const t = setup({ ai: false, wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => {
      if (path === '/api/search' && q?.q === 'orderss') return new Promise((res) => { release = () => res(c.owox.getJson(path, q)); });
      return c.owox.getJson(path, q);
    }) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    const u = user();
    const box = await typeIn(u, 'orders');
    await waitFor(() => expect(options().length).toBeGreaterThan(3));
    await u.type(box, 's');
    await settle();
    await waitFor(() => expect(release).toBeDefined());
    await u.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant');
    release!();
    await waitFor(() => expect(box).not.toHaveAttribute('aria-activedescendant'));
  });
});

/** The mock AI whose main question is unsure (the runner-up is nearly as likely), recording each question set and holding or failing calls by number. */
function unsureAi(gate?: (call: number) => Promise<void>) {
  const spy = spyAi();
  const asked: string[][] = [];
  let n = 0;
  return { ...spy, asked, withAi: (c: Mock): Ctx => {
    const ctx = spy.withAi(c);
    const ai = ctx.credentials!.ai as unknown as { decision: { doDecide: (o: { questions: Record<string, { criteria: object }> }) => Promise<{ answers: Record<string, { choice: string }> }> } };
    const real = ai.decision.doDecide.bind(ai.decision);
    ai.decision = { ...ai.decision, doDecide: async (o) => {
      n += 1;
      asked.push(Object.keys(o.questions));
      await gate?.(n);
      const res = await real(o);
      if (o.questions.main) {
        const pick = res.answers.main!;
        const alt = Object.keys(o.questions.main.criteria).find((k) => k !== pick.choice)!;
        // A complete distribution that sums to 1, as the decision API requires.
        const rest = Object.keys(o.questions.main.criteria).filter((k) => k !== pick.choice && k !== alt);
        const probabilities = Object.fromEntries([[pick.choice, 0.5], [alt, rest.length ? 0.45 : 0.5], ...rest.map((k) => [k, 0.05 / rest.length])]);
        res.answers.main = { ...pick, probabilities } as typeof pick;
      }
      return res;
    } };
    return ctx;
  } };
}
const chips = () => screen.queryByRole('group', { name: 'Also matches' }) ?? screen.queryByLabelText('Also matches');
const progressLine = () => screen.queryByRole('status', { name: 'Ad-hoc report progress' });

describe('the alternative marts', () => {
  const run = async (q: string) => { const box = await openSearch(); await userEvent.type(box, `${q}{Enter}`); return box; };
  const chipButtons = () => within(chips()!).getAllByRole('button');

  test('a chip clicked after the run reruns steps 2 to 5 on that mart as a new Undo step, without steps 0 and 1', async () => {
    const ai = unsureAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    await run('who are our buyers');
    await waitFor(() => expect(chips()).not.toBeNull());
    await waitFor(() => expect(progressLine()).toBeNull());
    const first = mainHeading();
    const intents = ai.tasks.filter((x) => x === 'intent').length;
    const mains = ai.asked.filter((q) => q.includes('main')).length;
    const title = chipButtons()[0]!.textContent!;
    await userEvent.click(chipButtons()[0]!);
    await waitFor(() => expect(mainHeading()).toBe(title));
    await waitFor(() => expect(progressLine()).toBeNull());
    expect(ai.tasks.filter((x) => x === 'intent')).toHaveLength(intents);
    expect(ai.asked.filter((q) => q.includes('main'))).toHaveLength(mains);
    await undo();
    await waitFor(() => expect(mainHeading()).toBe(first));
  });

  test('a chip clicked mid-run reruns the current query on the chip\'s mart', async () => {
    let hold: (() => void) | undefined;
    const ai = unsureAi((n) => (n === 2 ? new Promise<void>((r) => { hold = r; }) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    await run('who are our buyers');
    await waitFor(() => expect(chips()).not.toBeNull());
    await waitFor(() => expect(hold).toBeDefined());
    const title = chipButtons()[0]!.textContent!;
    await userEvent.click(chipButtons()[0]!);
    await waitFor(() => expect(mainHeading()).toBe(title));
    hold!();
    await waitFor(() => expect(progressLine()).toBeNull());
    expect(mainHeading()).toBe(title);
    expect(ai.asked.filter((q) => q.includes('main'))).toHaveLength(1);
  });

  test('picking a report row during a run clears the progress line', async () => {
    const ai = unsureAi((n) => (n === 1 ? new Promise<void>(() => {}) : Promise.resolve()));
    setup({ wrap: ai.withAi }).view();
    await ready();
    const box = await run('paid orders');
    await waitFor(() => expect(progressLine()).not.toBeNull());
    await userEvent.type(box, '{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(progressLine()).toBeNull());
  });

  test('typing clears the chips', async () => {
    const ai = unsureAi();
    setup({ wrap: ai.withAi }).view();
    await ready();
    const box = await run('who are our buyers');
    await waitFor(() => expect(chips()).not.toBeNull());
    await userEvent.type(box, 'x');
    await waitFor(() => expect(chips()).toBeNull());
  });

  test('nothing found, and no mart with a key, applies the title search', async () => {
    const fx = demoFixtures();
    for (const m of fx.marts) for (const f of (m as unknown as { fields: { isPrimaryKey?: boolean }[] }).fields ?? []) f.isPrimaryKey = false;
    const ai = unsureAi();
    setup({ ctx: ai.withAi(createMockCtx(fx, { latencyMs: 0 })) }).view();
    await ready();
    await run('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
  });
});
